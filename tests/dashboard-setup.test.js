import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../cloudflare/setup-dashboard.sql", import.meta.url), "utf8");
const migrations = ["0001_legacy_compatibility.sql", "0002_cherry_berry_unavailable.sql"];

function legacyDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE orders(order_number TEXT PRIMARY KEY,name TEXT,email TEXT,role TEXT,pickup_date TEXT,delivery_location TEXT,order_items TEXT,total_amount TEXT,created_at TEXT);
    INSERT INTO orders VALUES('0001','Ancienne commande','test@example.invalid','Teacher','2025-05-19','Proffen Konferenz','[]','3.50','2025-05-18');
  `);
  for (const table of ["orders_old", "new_orders", "reviews", "d1_migrations", "_cf_KV"]) {
    db.exec(`CREATE TABLE ${table}(value TEXT); INSERT INTO ${table} VALUES('do not change');`);
  }
  return db;
}

const snapshot = (db) => ["orders", "orders_old", "new_orders", "reviews", "d1_migrations", "_cf_KV"].map(
  table => ({table, schema: db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table), rows: db.prepare(`SELECT * FROM ${table}`).all()}),
);

test("dashboard setup preserves all legacy tables and matches the application migrations", () => {
  const db = legacyDatabase(), reference = legacyDatabase();
  try {
    const before = snapshot(db);
    db.exec(sql);
    for (const file of migrations) reference.exec(readFileSync(new URL(`../migrations-legacy/${file}`, import.meta.url), "utf8"));
    assert.deepEqual(snapshot(db), before);
    const schema = database => database.prepare("SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'vb_%' AND name != 'vb_migrations' ORDER BY name").all().map(
      row => ({...row, sql: row.sql.replaceAll("IF NOT EXISTS ", "")}),
    );
    assert.deepEqual(schema(db), schema(reference));
    assert.deepEqual(db.prepare("SELECT * FROM vb_products ORDER BY id").all(), reference.prepare("SELECT * FROM vb_products ORDER BY id").all());
    assert.deepEqual(db.prepare("SELECT name FROM vb_migrations ORDER BY id").all().map(row => row.name), migrations);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM vb_products").get().n, 10);
    assert.equal(db.prepare("SELECT available FROM vb_products WHERE id='cherry-berry'").get().available, 0);
    db.exec("UPDATE vb_products SET price=400,available=1 WHERE id='cherry-berry'");
    const auditBefore = db.prepare("SELECT COUNT(*) n FROM vb_audit").get().n;
    db.exec(sql);
    assert.deepEqual({...db.prepare("SELECT price,available FROM vb_products WHERE id='cherry-berry'").get()}, {price:400,available:1});
    assert.equal(db.prepare("SELECT COUNT(*) n FROM vb_migrations").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM vb_audit").get().n, auditBefore);
    assert.deepEqual(snapshot(db), before);
  } finally { db.close(); reference.close(); }
});

test("dashboard setup resumes after partial installation", () => {
  const db = legacyDatabase();
  try {
    const before = snapshot(db);
    db.exec(sql.slice(0, sql.indexOf("CREATE TRIGGER IF NOT EXISTS vb_validate_order_state")));
    db.exec(sql);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'vb_%'").get().n, 4);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM vb_migrations").get().n, 2);
    assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});
