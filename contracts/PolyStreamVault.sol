// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * PolyStreamVault
 * ---------------
 * Minimal custody vault for PolyStream on Polygon.
 *
 * User flow:
 *   1. User bridges any-chain funds → USDC.e on Polygon (via Relay execute flow)
 *   2. User sends USDC.e to this vault with `deposit(amount)` OR Relay delivers
 *      directly via `depositFor(user, amount)` after a pre-approved transferFrom.
 *   3. Backend observes Deposited event, credits user in Postgres.
 *   4. Trading happens via Polymarket CLOB — the vault calls `pullForTrade()`
 *      which transfers USDC.e to the user's EOA for the single trade tx, then
 *      `pushPostTrade()` sweeps remainder back. (Phase 2 — not in MVP; MVP
 *      just tracks balances and supports withdrawal.)
 *   5. Withdrawal: backend calls `withdraw(user, amount, to)` which transfers
 *      USDC.e to `to`. Admin-only because backend authenticates the user via
 *      Magic/wallet signature server-side.
 *
 * Gas:
 *   - `depositMatic()` lets admin top up the vault's MATIC balance.
 *   - `dispenseMatic(user, amount)` sends MATIC to a user (for first-time
 *     Polymarket CLOB approval gas). Admin-only, rate-limited off-chain.
 *
 * Security model:
 *   - Admin = EOA or multisig that signs withdrawals. KMS/HSM recommended.
 *   - No upgradability in MVP — deploy fresh if contract changes needed.
 *   - Pausable for emergency — admin flips `paused` to block deposits/withdrawals.
 *   - ReentrancyGuard via check-effects-interactions on transfer calls.
 *
 * NOT IN SCOPE for MVP (add before mainnet-with-real-money use):
 *   - Multi-sig admin (use a Safe wallet as admin)
 *   - Per-user withdrawal rate limits
 *   - Daily aggregate caps
 *   - On-chain solvency proofs (SumCheck / Merkle)
 *   - KYC/AML gating at the contract level
 *
 * Audit + legal review REQUIRED before routing real user funds.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// USDC.e on Polygon is FiatTokenV2_1 which implements EIP-2612 permit.
interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

contract PolyStreamVault {
    // ── Storage ─────────────────────────────────────────────────────────────
    address public admin;
    address public pendingAdmin;
    IERC20 public immutable usdc;

    /// Per-user credited balance (off-chain-accounted — source of truth is DB,
    /// but this provides an on-chain mirror for transparency and audit).
    mapping(address => uint256) public balanceOf;

    /// Cumulative per-user deposits + withdrawals (helps reconcile DB).
    mapping(address => uint256) public totalDeposited;
    mapping(address => uint256) public totalWithdrawn;

    /// Total USDC.e the vault has custody of (should equal sum of balanceOf).
    uint256 public totalBalance;

    /// Cumulative MATIC dispensed per user (so backend can cap at once-per-user).
    mapping(address => uint256) public maticDispensed;

    bool public paused;
    uint256 private _locked;

    // ── Events ──────────────────────────────────────────────────────────────
    event Deposited(address indexed user, uint256 amount, address indexed by);
    event Withdrawn(address indexed user, uint256 amount, address indexed to, bytes32 indexed withdrawId);
    event MaticDispensed(address indexed user, uint256 amount);
    event AdminChanged(address indexed previous, address indexed next);
    event AdminProposed(address indexed proposed);
    event Paused(bool status);

    // ── Errors ──────────────────────────────────────────────────────────────
    error NotAdmin();
    error IsPaused();
    error InvalidAmount();
    error InvalidAddress();
    error InsufficientBalance();
    error TransferFailed();
    error Reentrancy();

    // ── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    modifier nonReentrant() {
        if (_locked == 1) revert Reentrancy();
        _locked = 1;
        _;
        _locked = 0;
    }

    // ── Init ────────────────────────────────────────────────────────────────
    constructor(address _admin, address _usdc) {
        if (_admin == address(0) || _usdc == address(0)) revert InvalidAddress();
        admin = _admin;
        usdc = IERC20(_usdc);
        emit AdminChanged(address(0), _admin);
    }

    // ── Deposits ────────────────────────────────────────────────────────────
    /**
     * User has already called `usdc.approve(vault, amount)` on their EOA and
     * now calls `deposit(amount)` themselves. Vault pulls the tokens.
     */
    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        _credit(msg.sender, amount, msg.sender);
    }

    /**
     * Backend-driven deposit. Useful when Relay's solver delivers USDC.e to
     * the user's EOA and the backend wants to sweep it into the vault in one
     * step (the EOA must have pre-approved the vault, or this reverts).
     */
    function depositFor(address user, uint256 amount) external whenNotPaused nonReentrant {
        if (user == address(0)) revert InvalidAddress();
        _credit(user, amount, msg.sender);
    }

    /**
     * GASLESS DEPOSIT. User signs an EIP-2612 permit off-chain (no gas), admin
     * relays it to the vault. Vault calls permit() on USDC.e to authorize
     * transferFrom, then pulls and credits. Users with 0 MATIC can deposit
     * without ever needing native gas.
     *
     * IMPORTANT: Reverts in permit() if the signature is expired, wrong
     * nonce, or tampered. Admin pays gas either way. Front-end should
     * validate signature against expected domain/message before submitting
     * to avoid wasted gas on guaranteed failures.
     */
    function depositWithPermit(
        address user,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyAdmin whenNotPaused nonReentrant {
        if (user == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        // Authorize this vault as spender via EIP-2612 permit.
        IERC20Permit(address(usdc)).permit(user, address(this), amount, deadline, v, r, s);
        // Now pull.
        bool ok = usdc.transferFrom(user, address(this), amount);
        if (!ok) revert TransferFailed();
        balanceOf[user] += amount;
        totalDeposited[user] += amount;
        totalBalance += amount;
        emit Deposited(user, amount, user);
    }

    function _credit(address user, uint256 amount, address source) internal {
        if (amount == 0) revert InvalidAmount();
        // Pull USDC.e FROM the source address (user for deposit, anyone for depositFor)
        bool ok = usdc.transferFrom(source, address(this), amount);
        if (!ok) revert TransferFailed();
        balanceOf[user] += amount;
        totalDeposited[user] += amount;
        totalBalance += amount;
        emit Deposited(user, amount, source);
    }

    // ── Withdrawals (admin-signed) ──────────────────────────────────────────
    /**
     * Backend calls this to send USDC.e out of the vault. The backend is
     * responsible for authenticating the user's withdrawal request off-chain
     * (Magic signature or wallet signature) before signing this tx.
     *
     * `withdrawId` is a unique ID from the DB (e.g. UUID hashed) to correlate
     * logs and prevent accidental double-withdrawals via event replay.
     */
    function withdraw(
        address user,
        uint256 amount,
        address to,
        bytes32 withdrawId
    ) external onlyAdmin whenNotPaused nonReentrant {
        if (to == address(0) || user == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (balanceOf[user] < amount) revert InsufficientBalance();

        balanceOf[user] -= amount;
        totalWithdrawn[user] += amount;
        totalBalance -= amount;

        bool ok = usdc.transfer(to, amount);
        if (!ok) revert TransferFailed();

        emit Withdrawn(user, amount, to, withdrawId);
    }

    // ── MATIC gas dispensing ────────────────────────────────────────────────
    /**
     * Admin funds the vault's MATIC balance so it can dispense tiny amounts
     * to users for their first Polymarket CLOB approve tx.
     */
    function depositMatic() external payable onlyAdmin {}

    /**
     * Admin sends MATIC to a user. Backend enforces "once per user" and
     * sensible amounts off-chain; on-chain we only enforce balance + paused.
     */
    function dispenseMatic(address payable user, uint256 amount) external onlyAdmin whenNotPaused nonReentrant {
        if (user == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        maticDispensed[user] += amount;

        (bool ok, ) = user.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit MaticDispensed(user, amount);
    }

    /// Admin can withdraw excess MATIC (e.g. after winding down).
    function recoverMatic(address payable to, uint256 amount) external onlyAdmin nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ── Admin controls ──────────────────────────────────────────────────────
    function proposeAdmin(address next) external onlyAdmin {
        if (next == address(0)) revert InvalidAddress();
        pendingAdmin = next;
        emit AdminProposed(next);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotAdmin();
        address prev = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminChanged(prev, admin);
    }

    function setPaused(bool status) external onlyAdmin {
        paused = status;
        emit Paused(status);
    }

    // ── Views ───────────────────────────────────────────────────────────────
    /// On-chain USDC.e balance of the vault contract itself — should match totalBalance.
    function vaultUsdcBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function vaultMaticBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// Emergency: admin can recover ERC-20s accidentally sent to this contract
    /// that aren't USDC.e (to prevent them being stuck forever). Does NOT let
    /// admin drain user USDC.e — that's gated behind withdraw() which updates
    /// balanceOf accounting.
    function recoverStrayToken(address token, address to, uint256 amount) external onlyAdmin nonReentrant {
        if (token == address(usdc)) revert InvalidAddress();      // use withdraw() for USDC.e
        if (to == address(0)) revert InvalidAddress();
        bool ok = IERC20(token).transfer(to, amount);
        if (!ok) revert TransferFailed();
    }

    receive() external payable {
        // Accept MATIC sent directly so admin can top up without calling depositMatic().
    }
}
