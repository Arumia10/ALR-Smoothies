import { AppError } from "../lib/order-rules.js";
import { PRODUCTS } from "../public/catalog.js";
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
  const text = `Bonjour ${order.first},\n\nVotre commande ${order.id} est enregistrée.\n\n${lines.join("\n")}\nTotal : ${euros(order.total)}\n\nRetrait : ${date}\n${order.location}\n\nPaiement au retrait. Conservez votre référence de commande.\n\nRetour des bocaux : Après votre smoothie ou votre breakfast jar, rincez brièvement le bocal et son couvercle. Déposez-les ensuite dans les bacs verts à côté du réfrigérateur, à l’extérieur du Proffenkonferenz.\n\nVitaminBoost — La mini-entreprise de la 2TPCM`;
  return {
    from: config.from,
    to: [order.email],
    ...(config.notify && config.notify.toLowerCase() !== order.email
      ? { bcc: [config.notify] }
      : {}),
    subject: `Votre commande VitaminBoost ${order.id}`,
    text,
    html: confirmationHTML(order, date),
  };
}

// Durable payload + lease + provider idempotency. Never retry uncertain sends
// outside Resend's 24-hour deduplication window (leave a one-hour margin).
async function sendQueuedEmail(
  db,
  orderId,
  env,
  fetcher = fetch,
  now = Date.now(),
  cancellation = false,
) {
  const table = cancellation ? "vb_cancellation_emails" : "vb_email_outbox";
  const row = await db
    .prepare(`SELECT * FROM ${table} WHERE order_id=?`)
    .bind(orderId)
    .first();
  if (!row || !row.payload) return "not_required";
  if (row.status === "sent" || row.status === "review") return row.status;
  if (row.first_attempt !== null && now - row.first_attempt >= 23 * 3600000) {
    await db
      .prepare(
        `UPDATE ${table} SET status='review',last_error='check_provider_before_resending' WHERE order_id=? AND status!='sent'`,
      )
      .bind(orderId)
      .run();
    return "review";
  }
  const claimed = await db
    .prepare(
      `UPDATE ${table} SET status='sending',
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
        "Idempotency-Key": `${cancellation ? "order-cancellation" : "order-confirmation"}/${orderId}`,
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
        `UPDATE ${table} SET status='sent',provider_id=?,last_error=NULL,lease_until=NULL WHERE order_id=?`,
      )
      .bind(result.id, orderId)
      .run();
    return "sent";
  } catch {
    // Do not turn an already saved order into an order failure or log customer data.
    await db
      .prepare(
        `UPDATE ${table} SET status='failed',last_error='send_not_confirmed',lease_until=NULL WHERE order_id=? AND status!='sent'`,
      )
      .bind(orderId)
      .run();
    return "failed";
  }
}

export function sendConfirmation(db, id, env, fetcher = fetch, now = Date.now()) {
  return sendQueuedEmail(db, id, env, fetcher, now);
}
export function sendCancellation(db, id, env, fetcher = fetch, now = Date.now()) {
  return sendQueuedEmail(db, id, env, fetcher, now, true);
}
export function buildCancellation(order, reason, config) {
  const explanation = reason || "L’équipe ne peut malheureusement pas honorer cette commande.";
  return {
    from: config.from,
    to: [order.email],
    subject: `Votre commande VitaminBoost ${order.id} a été annulée`,
    text: `Bonjour ${order.first_name},\n\nVotre commande ${order.id}, prévue pour le ${formatDate(order.date)}, a été annulée par l’équipe VitaminBoost.\n\n${explanation}\n\n${order.payment_status === "paid" ? "Si vous avez déjà payé, contactez l’équipe pour organiser le remboursement." : "Aucun paiement n’est demandé pour cette commande."}\n\nL’équipe VitaminBoost — 2TPCM`,
    html: `<div style="font-family:Arial,sans-serif;color:#294336;max-width:600px;margin:auto;padding:24px"><h1>Commande annulée</h1><p>Bonjour ${escapeHTML(order.first_name)},</p><p>Votre commande <strong>${escapeHTML(order.id)}</strong>, prévue pour le ${escapeHTML(formatDate(order.date))}, a été annulée par l’équipe VitaminBoost.</p><p style="white-space:pre-wrap">${escapeHTML(explanation)}</p><p>${order.payment_status === "paid" ? "Si vous avez déjà payé, contactez l’équipe pour organiser le remboursement." : "Aucun paiement n’est demandé pour cette commande."}</p><p>L’équipe VitaminBoost — 2TPCM</p></div>`,
  };
}

function confirmationHTML(order, date) {
  const images = new Map(PRODUCTS.map(product => [product.id, product.image]));
  const rows = order.items.map(item => {
    const image = images.get(item.id);
    const photo = image ? '<img src="https://vitaminboostalr.com/assets/' + encodeURIComponent(image) + '" width="88" alt="' + escapeHTML(item.name) + '" style="display:block;width:88px;max-width:100%;height:auto;border:0;border-radius:12px">' : '';
    return '<tr><td width="96" style="padding:16px 8px 16px 0;border-bottom:1px solid #e2e5d9;vertical-align:middle">' + photo + '</td><td style="padding:16px 8px;border-bottom:1px solid #e2e5d9;vertical-align:middle"><strong style="font-size:16px">' + escapeHTML(item.name) + '</strong><br><span style="font-size:13px;color:#657267;line-height:24px">' + item.qty + ' × ' + euros(item.price) + '</span></td><td align="right" style="padding:16px 0;border-bottom:1px solid #e2e5d9;vertical-align:middle;white-space:nowrap;font-weight:bold;font-size:15px">' + euros(item.price * item.qty) + '</td></tr>';
  }).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Votre commande VitaminBoost</title></head>
<body style="margin:0;padding:0;background-color:#f2f3eb;color:#244737;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">Votre commande est confirmée. Retrouvez vos produits et les informations de retrait.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f2f3eb"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e5d9;border-radius:20px;overflow:hidden">
<tr><td style="padding:32px 24px;background-color:#244737;color:#ffffff"><a href="https://vitaminboostalr.com" style="text-decoration:none;color:#ffffff;font-family:Georgia,serif;font-size:35px;font-weight:bold">VitaminBoost</a><p style="margin:10px 0 0;font-size:11px;letter-spacing:2px;color:#dae7cb">LA MINI-ENTREPRISE DE LA 2TPCM · ALR</p></td></tr>
<tr><td style="padding:28px 24px 8px"><p style="margin:0 0 12px;font-size:11px;letter-spacing:2px;font-weight:bold;color:#597547">COMMANDE CONFIRMÉE</p><h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:30px;line-height:1.2;font-weight:normal">Merci pour votre commande !</h1><p style="margin:0;font-size:15px;line-height:24px">Bonjour ${escapeHTML(order.first)},<br>Votre commande est bien enregistrée. Voici votre récapitulatif.</p><p style="margin:16px 0 0;font-size:12px;color:#657267;word-break:break-all">Référence : <strong>${escapeHTML(order.id)}</strong></p></td></tr>
<tr><td style="padding:8px 24px 24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}<tr><td colspan="2" style="padding-top:22px;font-size:16px;font-weight:bold">Total à payer au retrait</td><td align="right" style="padding-top:22px;font-size:24px;font-weight:bold;white-space:nowrap">${euros(order.total)}</td></tr></table></td></tr>
<tr><td style="padding:0 24px 24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="background-color:#eaf0de;padding:22px;border-radius:14px"><h2 style="margin:0 0 12px;font-size:18px">Votre retrait</h2><p style="margin:0;font-size:16px;font-weight:bold;line-height:24px">${escapeHTML(date)}</p><p style="margin:8px 0 0;font-size:14px;line-height:22px">${escapeHTML(order.location)}</p><p style="margin:16px 0 0;font-size:13px;line-height:21px">Le paiement s’effectue au retrait. Conservez cet e-mail pour retrouver votre référence.</p></td></tr></table></td></tr>
<tr><td style="padding:0 24px 28px"><h2 style="margin:0 0 10px;font-size:18px">Un bocal à rapporter</h2><p style="margin:0;font-size:14px;line-height:23px;color:#59675c">Après votre smoothie ou votre breakfast jar, <strong>rincez brièvement le bocal et son couvercle</strong>. Déposez-les dans les <strong>bacs verts à côté du réfrigérateur, à l’extérieur du Proffenkonferenz</strong>.</p><p style="margin:12px 0 0;font-size:14px;line-height:23px;color:#59675c">Merci de nous aider à les réutiliser.</p></td></tr>
<tr><td style="padding:22px 24px;background-color:#f7f8f2;border-top:1px solid #e2e5d9"><p style="margin:0;font-size:14px;font-weight:bold">À bientôt,<br>L’équipe VitaminBoost · 2TPCM</p><p style="margin:12px 0 0;font-size:12px;line-height:20px;color:#657267">Une question ? Répondez à cet e-mail.<br><a href="https://vitaminboostalr.com" style="color:#244737">vitaminboostalr.com</a></p></td></tr>
</table></td></tr></table></body></html>`;
}
