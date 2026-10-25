import { AppError } from "../lib/order-rules.js";
import { localParts, availableDates } from "../public/schedule.js";

const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

export function reminderWindow(time) {
  const now = new Date(time);
  const p = localParts(now);
  const sunday = `${p.year}-${p.month}-${p.day}`;
  if (new Date(`${sunday}T12:00:00Z`).getUTCDay() !== 0 || Number(p.hour) < 10 || Number(p.hour) >= 23) return null;
  const cutoff = now.getTime() - ((Number(p.hour) - 10) * 3600000 + now.getUTCMinutes() * 60000 + now.getUTCSeconds() * 1000 + now.getUTCMilliseconds());
  return { sunday, cutoff };
}

export function buildReminder(subscriber, env) {
  const origin = new URL(env.PUBLIC_ORIGIN).origin;
  const menu = `${origin}/#menu`;
  const unsubscribe = `${origin}/api/reminders/unsubscribe/${subscriber.token}`;
  const text = `Bonjour ${subscriber.first_name},\n\nPensez à commander votre smoothie, votre breakfast jar ou votre Ginger Shot pour la semaine à venir. Tous nos produits sont 100 % végétaux.\n\nVoir le menu et commander : ${menu}\n\nSi vous avez déjà commandé, vous pouvez simplement ignorer ce rappel.\n\nÀ bientôt,\nVitaminBoost · La mini-entreprise de la 2TPCM\n\nVous recevez ce message car le rappel du dimanche était activé lors de votre commande. Se désinscrire : ${unsubscribe}`;
  return {
    from: env.EMAIL_FROM,
    to: [subscriber.email],
    subject: "Votre rappel du dimanche · VitaminBoost",
    text,
    headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    html: `<!doctype html><html lang="fr"><body style="margin:0;background:#f8f7ef;color:#244638;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#fff;border-radius:16px"><tr><td style="padding:32px"><p style="font-size:26px;font-weight:bold;margin:0">VitaminBoost<span style="color:#a3b458">.</span></p><p style="font-size:12px;color:#667465;margin:8px 0 30px">LA MINI-ENTREPRISE DE LA 2TPCM · 100 % VÉGÉTAL</p><h1 style="font-size:28px;line-height:1.2">Vos commandes pour la semaine</h1><p>Bonjour ${escapeHTML(subscriber.first_name)},</p><p style="line-height:1.7">Pensez à réserver votre smoothie, votre breakfast jar ou votre Ginger Shot pour la semaine à venir.</p><table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#244638" style="border-radius:8px"><a href="${escapeHTML(menu)}" style="display:inline-block;padding:16px 24px;color:#fff;text-decoration:none;font-weight:bold">Voir le menu et commander →</a></td></tr></table><p style="font-size:14px;line-height:1.6;margin-top:24px">Déjà commandé ? Vous pouvez simplement ignorer ce rappel.</p><p>À bientôt,<br>L’équipe VitaminBoost</p></td></tr><tr><td style="padding:24px 32px;background:#edf0e4;font-size:12px;line-height:1.6;color:#52634e">Vous recevez ce message car le rappel du dimanche était activé lors de votre commande.<br><a href="${escapeHTML(unsubscribe)}" style="color:#244638">Se désinscrire des rappels</a></td></tr></table></td></tr></table></body></html>`,
  };
}

export async function unsubscribePage(request, env, token) {
  if (!["GET", "POST"].includes(request.method)) throw new AppError("Méthode non autorisée.", 405);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new AppError("Lien de désinscription non valide.", 404);
  if (!env.DB) throw new AppError("Service momentanément indisponible.", 503);
  if (request.method === "POST" && request.headers.has("origin") && request.headers.get("origin") !== new URL(request.url).origin)
    throw new AppError("Origine de la demande non reconnue.", 403);
  const db = env.DB.withSession("first-primary");
  const subscriber = await db.prepare("SELECT email,enabled FROM vb_reminder_subscriptions WHERE token=?").bind(token).first();
  if (!subscriber) throw new AppError("Lien de désinscription non valide.", 404);
  const done = request.method === "POST" || !subscriber.enabled;
  if (request.method === "POST") {
    await db.batch([
      db.prepare("UPDATE vb_reminder_subscriptions SET enabled=0,updated_at=? WHERE token=?").bind(Date.now(), token),
      db.prepare("UPDATE vb_weekly_reminders SET status='cancelled' WHERE email=? AND status IN('pending','failed','sending')").bind(subscriber.email),
    ]);
  }
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Rappels du dimanche · VitaminBoost</title><link rel="stylesheet" href="/styles.css"></head><body><main class="wrap section"><p>VitaminBoost · 2TPCM</p><h1>${done ? "Vous êtes désinscrit." : "Arrêter les rappels du dimanche ?"}</h1><p>${done ? "Vous ne recevrez plus les prochains rappels du dimanche. Vos commandes restent inchangées." : "Vous pourrez toujours commander sur le site. Cette action ne modifie aucune commande."}</p>${done ? "" : `<form method="post"><button class="button primary" type="submit">Me désinscrire des rappels</button></form>`}<p><a href="/">Revenir au site</a></p></main></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export async function runWeeklyReminders(env, fetcher = fetch, options = {}) {
  const clock = options.clock ?? Date.now;
  const time = options.time ?? clock();
  const window = reminderWindow(time);
  if (!window || env.ORDER_MODE !== "live" || env.ORDERS_OPEN === "false" || env.LIVE_SETUP_CONFIRMED !== "true") return { skipped: true };
  let origin;
  try { origin = new URL(env.PUBLIC_ORIGIN); } catch {}
  if (!env.DB || !env.RESEND_API_KEY || !env.EMAIL_FROM || origin?.protocol !== "https:" || origin.username || origin.password)
    throw new Error("Weekly reminder configuration incomplete");
  const closed = (env.CLOSED_DATES || "").split(",").map(s => s.trim());
  if (availableDates("Teacher", new Date(time)).every(date => closed.includes(date))) return { skipped: true };
  const db = env.DB.withSession("first-primary");
  const { sunday, cutoff } = window;
  // Snapshot the recipients eligible at Sunday 10:00; new subscriptions start next Sunday.
  await db.prepare(`INSERT OR IGNORE INTO vb_weekly_reminders(id,sunday,email)
    SELECT ? || ':' || token,?,email FROM vb_reminder_subscriptions WHERE enabled=1 AND updated_at<=?`)
    .bind(sunday, sunday, cutoff).run();
  await db.prepare(`UPDATE vb_weekly_reminders SET status='review',last_error='retry_window_expired'
    WHERE status IN('pending','failed','sending') AND (sunday<? OR (first_attempt IS NOT NULL AND first_attempt<=?))`)
    .bind(sunday, clock() - 23 * 3600000).run();
  const { results: rows } = await db.prepare(`SELECT id FROM vb_weekly_reminders
    WHERE sunday=? AND attempts<6 AND (status='pending' OR (status IN('failed','sending') AND lease_until<=?))
    ORDER BY attempts,id LIMIT 20`).bind(sunday, clock()).all();
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let sent = 0, failed = 0;
  for (const { id } of rows) {
    const subscriber = await db.prepare(`SELECT s.* FROM vb_reminder_subscriptions s
      JOIN vb_weekly_reminders r ON r.email=s.email WHERE r.id=? AND s.enabled=1`).bind(id).first();
    if (!subscriber) {
      await db.prepare("UPDATE vb_weekly_reminders SET status='cancelled' WHERE id=? AND status!='sent'").bind(id).run();
      continue;
    }
    const payload = JSON.stringify(buildReminder(subscriber, env));
    const claimTime = clock();
    const claimed = await db.prepare(`UPDATE vb_weekly_reminders
      SET status='sending',attempts=attempts+1,first_attempt=COALESCE(first_attempt,?),lease_until=?,payload=COALESCE(payload,?)
      WHERE id=? AND attempts<6 AND (status='pending' OR (status IN('failed','sending') AND lease_until<=?))
      AND EXISTS(SELECT 1 FROM vb_reminder_subscriptions s WHERE s.email=vb_weekly_reminders.email AND s.enabled=1)
      RETURNING payload`).bind(claimTime, claimTime + 120000, payload, id, claimTime).first();
    if (!claimed) continue;
    let error = "provider_unavailable", stop = false, terminal = false;
    try {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `weekly-reminder/${id}` },
        body: claimed.payload,
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const result = await response.json();
        if (typeof result.id !== "string" || !result.id) throw new Error("missing_provider_id");
        await db.prepare("UPDATE vb_weekly_reminders SET status='sent',provider_id=?,last_error=NULL,lease_until=NULL WHERE id=?")
          .bind(result.id, id).run();
        sent++;
        await sleep(650);
        continue;
      }
      error = `provider_http_${response.status}`;
      stop = response.status === 429 || response.status === 401 || response.status === 403;
      terminal = response.status >= 400 && response.status < 500 && ![408,409,429].includes(response.status);
    } catch {}
    await db.prepare("UPDATE vb_weekly_reminders SET status=?,last_error=?,lease_until=? WHERE id=? AND status='sending'")
      .bind(terminal ? "review" : "failed", error, clock() + 5 * 60000, id).run();
    failed++;
    if (stop) break;
    await sleep(650);
  }
  return { sunday, sent, failed };
}
