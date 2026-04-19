import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { users, airdrops, referrals } from "@/db";
import { AIRDROP_AMOUNTS } from "@/lib/constants";
import { generateSecureId } from "@/lib/auth";
import { isoWeekKey } from "@/lib/week";

type Db = ReturnType<typeof getDb>;

/**
 * Idempotent +5000 payout from a new (referrer, referred) pair.
 *
 * Insert order is intentional: the `referrals` row goes in FIRST. That
 * row has a unique index on `referred_id`, so a duplicate request — be
 * it a race between /api/user POST and /api/airdrop apply-referral, a
 * client retry, or anything else — fails the insert and we skip the
 * bonus. The single source of truth for "has this pair been paid" is
 * the existence of the referrals row.
 *
 * Returns true when the bonus was actually paid out, false when it was
 * already paid (no-op). Either is "success" from the caller's POV.
 *
 * Has been bitten twice by skipping this guard: once in the legacy
 * signup-claim path that never executed after auto-grant landed, and
 * once in the apply-referral path that only set users.referredBy
 * without ever crediting the referrer. Funnel both call sites through
 * here so any future referral entry point gets the same protection
 * for free.
 */
export type ReferralSource = "signup_link" | "oauth_backfill" | "apply_code" | "unknown";

export async function payReferralBonus(
  db: Db,
  referrerId: string,
  referredId: string,
  source: ReferralSource = "unknown",
): Promise<boolean> {
  try {
    await db.insert(referrals).values({
      id: generateSecureId(),
      referrerId,
      referredId,
      signupBonusPaid: true,
      source,
    });
  } catch (err) {
    // Unique-constraint violation on referred_id — already paid.
    // Treat as no-op success; any other DB error re-throws.
    const msg = (err as Error).message || "";
    if (
      msg.includes("duplicate key") ||
      msg.includes("unique constraint") ||
      msg.includes("23505")
    ) {
      return false;
    }
    throw err;
  }

  await db
    .update(users)
    .set({ balance: sql`${users.balance} + ${AIRDROP_AMOUNTS.referralBonus}` })
    .where(eq(users.id, referrerId));

  await db.insert(airdrops).values({
    id: generateSecureId(),
    userId: referrerId,
    source: "referral",
    amount: AIRDROP_AMOUNTS.referralBonus,
    weekKey: isoWeekKey(),
  });

  return true;
}
