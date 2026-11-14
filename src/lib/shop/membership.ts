/**
 * Membership pricing helpers.
 *
 * Membership state lives on users.plan_id / plan_expires_at and is backed by a
 * plans row whose kind is "membership". The shop never trusts a price sent by
 * the browser: createShopOrder() recomputes the same member price server-side.
 */

export type MembershipUser = {
  plan_kind?: string | null;
  plan_expires_at?: string | null;
  plan_discount_bps?: number | null;
} | null;

export type MembershipInfo = {
  active: boolean;
  discountBps: number;
  expiresAt: string | null;
};

export function getMembershipInfo(user: MembershipUser): MembershipInfo {
  if (!user || user.plan_kind !== "membership" || !user.plan_expires_at) {
    return { active: false, discountBps: 0, expiresAt: null };
  }
  const expiresAt = new Date(user.plan_expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return { active: false, discountBps: 0, expiresAt: user.plan_expires_at };
  }
  const discountBps = Math.max(
    0,
    Math.min(9_000, Math.trunc(Number(user.plan_discount_bps) || 0)),
  );
  return { active: true, discountBps, expiresAt: user.plan_expires_at };
}

/**
 * Member price never goes below the supplier's snapshot cost. If the product
 * has no costed source, the discount applies to the retail price as-is.
 */
export function memberPriceMicros(
  retailMicros: number,
  costMicros: number,
  discountBps: number,
): number {
  if (!Number.isFinite(retailMicros) || retailMicros <= 0) return retailMicros;
  if (!Number.isFinite(discountBps) || discountBps <= 0) return retailMicros;
  const bps = Math.min(9_000, Math.trunc(discountBps));
  const discounted = Math.floor((retailMicros * (10_000 - bps)) / 10_000);
  const floor =
    Number.isFinite(costMicros) && costMicros > 0 ? Math.ceil(costMicros) : 1;
  return Math.min(retailMicros, Math.max(1, discounted, floor));
}

export function memberDiscountLabel(discountBps: number): string {
  const bps = Math.max(0, Math.min(9_000, Math.trunc(discountBps)));
  if (bps <= 0) return "无折扣";
  const rate = (10_000 - bps) / 1_000;
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)} 折`;
}
