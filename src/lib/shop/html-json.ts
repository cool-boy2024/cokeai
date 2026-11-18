/**
 * Pulls one JSON object out of a page's inline script.
 *
 * Supplier storefronts (the shared Tokyo theme behind zyanai / aibuy / aibuji)
 * embed the whole product record as `setVar("_var_item", { ... })`. We locate
 * the marker, then walk braces so strings and escapes inside the object never
 * throw the scan off. Returns null instead of throwing when the marker or the
 * object is missing, because not every source page is the same theme.
 */
export function scanJson(html: string, marker: string): unknown | null {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const objectStart = html.indexOf("{", start);
  if (objectStart < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = objectStart; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(objectStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
