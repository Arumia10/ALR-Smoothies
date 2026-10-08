import { AppError } from "../lib/order-rules.js";
import { formatDate } from "../public/schedule.js";

const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
const euros = (cents) => (cents / 100).toFixed(2).replace(".", ",") + " €";

export async function verifyTurnstile(token, env, origin, fetcher = fetch) {
  if (typeof token !== "string" || !token || token.length > 2048)
    throw new AppError("Veuillez effectuer la vérification de sécurité.", 400);
  let result;
  try {
    const response = await fetcher(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) throw new Error("siteverify_unavailable");
    result = await response.json();
  } catch {
    throw new AppError(
      "La vérification de sécurité est indisponible. Veuillez réessayer.",
      503,
    );
  }
  if (
    !result.success ||
    result.hostname !== new URL(origin).hostname ||
    result.action !== "order"
  )
    throw new AppError(
      "La vérification de sécurité a expiré ou a échoué. Veuillez réessayer.",
      403,
    );
}

// Build only from the validated order and fixed configuration, never client HTML/prices.
export function buildConfirmation(order, config) {
  const lines = order.items.map(
    (i) => `${i.qty} × ${i.name} — ${euros(i.price * i.qty)}`,
  );
  const date = formatDate(order.date);
  const text = `Bonjour ${order.first},\n\nVotre commande ${order.id} est enregistrée.\n\n${lines.join("\n")}\nTotal : ${euros(order.total)}\n\nRetrait : ${date}\n${order.location}\n\nPaiement au retrait. Conservez votre référence de commande.\n\nVitaminBoost — La mini-entreprise de la 2TPCM`;
  return {
    from: config.from,
    to: [order.email],
    ...(config.notify && config.notify.toLowerCase() !== order.email
      ? { bcc: [config.notify] }
      : {}),
    subject: `Votre commande VitaminBoost ${order.id}`,
    text,
    html: `<div style="font-family:Arial,sans-serif;color:#294336;max-width:600px;margin:auto;padding:24px"><h1>VitaminBoost</h1><p>Bonjour ${escapeHTML(order.first)},</p><p>Votre commande <strong>${escapeHTML(order.id)}</strong> est enregistrée.</p><ul>${lines.map((line) => `<li>${escapeHTML(line)}</li>`).join("")}</ul><p><strong>Total : ${euros(order.total)}</strong></p><h2>Votre retrait</h2><p>${escapeHTML(date)}<br>${escapeHTML(order.location)}</p><p>Paiement au retrait. Conservez votre référence de commande.</p><p>La mini-entreprise de la 2TPCM</p></div>`,
  };
}

// Durable payload + lease + provider idempotency. Never retry uncertain sends
// outside Resend's 24-hour deduplication window (leave a one-hour margin).
export async function sendConfirmation(
  db,
  orderId,
  env,
  fetcher = fetch,
  now = Date.now(),
) {
  const row = await db
    .prepare("SELECT * FROM vb_email_outbox WHERE order_id=?")
    .bind(orderId)
    .first();
  if (!row) return "not_required";
  if (row.status === "sent" || row.status === "review") return row.status;
  if (row.first_attempt !== null && now - row.first_attempt >= 23 * 3600000) {
    await db
      .prepare(
        "UPDATE vb_email_outbox SET status='review',last_error='check_provider_before_resending' WHERE order_id=? AND status!='sent'",
      )
      .bind(orderId)
      .run();
    return "review";
  }
  const claimed = await db
    .prepare(
      `UPDATE vb_email_outbox SET status='sending',
    attempts=attempts+1,first_attempt=COALESCE(first_attempt,?),lease_until=?
    WHERE order_id=? AND status IN('pending','failed','sending') AND (lease_until IS NULL OR lease_until<=?)
    RETURNING payload`,
    )
    .bind(now, now + 60000, orderId, now)
    .first();
  if (!claimed) return "pending";
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `order-confirmation/${orderId}`,
      },
      body: claimed.payload,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`provider_http_${response.status}`);
    const result = await response.json();
    if (typeof result.id !== "string" || !result.id)
      throw new Error("invalid_provider_response");
    await db
      .prepare(
        "UPDATE vb_email_outbox SET status='sent',provider_id=?,last_error=NULL,lease_until=NULL WHERE order_id=?",
      )
      .bind(result.id, orderId)
      .run();
    return "sent";
  } catch {
    // Do not turn an already saved order into an order failure or log customer data.
    await db
      .prepare(
        "UPDATE vb_email_outbox SET status='failed',last_error='send_not_confirmed',lease_until=NULL WHERE order_id=? AND status!='sent'",
      )
      .bind(orderId)
      .run();
    return "failed";
  }
}
