/**
 * Temporary merchandising switch (owner request, 2026-10-30).
 *
 * The API/model business is paused on the public site: no model table, credit
 * packs, pricing page or API tutorial should be shown. The shop, account area,
 * gateway and admin tools keep working. Flip this to true to restore those
 * public surfaces; no other code changes are needed.
 */
export const PUBLIC_API_SALES_ENABLED = false;
