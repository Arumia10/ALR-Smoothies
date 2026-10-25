import { randomBytes } from "node:crypto";

export function reminderPreferenceSQL(orderTable) {
  if (!["orders", "vb_orders"].includes(orderTable)) throw new Error("Invalid order table");
  return `INSERT INTO vb_reminder_subscriptions(email,first_name,enabled,token,updated_at,source_order_id)
    SELECT ?,?,?,?,?,? FROM ${orderTable} WHERE id=? AND demo=0
    ON CONFLICT(email) DO UPDATE SET first_name=excluded.first_name,enabled=excluded.enabled,
      updated_at=excluded.updated_at,source_order_id=excluded.source_order_id`;
}

export function reminderPreferenceBindings(email, first, enabled, id, now) {
  return [email, first, Number(enabled), randomBytes(32).toString("hex"), now.getTime(), id, id];
}
