import { randomBytes, createHash } from "node:crypto";
import { fulfillmentOptions } from "../public/schedule.js";
import { buildConfirmation, buildCancellation } from "./integrations.js";
import { PRODUCTS } from "../public/catalog.js";
import { AppError, validateOrder, productionWeek, cancellationReason } from "../lib/order-rules.js";

export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
const receipt = (o) => ({
  reference: o.id,
  total: o.total,
  date: o.date,
  demo: Boolean(o.demo),
  paymentStatus: o.payment_status || "unpaid",
});
export function createD1Store(db, demo = true) {
  const mode = Number(demo);
  async function catalog() {
    const { results } = await db
      .prepare("SELECT id,price,available FROM vb_products")
      .all();
    return PRODUCTS.map((p) => {
      const row = results.find((r) => r.id === p.id);
      return {
        ...p,
        price: row?.price ?? p.price,
        available: Boolean(row?.available),
      };
    });
  }
  async function place(input, key, options = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new AppError("Veuillez renseigner votre commande.");
    if (typeof key !== "string" || !/^[a-zA-Z0-9-]{20,80}$/.test(key))
      throw new AppError("Veuillez actualiser la page et réessayer.");
    const hash = digest(JSON.stringify(input));
    // Separate preview and live idempotency namespaces.
    const storedKey = `${mode}:${key}`;
    const existing = () =>
      db
        .prepare("SELECT * FROM vb_orders WHERE idempotency_key=?")
        .bind(storedKey)
        .first();
    const replay = (o) => {
      if (o.request_hash !== hash)
        throw new AppError(
          "Cette demande a déjà été utilisée pour une autre commande.",
          409,
        );
      return receipt(o);
    };
    const prior = await existing();
    if (prior) return replay(prior);
    const now = options.now ?? new Date();
    const order = validateOrder(input, await catalog(), { ...options, now });
    await options.beforeInsert?.();
    const [start, end] = productionWeek(input.date);
    if (!demo) {
      const { results: historical } = await db
        .prepare(
          `SELECT order_items FROM orders legacy
        WHERE pickup_date BETWEEN ? AND ? AND NOT EXISTS
        (SELECT 1 FROM vb_orders current WHERE current.id=legacy.order_number)`,
        )
        .bind(start, end)
        .all();
      for (const row of historical) {
        let oldItems;
        try {
          oldItems = JSON.parse(row.order_items);
        } catch {}
        if (
          !Array.isArray(oldItems) ||
          !oldItems.length ||
          oldItems.some(
            (item) => !item || !Number.isInteger(item.qty) || item.qty < 1,
          )
        )
          throw new AppError(
            "L’équipe doit vérifier les anciennes commandes de cette semaine avant d’en accepter de nouvelles.",
            503,
          );
      }
    }
    const id =
      (demo ? "DEMO-" : "VB-") + randomBytes(12).toString("hex").toUpperCase();
    const items = JSON.stringify(order.items);
    const capacity = options.capacity ?? 120;
    const pickup = fulfillmentOptions(input.role, input.date).find(
      (o) => o.id === input.fulfillment,
    );
    const location = `${pickup.label}${order.room ? " · " + order.room : ""} · ${pickup.time}`;
    const legacyItems = JSON.stringify(
      order.items.map((item) => ({
        name: item.name,
        qty: item.qty,
        subtotal: ((item.price * item.qty) / 100).toFixed(2),
      })),
    );
    const mail =
      !demo && options.email
        ? JSON.stringify(
            buildConfirmation(
              {
                ...order,
                id,
                date: input.date,
                fulfillment: input.fulfillment,
                location,
              },
              options.email,
            ),
          )
        : null;
    // One atomic SQLite statement: capacity, price, availability and insertion
    // are checked together even across concurrent requests in different isolates.
    await db
      .prepare(
        `INSERT INTO vb_orders(id,idempotency_key,request_hash,first_name,last_name,email,role,date,fulfillment,room,total,quantity,items,demo,created_at,delivery_location,legacy_items,mail_payload)
   SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
   WHERE (SELECT COALESCE(SUM(quantity),0) FROM vb_orders WHERE date BETWEEN ? AND ? AND status!='cancelled' AND demo=?) + (CASE WHEN ?=0 THEN (
    SELECT COALESCE(SUM(CAST(json_extract(item.value,'$.qty') AS INTEGER)),0)
    FROM orders legacy, json_each(CASE WHEN legacy.pickup_date BETWEEN ? AND ? THEN legacy.order_items ELSE '[]' END) item
    WHERE legacy.pickup_date BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM vb_orders current WHERE current.id=legacy.order_number)
   ) ELSE 0 END) + ? <= ?
   AND NOT EXISTS (SELECT 1 FROM json_each(?) AS item LEFT JOIN vb_products p ON p.id=json_extract(item.value,'$.id')
    WHERE p.id IS NULL OR p.available!=1 OR p.price!=json_extract(item.value,'$.price'))
   ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .bind(
        id,
        storedKey,
        hash,
        order.first,
        order.last,
        order.email,
        input.role,
        input.date,
        input.fulfillment,
        order.room,
        order.total,
        order.quantity,
        items,
        mode,
        now.toISOString(),
        location,
        legacyItems,
        mail,
        start,
        end,
        mode,
        mode,
        start,
        end,
        start,
        end,
        order.quantity,
        capacity,
        items,
      )
      .run();
    const saved = await existing();
    if (saved) return replay(saved);
    // Give a specific price/availability error when that caused the rejection.
    validateOrder(input, await catalog(), { ...options, now });
    throw new AppError(
      "La capacité de cette semaine est atteinte. Veuillez choisir une semaine ultérieure.",
      409,
    );
  }
  async function list() {
    const { results } = await db
      .prepare(
        "SELECT id,first_name,last_name,email,role,date,fulfillment,room,total,quantity,items,status,payment_status,demo,created_at,(SELECT status FROM vb_email_outbox WHERE order_id=vb_orders.id) AS email_status,(SELECT reason FROM vb_cancellation_emails WHERE order_id=vb_orders.id) AS cancellation_reason,(SELECT CASE WHEN payload IS NOT NULL THEN status END FROM vb_cancellation_emails WHERE order_id=vb_orders.id) AS cancellation_email_status FROM vb_orders WHERE demo=? ORDER BY created_at DESC LIMIT 1000",
      )
      .bind(mode)
      .all();
    return results.map((o) => ({ ...o, items: JSON.parse(o.items) }));
  }
  async function updateOrder(id, patch, emailConfig) {
    const order = await db
      .prepare(
        "SELECT * FROM vb_orders WHERE id=? AND demo=?",
      )
      .bind(id, mode)
      .first();
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
    if (!["paid", "unpaid"].includes(payment))
      throw new AppError("Statut de paiement non valide.");
    if (next === "collected" && payment !== "paid")
      throw new AppError(
        "Enregistrez le paiement avant de marquer la commande comme retirée.",
        409,
      );
    const cancelling = next === "cancelled";
    const reason = cancelling ? cancellationReason(patch.cancellationReason) : "";
    if (cancelling && order.status === "cancelled") return { cancelled: true };
    if (cancelling && !demo && !emailConfig?.from)
      throw new AppError("L’envoi des e-mails doit être configuré avant l’annulation.", 503);
    const update = db.prepare(
      "UPDATE vb_orders SET status=?,payment_status=? WHERE id=? AND demo=? AND status=? AND payment_status=? RETURNING id"
    ).bind(next, payment, id, mode, order.status, order.payment_status);
    let result;
    if (cancelling) {
      const payload = demo ? null : JSON.stringify(buildCancellation({ ...order, payment_status: payment }, reason, emailConfig));
      const results = await db.batch([
        update,
        db.prepare("INSERT OR IGNORE INTO vb_cancellation_emails(order_id,reason,payload,created_at) SELECT id,?,?,? FROM vb_orders WHERE id=? AND demo=? AND status='cancelled'")
          .bind(reason, payload, new Date().toISOString(), id, mode),
      ]);
      result = results[0].results[0];
    } else result = await update.first();
    if (!result)
      throw new AppError("Cette commande vient de changer. Actualisez puis réessayez.", 409);
    return { cancelled: cancelling };
  }

  async function updateProduct(id, patch) {
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
    const result = await db
      .prepare(
        "UPDATE vb_products SET price=?,available=? WHERE id=? RETURNING id",
      )
      .bind(patch.price, Number(patch.available), id)
      .first();
    if (!result) throw new AppError("Produit introuvable.", 404);
  }
  return { catalog, place, list, updateOrder, updateProduct };
}
