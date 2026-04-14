/**
 * Vault server-side client — admin-signed transactions + event decoding.
 *
 * This lib is BACKEND-ONLY. It imports OWNER_PRIVATE_KEY and is never bundled
 * into the frontend (enforced by only importing from `src/app/api/**`).
 *
 * Required env vars:
 *   VAULT_ADDRESS      — 0x address of deployed PolyStreamVault on Polygon
 *   OWNER_PRIVATE_KEY  — private key of the contract's admin (0x-prefixed)
 *   POLYGON_RPC_URL    — optional, defaults to a public endpoint
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  getContract,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

export const USDC_E_ADDRESS: Address = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const DEFAULT_RPC = "https://polygon.drpc.org";

// Only the functions we actually call from the backend.
export const VAULT_ABI = parseAbi([
  // Views
  "function balanceOf(address user) view returns (uint256)",
  "function totalBalance() view returns (uint256)",
  "function paused() view returns (bool)",
  "function admin() view returns (address)",
  "function vaultUsdcBalance() view returns (uint256)",
  "function vaultMaticBalance() view returns (uint256)",
  // Mutating
  "function deposit(uint256 amount)",
  "function depositFor(address user, uint256 amount)",
  "function depositWithPermit(address user, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function withdraw(address user, uint256 amount, address to, bytes32 withdrawId)",
  "function dispenseMatic(address user, uint256 amount)",
  // Events
  "event Deposited(address indexed user, uint256 amount, address indexed by)",
  "event Withdrawn(address indexed user, uint256 amount, address indexed to, bytes32 indexed withdrawId)",
  "event MaticDispensed(address indexed user, uint256 amount)",
]);

// Standard ERC-20 subset for USDC.e allowance/approve checks.
export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

// ── Config loader ──────────────────────────────────────────────────────────
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

export function getVaultAddress(): Address {
  const v = requireEnv("VAULT_ADDRESS");
  return v as Address;
}

function getOwnerAccount() {
  const pk = requireEnv("OWNER_PRIVATE_KEY");
  const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
  return privateKeyToAccount(normalized);
}

function getRpcUrl(): string {
  return process.env.POLYGON_RPC_URL || DEFAULT_RPC;
}

// ── Clients ────────────────────────────────────────────────────────────────
export function publicClient() {
  return createPublicClient({
    chain: polygon,
    transport: http(getRpcUrl()),
  });
}

export function adminWalletClient() {
  return createWalletClient({
    chain: polygon,
    transport: http(getRpcUrl()),
    account: getOwnerAccount(),
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
/**
 * Turn a DB withdrawal UUID/string into a deterministic bytes32 for on-chain
 * correlation. keccak256 over the string bytes so the same input always maps
 * to the same 32-byte id.
 */
export function withdrawIdFor(dbId: string): Hex {
  return keccak256(toHex(dbId));
}

export function readVault() {
  const client = publicClient();
  return getContract({
    abi: VAULT_ABI,
    address: getVaultAddress(),
    client,
  });
}

export function writeVault() {
  const walletClient = adminWalletClient();
  return getContract({
    abi: VAULT_ABI,
    address: getVaultAddress(),
    client: { public: publicClient(), wallet: walletClient },
  });
}

// ── Event signatures (for indexer filtering) ───────────────────────────────
export const DEPOSITED_EVENT = parseAbiItem(
  "event Deposited(address indexed user, uint256 amount, address indexed by)"
);
export const WITHDRAWN_EVENT = parseAbiItem(
  "event Withdrawn(address indexed user, uint256 amount, address indexed to, bytes32 indexed withdrawId)"
);
export const MATIC_DISPENSED_EVENT = parseAbiItem(
  "event MaticDispensed(address indexed user, uint256 amount)"
);
