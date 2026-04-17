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
