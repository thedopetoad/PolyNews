# PolyStreamVault — Deployment Guide

## TL;DR what you need to do manually

1. Deploy `PolyStreamVault.sol` to Polygon mainnet with admin = your owner wallet, usdc = USDC.e address.
2. Note the deployed address + deployment block number.
3. Fund the vault with ~$5 of MATIC (for `dispenseMatic` calls + future needs).
4. Set four Vercel env vars:
   - `VAULT_ADDRESS` = contract address
   - `VAULT_DEPLOY_BLOCK` = block number at deploy (for the indexer start point)
   - `OWNER_PRIVATE_KEY` = 0x-prefixed private key of the admin EOA
   - `NEXT_PUBLIC_VAULT_ADDRESS` = same as `VAULT_ADDRESS` (frontend needs it)
5. Run `npx drizzle-kit push` to add the vault tables to Neon.
6. Redeploy polystream (`npx vercel --yes --prod`).
7. Hit `POST https://polystream.vercel.app/api/vault/sync` once to initialize the indexer cursor.
8. Ideally set up a Vercel cron to hit `/api/vault/sync` every 30s.

## Contract constructor

```
PolyStreamVault(admin, usdc)
  admin = 0xFbeEfB072F368803B33BA5c529f2F6762941b282   // your owner EOA
  usdc  = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174   // USDC.e on Polygon
```

## Deployment (3 options)

### Option A — Remix (simplest, one-off)

1. Open https://remix.ethereum.org
2. New file: `PolyStreamVault.sol`, paste from `contracts/PolyStreamVault.sol`
3. Compiler tab: Solidity 0.8.24, optimization enabled (200 runs), compile
4. Deploy tab:
   - Environment: "Injected Provider - MetaMask", switch MetaMask to Polygon
   - Constructor args: `_admin` = owner EOA, `_usdc` = `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
   - Deploy, confirm in MetaMask
5. Copy deployed address from Remix.
6. Grab deploy block from Polygonscan tx page.

### Option B — Foundry script

```bash
forge create contracts/PolyStreamVault.sol:PolyStreamVault \
  --rpc-url https://polygon.drpc.org \
  --private-key $OWNER_PRIVATE_KEY \
  --constructor-args 0xFbeEfB072F368803B33BA5c529f2F6762941b282 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
```

### Option C — Hardhat

Standard Hardhat deploy script — `hardhat run scripts/deploy.ts --network polygon`.
Not set up in this repo; use Remix or Foundry above.

## Verify on Polygonscan

After deploy, verify source so users can read the contract:

```bash
forge verify-contract <VAULT_ADDRESS> contracts/PolyStreamVault.sol:PolyStreamVault \
  --chain polygon \
  --constructor-args $(cast abi-encode "constructor(address,address)" 0xFbeE...b282 0x2791...4174)
```

Or via Remix's Polygonscan verifier plugin.

## Env vars

| Variable | Where | Notes |
|---|---|---|
| `VAULT_ADDRESS` | Vercel (server) | Deployed contract address |
| `VAULT_DEPLOY_BLOCK` | Vercel (server) | Block number at deploy — indexer starts here |
| `OWNER_PRIVATE_KEY` | Vercel (server, encrypted) | Admin EOA private key. Rotate to a Safe multisig before real-money |
| `NEXT_PUBLIC_VAULT_ADDRESS` | Vercel (client) | Same address as `VAULT_ADDRESS`, needed by frontend for permit signing |
| `POLYGON_RPC_URL` | Vercel (server, optional) | Defaults to `https://polygon.drpc.org`. Set a private RPC for reliability |
| `DATABASE_URL` | Vercel (server, already set) | Neon Postgres |

## Database migration

```bash
npx drizzle-kit push
```

This adds four tables: `vault_balances`, `vault_events`, `vault_withdrawals`, `vault_sync_state`.

## Operations

### Initial funding

Send MATIC to the vault:
```
send 5 MATIC to VAULT_ADDRESS   # covers ~2,000 tx gas fees at $0.002/tx
```

### Cron the indexer

Add to `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/vault/sync", "schedule": "*/1 * * * *" }
  ]
}
```

(Once per minute — Polygon blocks are ~2s, so ~30 blocks per tick, well under `MAX_BLOCK_RANGE=2000`.)

### Emergency pause

Call `setPaused(true)` from the admin EOA:
```bash
cast send $VAULT_ADDRESS "setPaused(bool)" true --rpc-url $RPC --private-key $OWNER_PRIVATE_KEY
```

Blocks all deposits and withdrawals until `setPaused(false)`.

### Rotate admin to a Safe multisig

```solidity
vault.proposeAdmin(safeAddress)
// then from the Safe:
vault.acceptAdmin()
```

Strongly recommended before moving real user funds.

## Security checklist before real-money use

- [ ] External audit of `PolyStreamVault.sol` (OpenZeppelin, Trail of Bits, ConsenSys Diligence)
- [ ] Admin is a multisig (Safe), not a single EOA
- [ ] Hot wallet keys behind KMS or HSM, not raw env vars
- [ ] Indexer + balances reconcile against on-chain state via scheduled audit job
- [ ] Rate limits on `/api/vault/withdraw` (per-user + global, daily cap)
- [ ] Session validation on withdraw beyond `Authorization` header match (EIP-191 signature proving live EOA access)
- [ ] Money transmission license per jurisdiction (US: MSB registration + state-by-state. EU: VASP + MiCA)
- [ ] Bug bounty live on Immunefi or similar
- [ ] Monitoring: on-chain balance vs DB total, unusual withdrawal patterns, paused state

## Known limitations (MVP scope)

- Same-chain Polygon USDC.e withdrawals only. Cross-chain withdrawal (vault → Solana SOL, etc.) requires layering Relay on top — TODO for iteration 2.
- Per-chain deposit addresses not built — users still use the existing Bridge modal to get USDC.e to their EOA, then sign a permit to deposit into the vault.
- MATIC dispensing via `dispenseMatic` exists on the contract and in `writeVault()` but no backend endpoint calls it yet — add `/api/vault/matic-airdrop` if needed.
- No solvency proofs (SumCheck / Merkle) on-chain. DB is source of truth; on-chain `balanceOf` mapping mirrors.
