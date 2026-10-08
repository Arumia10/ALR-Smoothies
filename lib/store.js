import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";
import { PRODUCTS } from "../public/catalog.js";
import { COLLECTION_WEEKDAY } from "../public/schedule.js";
export { AppError } from "./order-rules.js";
import { AppError, validateOrder, cancellationReason } from "./order-rules.js";
export function createStore(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,price INTEGER NOT NULL CHECK(price BETWEEN 50 AND 5000),available INTEGER NOT NULL CHECK(available IN(0,1)));
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,date TEXT NOT NULL,fulfillment TEXT NOT NULL,room TEXT NOT NULL,total INTEGER NOT NULL CHECK(total>0),quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 40),items TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'received' CHECK(status IN('received','preparing','ready','collected','cancelled')),payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN('unpaid','paid')),demo INTEGER NOT NULL CHECK(demo IN(0,1)),created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS orders_date_status ON orders(date,status,demo);
 CREATE TABLE IF NOT EXISTS cancellations(order_id TEXT PRIMARY KEY REFERENCES orders(id),reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,order_id TEXT,action TEXT NOT NULL,created_at TEXT NOT NULL);
 `);
  for (const p of PRODUCTS)
    db.prepare(
      "INSERT OR IGNORE INTO products(id,price,available) VALUES(?,?,?)",
    ).run(p.id, p.price, Number(p.available));
  // Apply once so later availability changes made by the team survive restarts.
  if (db.prepare("PRAGMA user_version").get().user_version < 2) {
    db.exec(
      "BEGIN; UPDATE products SET available=0 WHERE id='cherry-berry'; PRAGMA user_version=2; COMMIT;",
    );
  }
  const catalog = () =>
    PRODUCTS.map((p) => ({
      ...p,
      ...db
        .prepare("SELECT price,available FROM products WHERE id=?")
        .get(p.id),
    })).map((p) => ({ ...p, available: Boolean(p.available) }));
  function place(
    input,
    key,
    { now = new Date(), demo = true, capacity = 120, closedDates = [] } = {},
  ) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new AppError(
        "Veuillez renseigner les informations de votre commande.",
      );
    if (typeof key !== "string" || !/^[a-zA-Z0-9-]{20,80}$/.test(key))
      throw new AppError("Veuillez actualiser la page et réessayer.");
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const existing = db
      .prepare("SELECT * FROM orders WHERE idempotency_key=?")
      .get(key);
    if (existing) {
      if (existing.request_hash !== hash)
        throw new AppError(
          "Cette demande a déjà été utilisée pour une autre commande.",
          409,
        );
      return receipt(existing);
    }
    const { first, last, email, room, items, total, quantity } = validateOrder(
      input,
      catalog(),
      { now, closedDates },
    );
    const order = {
      id:
        (demo ? "DEMO-" : "VB-") + randomBytes(6).toString("hex").toUpperCase(),
      total,
      date: input.date,
      demo: Number(demo),
    };
    db.exec("BEGIN IMMEDIATE");
    try {
      // Reserve the whole weekly production batch, across all collection days.
      const d = new Date(`${input.date}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (d.getUTCDay() - COLLECTION_WEEKDAY));
      const start = d.toISOString().slice(0, 10);
      d.setUTCDate(d.getUTCDate() + 2);
      const end = d.toISOString().slice(0, 10);
      const booked = db
        .prepare(
          "SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE date BETWEEN ? AND ? AND status!='cancelled' AND demo=?",
        )
        .get(start, end, Number(demo)).n;
      if (booked + quantity > capacity)
        throw new AppError(
          "La capacité de cette semaine est atteinte. Veuillez choisir une semaine ultérieure.",
          409,
        );
      db.prepare(
        "INSERT INTO orders(id,idempotency_key,request_hash,first_name,last_name,email,role,date,fulfillment,room,total,quantity,items,demo,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        order.id,
        key,
        hash,
        first,
        last,
        email,
        input.role,
        input.date,
        input.fulfillment,
        room,
        total,
        quantity,
        JSON.stringify(items),
        Number(demo),
        now.toISOString(),
      );
      db.exec("COMMIT");
      return receipt(order);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function receipt(o) {
    return {
      reference: o.id,
      total: o.total,
      date: o.date,
      demo: Boolean(o.demo),
      paymentStatus: "unpaid",
    };
  }
  function list() {
    return db
      .prepare(
        "SELECT id,first_name,last_name,email,role,date,fulfillment,room,total,quantity,items,status,payment_status,demo,created_at,(SELECT reason FROM cancellations WHERE order_id=orders.id) AS cancellation_reason FROM orders ORDER BY created_at DESC LIMIT 1000",
      )
      .all()
      .map((o) => ({ ...o, items: JSON.parse(o.items) }));
  }
  function updateOrder(id, patch) {
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
    if (!order) throw new AppError("Commande introuvable.", 404);
    const transitions = {
      received: ["preparing", "cancelled"],
      preparing: ["ready", "cancelled"],
      ready: ["collected", "cancelled"],
      collected: [],
      cancelled: [],
    };
    const next = patch.status ?? order.status,
      payment = patch.paymentStatus ?? order.payment_status;
    if (next !== order.status && !transitions[order.status].includes(next))
      throw new AppError("Ce changement de statut n’est pas autorisé.", 409);
    if (!["unpaid", "paid"].includes(payment))
      throw new AppError("Statut de paiement non valide.");
    if (next === "collected" && payment !== "paid")
      throw new AppError(
        "Enregistrez le paiement avant de marquer la commande comme retirée.",
        409,
      );
    const reason = next === "cancelled" ? cancellationReason(patch.cancellationReason) : "";
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE orders SET status=?,payment_status=? WHERE id=?").run(
        next,
        payment,
        id,
      );
      if (next === "cancelled") db.prepare("INSERT OR IGNORE INTO cancellations(order_id,reason) VALUES(?,?)").run(id, reason);
      db.prepare(
        "INSERT INTO audit(order_id,action,created_at) VALUES(?,?,?)",
      ).run(
        id,
        JSON.stringify({
          from: order.status,
          to: next,
          paymentFrom: order.payment_status,
          paymentTo: payment,
        }),
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function updateProduct(id, patch) {
    if (!PRODUCTS.some((p) => p.id === id))
      throw new AppError("Produit introuvable.", 404);
    if (
      !Number.isInteger(patch.price) ||
      patch.price < 50 ||
      patch.price > 5000 ||
      typeof patch.available !== "boolean"
    )
      throw new AppError(
        "Indiquez un prix entre 0,50 € et 50,00 € et une disponibilité valide.",
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE products SET price=?,available=? WHERE id=?").run(
        patch.price,
        Number(patch.available),
        id,
      );
      db.prepare("INSERT INTO audit(action,created_at) VALUES(?,?)").run(
        JSON.stringify({ product: id, ...patch }),
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return { db, catalog, place, list, updateOrder, updateProduct };
}
