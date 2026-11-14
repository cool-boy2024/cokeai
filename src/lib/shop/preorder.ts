/**
 * Preorder (预定单) detection for the zyanai mirror.
 *
 * The supplier renders a reservation banner (`tokyo-reservation-notice
 * is-active`), an item-stock badge `预订发货` and a `预订购买` payment label
 * only when the listing is actually sold as a preorder. The same pages embed
 * an inactive banner for every item, so the presence of the banner text alone
 * means nothing — the `is-active` class is the rendered state.
 *
 * The detail JSON also carries the underlying stock: for every item observed
 * on 2026-11-14 the active banner matched `reservation_enabled = 1` together
 * with an empty stock (`is_stock = false`, `stock_state = 0`, or
 * `stock_raw = 0`). `reservation_enabled` alone is not a signal: it is 1 for
 * nearly every listing, including ones with plenty of stock, because it only
 * means "the shop is capable of accepting reservations".
 *
 * Keep the marker in `shop_products.availability_reason` rather than
 * `delivery_method`: `delivery_method` has a CHECK constraint limited to
 * ('manual', 'auto') in db/schema.sql, and adding a new value would require a
 * migration. `availability_reason` is free text, already exists, and is not
 * rendered publicly — the public catalog only exposes the derived boolean.
 */
export const PREORDER_MARKER = "preorder";

/**
 * Operator-forced preorder column. Kept separate from the supplier marker in
 * availability_reason so a scheduled sync can refresh stock without clearing
 * a decision the operator made: some listings are bought on demand even while
 * the supplier shows stock.
 */
export const PREORDER_MANUAL_COLUMN = "preorder_manual";

/**
 * Operated brands that are always sold as preorders, whatever the supplier's
 * stock flag says. Muse stock is purchased on request, so an `in_stock` flag
 * on a Muse product must not be shown as immediate stock.
 */
export const PREORDER_BRANDS = ["muse"] as const;

export function isPreorderBrand(brand: unknown): boolean {
  const value = String(brand ?? "").trim().toLowerCase();
  return (PREORDER_BRANDS as readonly string[]).includes(value);
}

/**
 * SQL predicate for the public/admin `preorder` boolean. `alias` is the table
 * alias including the trailing dot (for example `p.`). Every interpolation is
 * a module constant, never user input.
 *
 * Three sources, in order of authority: an operator's per-product switch, the
 * supplier's own reservation marker, and the always-preorder brands.
 */
export function preorderSql(alias = ""): string {
  const brands = PREORDER_BRANDS.map((brand) => `'${brand}'`).join(", ");
  return `(${alias}${PREORDER_MANUAL_COLUMN} = TRUE OR ${alias}availability_reason = '${PREORDER_MARKER}' OR lower(coalesce(${alias}brand, '')) IN (${brands}))`;
}

export type PreorderStockSignals = {
  stock_raw?: unknown;
  is_stock?: unknown;
  stock_state?: unknown;
  reservation_enabled?: unknown;
};

function flag(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "1" || text === "true") return true;
  if (text === "0" || text === "false") return false;
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * True only when the supplier says reservations are enabled AND the item has
 * no purchasable stock. Unknown or missing signals fall back to `false` so a
 * supplier payload change never turns an in-stock listing into a preorder.
 */
export function isPreorderStock(signals: PreorderStockSignals): boolean {
  if (flag(signals.reservation_enabled) !== true) return false;
  if (flag(signals.is_stock) === false) return true;
  if (finiteNumber(signals.stock_state) === 0) return true;
  if (finiteNumber(signals.stock_raw) === 0) return true;
  return false;
}

/**
 * The supplier marks the visible reservation banner with `is-active`. Match
 * the class token rather than the whole attribute because other themes add
 * their own classes around it.
 */
const CLASS_ATTRIBUTE_PATTERN = /\bclass\s*=\s*["']([^"']*)["']/gi;

export function hasActiveReservationNotice(html: string): boolean {
  for (const match of html.matchAll(CLASS_ATTRIBUTE_PATTERN)) {
    const classes = match[1].split(/\s+/);
    if (classes.includes("tokyo-reservation-notice") && classes.includes("is-active")) {
      return true;
    }
  }
  return false;
}
