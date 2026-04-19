import { AIRDROP_AMOUNTS } from "@/lib/constants";
import { dailyClaimKey, yesterdayClaimKey } from "@/lib/week";

/**
 * Daily-claim streak math.
 *
 * Ladder:
 *   Day 1 → 1× base (100)
 *   Day 2 → 2× base (200)
 *   ...
 *   Day 7+ → 7× base (700, capped)
 *
 * Miss a day → resets to Day 1 on the next claim.
 *
 * The day boundary is the same one the daily claim itself uses
 * (17:00 UTC, see dailyClaimKey) — that way "consecutive days" lines
 * up exactly with the user's "I claimed yesterday" mental model.
 */

export const DAILY_STREAK_CAP = 7;

/**
 * Compute the streak the user is currently ON, based on the most
 * recent claim and the current time.
 *
 *   - Claim was today's key       → streak is whatever's stored
 *   - Claim was yesterday's key   → streak is whatever's stored
 *     (still active — they can claim today to continue it)
 *   - Claim was older / null      → streak is 0 (broken)
 *
 * "Stored" comes from users.dailyStreak. The "broken" case returns 0
 * so the next claim's nextStreak() pushes it to 1.
 */
export function activeStreak(
  lastDailyAirdrop: string | null,
  storedStreak: number,
  now: Date = new Date(),
): number {
  if (!lastDailyAirdrop) return 0;
  const today = dailyClaimKey(now);
  const yesterday = yesterdayClaimKey(now);
  if (lastDailyAirdrop === today || lastDailyAirdrop === yesterday) {
    // Floor at 1 — if there's a claim record in the alive window, the
    // user is on AT LEAST Day 1. The stored value can legitimately be
    // 0 for users who claimed before the streak column existed (the
    // migration backfilled to default 0; their claim row was written
    // by the pre-streak code path that didn't bump dailyStreak).
    // Without this floor, they'd see "🔥 Day 0" the day the streak
    // system shipped, which makes no sense given they obviously
    // claimed.
    return Math.max(storedStreak, 1);
  }
  return 0;
}

/**
 * What the user's streak BECOMES if they claim right now. Continues
 * the active streak by +1, or starts at 1 from a broken/empty state.
 */
export function nextStreak(
  lastDailyAirdrop: string | null,
  storedStreak: number,
  now: Date = new Date(),
): number {
  return activeStreak(lastDailyAirdrop, storedStreak, now) + 1;
}

/**
 * Reward amount for a claim at a given streak position. Linear up to
 * the cap, then flat. e.g. streak=3 → 300, streak=12 → 700.
 */
export function streakReward(streak: number): number {
  const multiplier = Math.min(Math.max(streak, 1), DAILY_STREAK_CAP);
  return AIRDROP_AMOUNTS.daily * multiplier;
}
