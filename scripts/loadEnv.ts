/**
 * Next loads .env.local automatically; `npx tsx` does not. Without this a CLI
 * run would silently miss REDIS_URL and read a stale on-disk snapshot while the
 * website served the uploaded one — same command, two different answers.
 *
 * Import for side effects, first, before anything that reads process.env.
 */
import fs from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) continue;

  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    // First file wins, and a real environment variable always wins over a file.
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}
