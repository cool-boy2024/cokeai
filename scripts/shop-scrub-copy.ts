import { loadEnv } from "./env.mjs";
import { getPool, query, withTransaction } from "@/lib/db";
import {
  sanitizeSupplierCopy,
  type SupplierIdentity,
} from "@/lib/shop/sanitize";

/**
 * Scrubs supplier identity from existing buyer-facing shop_products copy.
 *
 * Dry-run by default. Reads every buyer-visible text / JSONB field, masks
 * supplier store names, domains, links and contact handles using the identities
 * from shop_product_sources (inactive sources included), then reports which
 * fields would change. Pass --apply to write inside a transaction.
 *
 *   npx tsx scripts/shop-scrub-copy.ts                  # dry-run, all products
 *   npx tsx scripts/shop-scrub-copy.ts --slug=foo       # dry-run, one product
 *   npx tsx scripts/shop-scrub-copy.ts --apply          # write, all products
 *
 * Every other product column (price, status, availability, timestamps) is left
 * untouched.
 */

loadEnv();

type TextField =
  | "name"
  | "subtitle"
  | "description"
  | "warranty_note"
  | "customer_notice"
  | "refund_policy";

type JsonField = "includes" | "usage_notes" | "input_fields";

type Field = TextField | JsonField;

const TEXT_FIELDS: TextField[] = [
  "name",
  "subtitle",
  "description",
  "warranty_note",
  "customer_notice",
  "refund_policy",
];

// Buyer-visible JSONB fields. input_fields labels render on the buy form.
const JSON_FIELDS: JsonField[] = ["includes", "usage_notes", "input_fields"];

const ALL_FIELDS: Field[] = [...TEXT_FIELDS, ...JSON_FIELDS];

// Human-readable copy on input_fields; `key` is a machine identifier.
const INPUT_FIELD_COPY_KEYS = ["label", "placeholder", "help"] as const;

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  warranty_note: string;
  customer_notice: string;
  refund_policy: string;
  includes: unknown;
  usage_notes: unknown;
  input_fields: unknown;
};

type SourceRow = {
  product_id: string;
  source_store: string | null;
  url: string | null;
};

type ProductChange = {
  id: string;
  slug: string;
  fields: Array<{ field: Field; before: unknown; after: unknown }>;
};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const slugArg = args.find((arg) => arg.startsWith("--slug="))?.slice("--slug=".length) || null;
const help = args.includes("--help") || args.includes("-h");

if (help) {
  console.log(
    [
      "Usage: npx tsx scripts/shop-scrub-copy.ts [--apply] [--slug=<slug>]",
      "",
      "  (default)  dry-run: print products whose buyer copy would change",
      "  --apply    write the scrubbed copy inside one transaction",
      "  --slug=    only process the product with this slug",
    ].join("\n"),
  );
  process.exit(0);
}

function scrubText(text: string, identities: SupplierIdentity[]): string {
  return identities.reduce(
    (value, identity) => sanitizeSupplierCopy(value, identity),
    text,
  );
}

/** Masks a JSON string list, preserving array shape and dropping empty items. */
function scrubStringList(value: unknown, identities: SupplierIdentity[]): unknown[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? scrubText(item, identities) : item))
    .filter((item) => item !== "");
}

/** Masks buyer-visible input field copy; keeps keys and object shape. */
function scrubInputFields(value: unknown, identities: SupplierIdentity[]): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const field = { ...(item as Record<string, unknown>) };
    for (const key of INPUT_FIELD_COPY_KEYS) {
      if (typeof field[key] === "string") {
        field[key] = scrubText(field[key] as string, identities);
      }
    }
    return field;
  });
}

function scrubProduct(row: ProductRow, identities: SupplierIdentity[]): ProductRow {
  return {
    ...row,
    ...Object.fromEntries(
      TEXT_FIELDS.map((field) => [field, scrubText(row[field], identities)]),
    ),
    includes: scrubStringList(row.includes, identities),
    usage_notes: scrubStringList(row.usage_notes, identities),
    input_fields: scrubInputFields(row.input_fields, identities),
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function stringify(value: unknown): string {
  return (typeof value === "string" ? value : JSON.stringify(value) ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Short before/after excerpts centred on the first difference, so the report
 * shows what was masked instead of two identical 80-char prefixes.
 */
function pairExcerpts(before: unknown, after: unknown): [string, string] {
  const a = stringify(before);
  const b = stringify(after);
  let at = 0;
  const max = Math.min(a.length, b.length);
  while (at < max && a[at] === b[at]) at += 1;
  const start = Math.max(0, at - 20);
  const window = (text: string) => {
    const slice = text.slice(start, start + 80);
    return `${start > 0 ? "..." : ""}${slice}${start + 80 < text.length ? "..." : ""}`;
  };
  return [window(a), window(b)];
}

function diffProduct(row: ProductRow, identities: SupplierIdentity[]): ProductChange | null {
  const scrubbed = scrubProduct(row, identities);
  const fields = ALL_FIELDS.filter((field) => !sameValue(row[field], scrubbed[field])).map(
    (field) => ({ field, before: row[field], after: scrubbed[field] }),
  );
  return fields.length > 0 ? { id: row.id, slug: row.slug, fields } : null;
}

async function loadIdentities(): Promise<Map<string, SupplierIdentity[]>> {
  const rows = await query<SourceRow>(
    `SELECT s.product_id, o.source_store, o.url
       FROM shop_product_sources s
       JOIN shop_offers o ON o.id = s.offer_id
      ORDER BY s.created_at ASC`,
  );
  const byProduct = new Map<string, SupplierIdentity[]>();
  for (const row of rows.rows) {
    const list = byProduct.get(row.product_id) ?? [];
    // Several sources may point at the same shop; dedupe identical pairs.
    if (!list.some((item) => item.store === row.source_store && item.url === row.url)) {
      list.push({ store: row.source_store, url: row.url });
    }
    byProduct.set(row.product_id, list);
  }
  return byProduct;
}

async function writeChanges(changes: ProductChange[]): Promise<void> {
  await withTransaction(async (client) => {
    for (const change of changes) {
      const columns: string[] = [];
      const values: unknown[] = [change.id];
      for (const { field, after } of change.fields) {
        const isJson = (JSON_FIELDS as string[]).includes(field);
        values.push(isJson ? JSON.stringify(after) : after);
        columns.push(`${field} = $${values.length}${isJson ? "::jsonb" : ""}`);
      }
      await client.query(
        `UPDATE shop_products SET ${columns.join(", ")} WHERE id = $1`,
        values,
      );
    }
  });
}

async function main(): Promise<void> {
  const products = await query<ProductRow>(
    `SELECT id, slug, name, subtitle, description, warranty_note,
            customer_notice, refund_policy, includes, usage_notes, input_fields
       FROM shop_products
      WHERE ($1::text IS NULL OR slug = $1)
      ORDER BY slug ASC`,
    [slugArg],
  );

  const identities = await loadIdentities();
  const changes: ProductChange[] = [];

  for (const row of products.rows) {
    const sources = identities.get(row.id) ?? [];
    // No source: still run the sanitizer so generic external links and
    // supplier wording are masked; official product domains stay intact.
    const change = diffProduct(row, sources.length > 0 ? sources : [{}]);
    if (change) changes.push(change);
  }

  if (changes.length === 0) {
    console.log(`No buyer copy to scrub (${products.rows.length} product(s) checked).`);
    return;
  }

  const slugWidth = Math.min(40, Math.max(4, ...changes.map((c) => c.slug.length)));
  const fieldWidth = Math.max(...changes.flatMap((c) => c.fields.map((f) => f.field.length)));
  const lines = changes.flatMap((change) =>
    change.fields.map(({ field, before, after }) => {
      const [left, right] = pairExcerpts(before, after);
      return `${change.slug.padEnd(slugWidth)}  ${field.padEnd(fieldWidth)}  ${left} -> ${right}`;
    }),
  );
  console.log(
    `${"slug".padEnd(slugWidth)}  ${"field".padEnd(fieldWidth)}  before -> after`,
  );
  console.log(lines.join("\n"));

  const fieldCount = changes.reduce((total, change) => total + change.fields.length, 0);
  console.log(
    `\n${apply ? "Applying" : "Dry-run"}${slugArg ? ` (slug=${slugArg})` : ""}: ` +
      `${changes.length} product(s), ${fieldCount} field(s) ${apply ? "updated." : "would change."}`,
  );

  if (!apply) {
    console.log("Re-run with --apply to write these changes.");
    return;
  }

  await writeChanges(changes);
  console.log("Committed.");
}

main()
  .then(async () => {
    await getPool().end();
    process.exit(0);
  })
  .catch(async (error) => {
    // Never echo the connection string; only the driver's message.
    console.error(error instanceof Error ? error.message : String(error));
    // getPool() throws synchronously when DATABASE_URL is missing.
    try {
      await getPool().end();
    } catch {
      // Nothing to close.
    }
    process.exit(1);
  });
