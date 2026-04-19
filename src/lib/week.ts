// ISO 8601 week helpers. Used for weekly-goal idempotency and weekly
// leaderboards. All buckets are UTC — so a "week" rolls at Monday
// 00:00 UTC for every user, regardless of local timezone.

/** Returns the ISO week key for a given Date, e.g. "2026-W16". */
export function isoWeekKey(date: Date = new Date()): string {
  // Copy and shift to UTC midnight
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO day of week: 1 (Mon) .. 7 (Sun). Shift to Thursday of the same
  // week so the year is unambiguous (ISO weeks belong to the year of
  // their Thursday).
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/** Milliseconds since epoch for the start of the ISO week that `date` belongs to (Mon 00:00 UTC). */
export function isoWeekStart(date: Date = new Date()): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dayNum - 1));
  return d;
}

/** 15-second bucket identifier used for news-watch heartbeats: "2026-W16-1234567". */
export function heartbeatBucket(date: Date = new Date()): string {
  const bucketIndex = Math.floor(date.getTime() / 15000);
  return `${isoWeekKey(date)}-${bucketIndex}`;
}

// ─────────────────────────────────────────────────────────────
// Prize-week helpers — used by the weekly leaderboards and the
// Monday-cron payout snapshot.
//
// Prize week boundary: Monday 17:00 UTC (= 9am PST / 10am PDT).
// Uses UTC literally; during US DST the local-time clock shifts by
// an hour but the UTC anchor stays stable. This is what Vercel Cron
// expresses with `0 17 * * 1`.
//
// Week key is the ISO date of the Monday the week started on, e.g.
// "2026-04-13" — readable, sortable, no ambiguity.
// ─────────────────────────────────────────────────────────────

export function prizeWeekStart(date: Date = new Date()): Date {
  const d = new Date(date.getTime());
  const dayOfWeek = d.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const h = d.getUTCHours();

  let daysBack: number;
  if (dayOfWeek === 1 && h < 17) {
    // Monday, but before 17:00 UTC — previous week's reset was 7 days ago
    daysBack = 7;
  } else if (dayOfWeek === 1) {
    // Monday, 17:00 or later — this Monday's reset
    daysBack = 0;
  } else {
    // Tue..Sun — walk back to the last Monday
    daysBack = (dayOfWeek + 6) % 7;
  }

  d.setUTCDate(d.getUTCDate() - daysBack);
  d.setUTCHours(17, 0, 0, 0);
  return d;
}

export function prizeWeekKey(date: Date = new Date()): string {
  const start = prizeWeekStart(date);
  const y = start.getUTCFullYear();
  const m = String(start.getUTCMonth() + 1).padStart(2, "0");
  const d = String(start.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Human-readable date range for a given prize-week key. Pass the
 * output of `prizeWeekKey()` (or any Monday-YYYY-MM-DD string) and
 * get back { start, end } dates you can format however the UI wants.
 * End = start + 6 days 23:59:59.
 */
export function prizeWeekRange(weekKey: string): { start: Date; end: Date } {
  const [y, mo, d] = weekKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, mo - 1, d, 17, 0, 0, 0));
  const end = new Date(start.getTime() + 7 * 86400 * 1000 - 1);
  return { start, end };
}

/**
 * Day key for the daily airdrop claim. Rolls at 17:00 UTC (9am PST,
 * 10am PDT) so it lines up with the weekly prize reset and the UI
 * label ("Resets at 9am PST"). Previously this used the UTC calendar
 * date, which flipped at UTC midnight (~5pm PT) — users who claimed
 * in the evening PT got locked out for the REST of their PT-day and
 * only regained access the following 5pm PT, which was confusing and
 * contradicted what the UI promised.
 *
 * Format: "YYYY-MM-DD" of the UTC date 17 hours earlier. At, say,
 * Tuesday 02:00 UTC (Monday 7pm PT) the key is "Monday". At
 * Tuesday 17:00 UTC (Tuesday 10am PDT) the key flips to "Tuesday".
 */
export function dailyClaimKey(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() - 17 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The day key that was "yesterday" relative to a given moment — used
 * by the streak system to decide whether the user's last claim was on
 * the immediately preceding day (streak continues) or earlier (streak
 * resets). One day = 24h shift past the dailyClaimKey anchor.
 */
export function yesterdayClaimKey(date: Date = new Date()): string {
  return dailyClaimKey(new Date(date.getTime() - 24 * 3600 * 1000));
}
