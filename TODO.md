# PolyStream - Remaining Issues (as of April 2, 2026)

## CRITICAL: Fix Now

### 1. Google Login "User not found" on daily claim
- **What**: Google users can log in and see 10,000 PST balance, but clicking "Claim 100 PST" returns "User not found"
- **Root cause**: The airdrop API (`/api/airdrop/route.ts`) calls `getAuthenticatedUser()` which validates the address format with `isValidAddress()` (requires `0x` + 40 hex chars). Web3Auth returns a checksummed Ethereum address, but the `userId` in the request body might not match the normalized (lowercased) version stored in the DB.
- **Fix**: In `/api/airdrop/route.ts`, the auth check compares `authedUser` (lowercased from header) with `normalizedUserId` (lowercased from body). But the user was created with the ORIGINAL case address from Web3Auth in `login-modal.tsx`. Check if the user creation lowercases the ID vs what's stored.
- **Quick fix**: In `login-modal.tsx` line where it creates the user, lowercase the address: `id: accounts[0].toLowerCase()`

### 2. Finance category showing Sports markets
- **What**: The "Finance" category tab shows NHL Stanley Cup markets
- **Root cause**: In `events/route.ts`, the category assignment loop does `break` after the first match, but "Kraken" (the crypto exchange) matches "Kraken IPO" which is correctly Finance, however the NHL markets don't have finance keywords. The issue is that the categories are checked in order, and some markets fall through to wrong categories.
- **Fix**: Check the server categorization logic. The NHL markets should match "Sports" (they have "stanley cup", "nhl"). Make sure "Sports" keywords are checked before or instead of "Finance" for these.

### 3. "Browse all markets" behavior
- **What**: User wants "Browse all markets" to toggle the spinning ticker into a flat grid showing ALL markets in the selected category, NOT link to paper trade
- **Fix**: Add a `showAll` state toggle. When true, show a static grid of all filtered markets instead of the scrolling ticker. Button text changes to "Back to ticker" when in grid mode.

## HIGH: Fix Soon

### 4. AI Consensus page margin too large
- **What**: Big gap between the results table and the footer
- **Fix**: Reduce `py-8` to `py-4` on the main container in `ai/page.tsx`

### 5. Position click not navigating
- **What**: Clicking open position in portfolio should navigate to that market's trade detail view
- **Status**: Code was added (`onPositionClick` + `allMarkets` lookup) but may not work if the market isn't in the fetched events. The position stores `marketId` but the market list uses different IDs.
- **Fix**: Test with a real position. If it doesn't work, the `allMarkets.find(m => m.id === marketId)` might need to match on `conditionId` instead.

### 6. News page first ticker card cut off on the left
- **What**: The scrolling ticker's first card is partially visible/cut off
- **Fix**: Add `pl-4` padding to the ticker container or start the animation from the right edge

## MEDIUM: Polish

### 7. Plexus background on AI page extends below footer
- The fixed position background extends past the page content
- Consider using `min-h-screen` on the page container instead of fixed positioning

### 8. More market diversity
- Currently fetching 50 events but many are 2028 presidential nominations
- Could add `tag` parameter to Gamma API to fetch different categories separately
- Or make multiple API calls with different tags and merge results

## Architecture Notes
- 27 commits in git, all saved locally at C:\Users\will\Desktop\Polymarket
- Deployed to polystream.vercel.app (Vercel)
- Neon PostgreSQL connected via Vercel Marketplace
- OpenAI API key set in Vercel env vars
- Web3Auth client ID set (SAPPHIRE_DEVNET)
- WalletConnect project ID set
- All code uses Next.js 16 App Router
