import { loadEnv } from "./env.mjs";

loadEnv();

async function main() {
  const { syncShopFeed } = await import("../src/lib/shop/sync");
  const result = await syncShopFeed({ force: process.argv.includes("--force") });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
