import { loadEnv } from "./env.mjs";

loadEnv();

async function main() {
  const { syncAibuyProducts } = await import("../src/lib/shop/zyanai");
  const dryRun = process.argv.includes("--dry");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit 需要正整数");
  }
  const idsArg = process.argv.find((arg) => arg.startsWith("--ids="));
  const ids = idsArg
    ? idsArg
        .split("=")[1]
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
    : undefined;
  const result = await syncAibuyProducts({ dryRun, limit, ids });
  console.log(JSON.stringify(result, null, 2));
  if (result.skipped.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
