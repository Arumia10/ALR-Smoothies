import { DatabaseSync, backup } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const mode = process.env.ORDER_MODE === "live" ? "live" : "preview";
const path = resolve(process.env.DATABASE_PATH || `.data/${mode}.sqlite`);
await mkdir("backups", { recursive: true, mode: 0o700 });
const destination = resolve(
  `backups/${mode}-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
);
const db = new DatabaseSync(path, { readOnly: true });
try {
  await backup(db, destination);
  console.log(`Backup saved: ${destination}`);
} finally {
  db.close();
}
