import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { createD1Store, digest } from "./store.js";
import { verifyTurnstile, sendConfirmation, sendCancellation } from "./integrations.js";
import { AppError } from "../lib/order-rules.js";
import { availableDates } from "../public/schedule.js";
const HASH_PATTERN = /^[a-f0-9]{32}:[a-f0-9]{128}$/;
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
const cookie = (token, secure, expire = false) =>
  `vb_session=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${expire ? 0 : 28800}${secure ? "; Secure" : ""}`;
async function bodyJSON(request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new AppError("Format de la demande non valide.", 415);
  if (Number(request.headers.get("content-length")) > 16384)
    throw new AppError("La demande est trop volumineuse.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Demande non valide.");
  const chunks = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16384) {
      await reader.cancel();
      throw new AppError("La demande est trop volumineuse.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError("Demande non valide.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AppError("Demande non valide.");
  return body;
}
async function allow(db, key, max, period) {
  const now = Date.now();
  const result = await db.batch([
    db.prepare("DELETE FROM vb_rate_limits WHERE expires <= ?").bind(now),
    db
      .prepare(
        `INSERT INTO vb_rate_limits(key,count,expires) VALUES(?,1,?)
   ON CONFLICT(key) DO UPDATE SET count=vb_rate_limits.count+1 RETURNING count`,
      )
      .bind(key, now + period),
  ]);
  if (result[1].results[0].count > max)
    throw new AppError(
      "Trop de tentatives. Patientez un moment avant de réessayer.",
      429,
    );
}
function secureResponse(response, url) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  );
  if (url.protocol === "https:")
    headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
async function handle(request, env, url, fetcher) {
  const path = url.pathname;
  // Serve only the published frontend. No application source or database is an asset.
  if (!path.startsWith("/api/")) {
    if (!["GET", "HEAD"].includes(request.method))
      throw new AppError("Méthode non autorisée.", 405);
    const allowed =
      /^\/(?:index\.html|admin(?:\.html)?|styles\.css|admin\.css|app\.js|admin\.js|catalog\.js|schedule\.js|assets\/[a-zA-Z0-9 .%_-]+\.(?:jpg|png|svg))$/;
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      throw new AppError("Page introuvable.", 404);
    }
    if (path !== "/" && !allowed.test(decoded))
      throw new AppError("Page introuvable.", 404);
    if (path === "/" || path === "/admin") {
      const assetURL = new URL(request.url);
      assetURL.pathname = path === "/" ? "/index.html" : "/admin.html";
      return env.ASSETS.fetch(new Request(assetURL, request));
    }
    return env.ASSETS.fetch(request);
  }
  const demo = env.ORDER_MODE !== "live";
  const origin = env.PUBLIC_ORIGIN || (demo ? url.origin : "");
  const adminHash = env.ADMIN_PASSWORD_HASH || "";
  const capacity = Number(env.WEEKLY_CAPACITY || 120);
  if (
    !env.DB ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 10000 ||
    (adminHash && !HASH_PATTERN.test(adminHash))
  )
    throw new AppError(
      "La configuration du site doit être complétée par l’équipe.",
      503,
    );
  if (
    !demo &&
    (!origin.startsWith("https://") ||
      !adminHash ||
      env.LIVE_SETUP_CONFIRMED !== "true" ||
      !env.TURNSTILE_SECRET ||
      !env.TURNSTILE_SITE_KEY ||
      !env.RESEND_API_KEY ||
      !env.EMAIL_FROM ||
      !env.ORDER_NOTIFICATION_EMAIL)
  )
    throw new AppError(
      "Les commandes réelles ne sont pas encore activées.",
      503,
    );
  if (origin !== url.origin)
    throw new AppError("Adresse du site non reconnue.", 403);
  const write = ["POST", "PATCH", "DELETE", "PUT"].includes(request.method);
  if (write && request.headers.get("origin") !== origin)
    throw new AppError("Origine de la demande non reconnue.", 403);
  const body = write ? await bodyJSON(request) : null;
  // Use the primary for consistent reads after writes and across admin requests.
  const db = env.DB.withSession("first-primary");
  const store = createD1Store(db, demo);
  const closedDates = (env.CLOSED_DATES || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const orderingOpen = env.ORDERS_OPEN !== "false";
  // Cloudflare supplies this header at the edge; never use X-Forwarded-For.
  const ip = digest(request.headers.get("CF-Connecting-IP") || "local");
  if (path === "/api/catalog" && request.method === "GET")
    return json({
      products: await store.catalog(),
      demo,
      orderingOpen,
      turnstileSiteKey: demo ? null : env.TURNSTILE_SITE_KEY,
      legacyCompatible: true,
      dates: Object.fromEntries(
        ["Student", "Teacher", "Other"].map((role) => [
          role,
          availableDates(role).filter((d) => !closedDates.includes(d)),
        ]),
      ),
    });
  if (path === "/api/orders" && request.method === "POST") {
    await allow(db, `order:${ip}`, 120, 10 * 60000);
    if (!orderingOpen)
      throw new AppError(
        "Les commandes sont actuellement suspendues. Veuillez revenir plus tard.",
        503,
      );
    const { cf_token, ...orderInput } = body;
    const saved = await store.place(
      orderInput,
      request.headers.get("idempotency-key"),
      {
        capacity,
        closedDates,
        beforeInsert: demo
          ? undefined
          : () => verifyTurnstile(cf_token, env, origin, fetcher),
        email: demo
          ? undefined
          : { from: env.EMAIL_FROM, notify: env.ORDER_NOTIFICATION_EMAIL },
      },
    );
    let emailStatus = "not_required";
    if (!demo) {
      try {
        emailStatus = await sendConfirmation(db, saved.reference, env, fetcher);
      } catch {
        emailStatus = "pending";
      }
    }
    return json({ ...saved, emailStatus }, 201);
  }
  const authVersion = digest(adminHash + ":" + env.ORDER_MODE);
  if (path === "/api/admin/login" && request.method === "POST") {
    await allow(db, `login:${ip}`, 5, 15 * 60000);
    if (!adminHash)
      throw new AppError(
        "La connexion à l’espace équipe n’a pas encore été configurée.",
        503,
      );
    const [salt, expected] = adminHash.split(":");
    const password =
      typeof body.password === "string" && body.password.length <= 256
        ? body.password
        : "";
    if (
      !timingSafeEqual(
        scryptSync(password, salt, 64),
        Buffer.from(expected, "hex"),
      )
    )
      throw new AppError("Mot de passe incorrect.", 401);
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(24).toString("hex");
    await db.batch([
      db
        .prepare("DELETE FROM vb_sessions WHERE expires<=? OR auth_version!=?")
        .bind(Date.now(), authVersion),
      db
        .prepare(
          "INSERT INTO vb_sessions(token_hash,csrf,expires,auth_version) VALUES(?,?,?,?)",
        )
        .bind(digest(token), csrf, Date.now() + 8 * 3600000, authVersion),
    ]);
    return json({ csrf }, 200, {
      "Set-Cookie": cookie(token, url.protocol === "https:"),
    });
  }
  if (path.startsWith("/api/admin/")) {
    const token = (request.headers.get("cookie") || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("vb_session="))
      ?.slice(11);
    const session =
      token && /^[a-f0-9]{64}$/.test(token)
        ? await db
            .prepare(
              "SELECT csrf FROM vb_sessions WHERE token_hash=? AND expires>? AND auth_version=?",
            )
            .bind(digest(token), Date.now(), authVersion)
            .first()
        : null;
    if (!session)
      throw new AppError("Veuillez vous connecter à l’espace équipe.", 401);
    if (write && request.headers.get("x-csrf-token") !== session.csrf)
      throw new AppError(
        "Veuillez vous reconnecter avant de modifier les données.",
        403,
      );
    if (path === "/api/admin/session" && request.method === "GET")
      return json({ csrf: session.csrf, demo });
    if (path === "/api/admin/logout" && request.method === "POST") {
      await db
        .prepare("DELETE FROM vb_sessions WHERE token_hash=?")
        .bind(digest(token))
        .run();
      return json({ ok: true }, 200, {
        "Set-Cookie": cookie("", url.protocol === "https:", true),
      });
    }
    if (path.startsWith("/api/admin/email/") && request.method === "POST") {
      if (demo)
        throw new AppError(
          "Les commandes de test n’envoient pas d’e-mail.",
          400,
        );
      const order = await db.prepare("SELECT status FROM vb_orders WHERE id=? AND demo=0").bind(path.slice("/api/admin/email/".length)).first();
      if (!order || order.status === "cancelled") throw new AppError("Cette confirmation ne peut plus être envoyée.", 409);
      await allow(db, `email:${ip}`, 10, 60000);
      const emailStatus = await sendConfirmation(
        db,
        path.slice("/api/admin/email/".length),
        env,
        fetcher,
      );
      return json({ emailStatus });
    }
    if (path.startsWith("/api/admin/cancellation-email/") && request.method === "POST") {
      if (demo) throw new AppError("Les commandes de test n’envoient pas d’e-mail.", 400);
      await allow(db, `email:${ip}`, 10, 60000);
      const id = path.slice("/api/admin/cancellation-email/".length);
      const order = await db.prepare("SELECT id FROM vb_orders WHERE id=? AND demo=0 AND status='cancelled'").bind(id).first();
      if (!order) throw new AppError("Commande annulée introuvable.", 404);
      return json({ emailStatus: await sendCancellation(db, id, env, fetcher) });
    }
    if (path === "/api/admin/legacy-orders" && request.method === "GET") {
      const { results } = demo
        ? { results: [] }
        : await db
            .prepare(
              `
        SELECT * FROM orders legacy WHERE NOT EXISTS
        (SELECT 1 FROM vb_orders current WHERE current.id=legacy.order_number)
        ORDER BY created_at DESC LIMIT 200`,
            )
            .all();
      return json({ orders: results });
    }
    if (path === "/api/admin/orders" && request.method === "GET")
      return json({ orders: await store.list(), demo });
    if (path.startsWith("/api/admin/orders/") && request.method === "PATCH") {
      const id = path.slice("/api/admin/orders/".length);
      const result = await store.updateOrder(id, body, { from: env.EMAIL_FROM });
      let cancellationEmailStatus = "not_required";
      if (result.cancelled && !demo) {
        try { cancellationEmailStatus = await sendCancellation(db, id, env, fetcher); }
        catch { cancellationEmailStatus = "pending"; }
      }
      return json({ ok: true, cancellationEmailStatus });
    }
    if (path.startsWith("/api/admin/products/") && request.method === "PATCH") {
      await store.updateProduct(
        path.slice("/api/admin/products/".length),
        body,
      );
      return json({ ok: true });
    }
  }
  throw new AppError("Élément introuvable.", 404);
}
export function createWorker(fetcher = fetch) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      try {
        return secureResponse(await handle(request, env, url, fetcher), url);
      } catch (error) {
        if (!error.status) console.error("Worker request failed:", error.name);
        return secureResponse(
          json(
            {
              error: error.status
                ? error.message
                : "Une erreur est survenue. Veuillez réessayer.",
            },
            error.status || 500,
          ),
          url,
        );
      }
    },
  };
}
export default createWorker();
