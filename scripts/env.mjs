import fs from "node:fs";
import path from "node:path";

export function loadEnv() {
  for (const filename of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), filename);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const at = trimmed.indexOf("=");
      const key = trimmed.slice(0, at).trim();
      let value = trimmed.slice(at + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
