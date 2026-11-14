/**
 * Public media URLs are content-addressed and immutable, so a width variant is
 * just a query string. Keep the widths on a fixed ladder: the image route only
 * resizes allowed widths, and repeated visits hit the browser/edge cache.
 */
export const SHOP_IMAGE_WIDTHS = [320, 480, 640, 960, 1280] as const;

export type ShopImageWidth = (typeof SHOP_IMAGE_WIDTHS)[number];

export function isShopImageUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith("/api/shop/images/"));
}

export function shopImageVariant(
  url: string | null | undefined,
  width: ShopImageWidth,
): string | null {
  if (!url) return null;
  if (!isShopImageUrl(url)) return url;
  return `${url}?w=${width}`;
}

/** Only the storage-backed image route can resize; static files cannot. */
export function shopImageSrcSet(
  url: string | null | undefined,
  widths: readonly ShopImageWidth[],
): string | undefined {
  if (!isShopImageUrl(url)) return undefined;
  return widths.map((width) => `${url}?w=${width} ${width}w`).join(", ");
}
