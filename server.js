import http from "node:http";
import { readFile, mkdir, stat } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  randomBytes,
  timingSafeEqual,
  scryptSync,
  createHash,
} from "node:crypto";
import { createStore, AppError } from "./lib/store.js";
import { availableDates } from "./public/schedule.js";
const root = dirname(fileURLToPath(import.meta.url));
export async function createApp(options = {}) {
  const demo = options.demo ?? process.env.ORDER_MODE !== "live";
  const production = process.env.NODE_ENV === "production";
  const origin =
    options.origin ?? process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:4173";
  const adminHash = options.adminHash ?? process.env.ADMIN_PASSWORD_HASH ?? "";
  const orderingOpen =
    options.orderingOpen ?? process.env.ORDERS_OPEN !== "false";
  const capacity =
    options.capacity ?? Number(process.env.WEEKLY_CAPACITY || 120);
  const closedDates = (process.env.CLOSED_DATES || "")
    .split(",")
    .filter(Boolean);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000)
    throw new Error("WEEKLY_CAPACITY must be between 1 and 10000.");
  if (
    !demo &&
    (!production ||
      !origin.startsWith("https://") ||
      !adminHash ||
      process.env.LIVE_SETUP_CONFIRMED !== "true")
  )
    throw new Error(
      "Live ordering needs production HTTPS, an admin password hash, and LIVE_SETUP_CONFIRMED=true. Read README.md first.",
    );
  if (adminHash && !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(adminHash))
    throw new Error(
      "Invalid ADMIN_PASSWORD_HASH. Use scripts/admin-password.js.",
    );
  const database =
    options.database ??
    resolve(
      root,
      process.env.DATABASE_PATH || `.data/${demo ? "preview" : "live"}.sqlite`,
    );
  if (database !== ":memory:")
    await mkdir(dirname(database), { recursive: true, mode: 0o700 });
  const store = createStore(database),
    sessions = new Map(),
    limits = new Map();
  const allow = (key, max, period = 60000) => {
    const now = Date.now();
    let entry = limits.get(key);
    if (!entry || entry.until < now) {
      entry = { count: 0, until: now + period };
      limits.set(key, entry);
    }
    if (++entry.count > max)
      throw new AppError(
        "Trop de tentatives. Patientez un moment avant de réessayer.",
        429,
      );
  };
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
  }, 60000);
  cleanup.unref();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
  };
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    if (production)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    try {
      if (req.headers.host !== new URL(origin).host)
        throw new AppError("Adresse du site non reconnue.", 403);
      const url = new URL(req.url, origin),
        path = url.pathname;
      // Never trust a client-supplied forwarded IP unless a trusted proxy is configured.
      const ip = req.socket.remoteAddress;
      const cookie = (req.headers.cookie || "")
        .split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("vb_session="))
        ?.slice(11);
      const session = cookie
        ? sessions.get(createHash("sha256").update(cookie).digest("hex"))
        : null;
      const authorized = session && session.expires > Date.now();
      const requireAdmin = () => {
        if (!authorized)
          throw new AppError("Veuillez vous connecter à l’espace équipe.", 401);
      };
      const write = ["POST", "PATCH", "DELETE"].includes(req.method);
      if (write) {
        if (req.headers.origin !== origin)
          throw new AppError("Origine de la demande non reconnue.", 403);
        if (
          req.headers["content-type"]?.split(";")[0].trim() !==
          "application/json"
        )
          throw new AppError("Format de la demande non valide.", 415);
      }
      let body;
      if (write) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384)
            throw new AppError("La demande est trop volumineuse.", 413);
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new AppError("Demande non valide.");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new AppError("Demande non valide.");
      }
      if (path === "/api/catalog" && req.method === "GET") {
        return send(200, {
          products: store.catalog(),
          demo,
          orderingOpen,
          dates: Object.fromEntries(
            ["Student", "Teacher", "Other"].map((role) => [
              role,
              availableDates(role).filter((d) => !closedDates.includes(d)),
            ]),
          ),
        });
      }
      if (path === "/api/orders" && req.method === "POST") {
        allow(`order:${ip}`, 20, 10 * 60000);
        if (!orderingOpen)
          throw new AppError(
            "Les commandes sont actuellement suspendues. Veuillez revenir plus tard.",
            503,
          );
        return send(
          201,
          store.place(body, req.headers["idempotency-key"], {
            demo,
            capacity,
            closedDates,
          }),
        );
      }
      if (path === "/api/admin/login" && req.method === "POST") {
        allow(`login:${ip}`, 5, 15 * 60000);
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
        const derived = scryptSync(password, salt, 64);
        if (!timingSafeEqual(derived, Buffer.from(expected, "hex")))
          throw new AppError("Mot de passe incorrect.", 401);
        const token = randomBytes(32).toString("hex"),
          csrf = randomBytes(24).toString("hex");
        sessions.set(createHash("sha256").update(token).digest("hex"), {
          csrf,
          expires: Date.now() + 8 * 3600000,
        });
        res.setHeader(
          "Set-Cookie",
          `vb_session=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=28800${production ? "; Secure" : ""}`,
        );
        return send(200, { csrf });
      }
      if (path.startsWith("/api/admin/")) {
        requireAdmin();
        if (write && req.headers["x-csrf-token"] !== session.csrf)
          throw new AppError(
            "Veuillez vous reconnecter avant de modifier les données.",
            403,
          );
        if (path === "/api/admin/session" && req.method === "GET")
          return send(200, { csrf: session.csrf, demo });
        if (path === "/api/admin/logout" && req.method === "POST") {
          sessions.delete(createHash("sha256").update(cookie).digest("hex"));
          res.setHeader(
            "Set-Cookie",
            `vb_session=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0${production ? "; Secure" : ""}`,
          );
          return send(200, { ok: true });
        }
        if (path === "/api/admin/orders" && req.method === "GET")
          return send(200, { orders: store.list(), demo });
        if (path.startsWith("/api/admin/orders/") && req.method === "PATCH") {
          store.updateOrder(path.slice("/api/admin/orders/".length), body);
          return send(200, { ok: true });
        }
        if (path.startsWith("/api/admin/products/") && req.method === "PATCH") {
          store.updateProduct(path.slice("/api/admin/products/".length), body);
          return send(200, { ok: true });
        }
      }
      if (path.startsWith("/api/"))
        throw new AppError("Élément introuvable.", 404);
      if (!["GET", "HEAD"].includes(req.method))
        throw new AppError("Méthode non autorisée.", 405);
      const allowed =
        /^\/(?:index\.html|admin\.html|styles\.css|admin\.css|app\.js|admin\.js|order-labels\.js|catalog\.js|schedule\.js|assets\/[a-zA-Z0-9 .%_-]+\.(?:jpg|png|svg))$/;
      const decoded = decodeURIComponent(path);
      if (path !== "/" && !allowed.test(decoded))
        throw new AppError("Page introuvable.", 404);
      const target = resolve(
        root,
        "public",
        path === "/" ? "index.html" : decoded.slice(1),
      );
      const info = await stat(target);
      if (!info.isFile()) throw new AppError("Page introuvable.", 404);
      const content = await readFile(target);
      res.writeHead(200, {
        "Content-Type": mime[extname(target)] || "application/octet-stream",
        "Cache-Control": path.includes("/assets/")
          ? "public, max-age=86400"
          : "no-cache",
        "Content-Length": content.length,
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (!res.headersSent)
        send(error.status || (error.code === "ENOENT" ? 404 : 500), {
          error: error.status
            ? error.message
            : error.code === "ENOENT"
              ? "Page introuvable."
              : "Une erreur est survenue. Veuillez réessayer.",
        });
      else res.end();
      if (!error.status && error.code !== "ENOENT")
        console.error("Request failed:", error.name);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on("close", () => {
    clearInterval(cleanup);
    store.db.close();
  });
  return { server, store };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 4173),
    host = process.env.HOST || "127.0.0.1";
  const { server } = await createApp();
  server.listen(port, host, () =>
    console.log(
      `VitaminBoost preview: ${process.env.PUBLIC_ORIGIN || `http://${host}:${port}`}\nTeam space: /admin.html\nMode: ${process.env.ORDER_MODE === "live" ? "LIVE — pay at collection" : "PREVIEW — test orders only"}`,
    ),
  );
}
