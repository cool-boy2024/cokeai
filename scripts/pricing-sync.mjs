import { loadEnv } from "./env.mjs";

loadEnv();

const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.INTERNAL_API_SECRET;

if (!secret || secret.length < 24) {
  console.error("INTERNAL_API_SECRET must be at least 24 characters");
  process.exit(1);
}

const response = await fetch(`${base}/api/internal/pricing/sync`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-internal-secret": secret,
  },
  body: JSON.stringify({ force: process.argv.includes("--force") }),
});

const text = await response.text();
console.log(text);
if (!response.ok) process.exit(1);
