import { loadEnv } from "./env.mjs";

loadEnv();

async function main() {
  const { syncYbkjsProducts } = await import("../src/lib/shop/ybkjs");
  const dryRun = process.argv.includes("--dry");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit 需要正整数");
  }
  const result = await syncYbkjsProducts({ dryRun, limit });
  console.log(JSON.stringify(result, null, 2));
  if (result.skipped.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
