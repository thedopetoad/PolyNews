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
