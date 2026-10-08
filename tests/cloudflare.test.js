import test from "node:test";
import { parse } from "jsonc-parser";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID, scryptSync } from "node:crypto";
import { createTestHarness } from "wrangler";
import { availableDates } from "../public/schedule.js";
import { createD1Store } from "../cloudflare/store.js";

const origin = "https://vitaminboost.test";
const password = "fictional-password-cloudflare-test-only";
const salt = "b".repeat(32);
const adminHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
const vars = {
  PUBLIC_ORIGIN: origin,
  ORDER_MODE: "preview",
  ORDERS_OPEN: "true",
  WEEKLY_CAPACITY: "6",
  LIVE_SETUP_CONFIRMED: "false",
  TURNSTILE_SITE_KEY: "fictional-public-key",
  TURNSTILE_SECRET: "fictional-secret",
  RESEND_API_KEY: "fictional-resend-key",
  EMAIL_FROM: "VitaminBoost <orders@example.invalid>",
  ORDER_NOTIFICATION_EMAIL: "team@example.invalid",
};
test("Cloudflare Worker and D1 integration", async (t) => {
  const baseConfig = parse(readFileSync("wrangler.jsonc", "utf8"), [], {
    allowTrailingComma: true,
  });
  const options = (overrides = {}, hash = adminHash) => ({
    workers: [
      {
        config: {
          ...baseConfig,
          main: "tests/fixtures/cloudflare-worker.js",
          dev: { upstream_protocol: "https" },
          vars: { ...vars, ...overrides, ADMIN_PASSWORD_HASH: hash },
        },
      },
    ],
  });
  const harness = createTestHarness(options());
  t.after(() => harness.close());
  await harness.listen();
  const worker = harness.getWorker();
  let { DB: beforeDB } = await worker.getEnv();
  await beforeDB
    .prepare(
      `CREATE TABLE orders(order_number TEXT PRIMARY KEY,name TEXT,email TEXT,role TEXT,pickup_date TEXT,delivery_location TEXT,order_items TEXT,total_amount TEXT,created_at TEXT)`,
    )
    .run();
  await beforeDB
    .prepare(
      `INSERT INTO orders VALUES('0042','Legacy Customer','legacy@example.invalid','Teacher','2025-05-19','Old location','[{"name":"Red Berries","qty":2,"subtotal":"7.00"}]','7.00','2025-05-18T16:00:00')`,
    )
    .run();
  const oldRow = await beforeDB
    .prepare("SELECT * FROM orders WHERE order_number='0042'")
    .first();
  await worker.applyD1Migrations("DB");
  assert.deepEqual(
    await beforeDB
      .prepare("SELECT * FROM orders WHERE order_number='0042'")
      .first(),
    oldRow,
  );
  assert.equal(
    (await beforeDB.prepare("PRAGMA table_info('orders')").all()).results
      .length,
    9,
  );
  // Applying again must not reset the catalog or data.
  await worker.applyD1Migrations("DB");
  let { DB } = await worker.getEnv();
  const update = async (overrides, hash) => {
    await harness.update(options(overrides, hash));
    ({ DB } = await harness.getWorker().getEnv());
  };
  const request = (path, { method = "GET", body, headers = {} } = {}) =>
    harness.fetch(origin + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const payload = (extra = {}) => ({
    firstName: "Test",
    lastName: "Customer",
    email: "test@example.invalid",
    role: "Student",
    date: availableDates("Student")[0],
    fulfillment: "library",
    website: "",
    cf_token: "valid-test-token",
    items: [{ id: "red-berries", qty: 1 }],
    expectedTotal: 350,
    ...extra,
  });
  const place = (body = payload(), key = randomUUID(), headers = {}) =>
    request("/api/orders", {
      method: "POST",
      body,
      headers: { "Idempotency-Key": key, ...headers },
    });
  const clear = () =>
    DB.batch([
      DB.prepare("DELETE FROM vb_cancellation_emails"),
      DB.prepare("DELETE FROM vb_email_outbox"),
      DB.prepare("DELETE FROM vb_orders"),
      DB.prepare("DELETE FROM orders WHERE order_number != '0042'"),
      DB.prepare("DELETE FROM vb_rate_limits"),
      DB.prepare("DELETE FROM vb_sessions"),
    ]);
  let cookie, csrf;
  const login = async () => {
    const res = await request("/api/admin/login", {
      method: "POST",
      body: { password },
    });
    assert.equal(res.status, 200, await res.clone().text());
    cookie = res.headers.get("set-cookie").split(";")[0];
    csrf = (await res.json()).csrf;
    return res;
  };
  const patch = (path, body) =>
    request(path, {
      method: "PATCH",
      body,
      headers: { Cookie: cookie, "X-CSRF-Token": csrf },
    });
  await t.test(
    "serves unchanged frontend, images and headers; private paths and APIs are blocked",
    async () => {
      const page = await request("/");
      assert.equal(page.status, 200);
      assert.match(await page.text(), /VitaminBoost/);
      assert.match(
        page.headers.get("content-security-policy"),
        /frame-ancestors 'none'/,
      );
      for (const path of [
        "/admin.html",
        "/assets/breakfast-poster.png",
        "/styles.css",
      ])
        assert.equal((await request(path)).status, 200, path);
      for (const path of [
        "/.env",
        "/server.js",
        "/cloudflare/worker.js",
        "/migrations/0001_initial.sql",
        "/.data/preview.sqlite",
      ])
        assert.equal((await request(path)).status, 404, path);
      assert.equal((await request("/api/admin/orders")).status, 401);
      const menu = await (await request("/api/catalog")).json();
      assert.equal(menu.products.length, 10);
      assert.equal(menu.demo, true);
    },
  );
  await t.test(
    "origin, content type, size, and malformed JSON are rejected",
    async () => {
      assert.equal(
        (
          await place(payload(), randomUUID(), {
            Origin: "https://evil.invalid",
          })
        ).status,
        403,
      );
      assert.equal(
        (await place(payload(), randomUUID(), { "Content-Type": "text/plain" }))
          .status,
        415,
      );
      assert.equal(
        (await place(payload({ firstName: "x".repeat(17000) }))).status,
        413,
      );
      assert.equal(
        (
          await harness.fetch(origin + "/api/orders", {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "application/json" },
            body: "{",
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "mixed jar/smoothie order uses canonical prices and immutable snapshots",
    async () => {
      await clear();
      const res = await place(
        payload({
          items: [
            { id: "red-berries", qty: 1 },
            { id: "berry-dream", qty: 1 },
            { id: "matcha-dream", qty: 1 },
          ],
          expectedTotal: 1250,
        }),
      );
      assert.equal(res.status, 201);
      assert.equal((await res.json()).total, 1250);
      const store = createD1Store(DB.withSession("first-primary"));
      await store.updateProduct("berry-dream", { price: 500, available: true });
      assert.equal((await store.list())[0].items[1].price, 450);
      await store.updateProduct("berry-dream", { price: 450, available: true });
    },
  );
  await t.test(
    "tampered prices, duplicate items, invalid quantities and retired delivery are rejected",
    async () => {
      await clear();
      for (const extra of [
        { expectedTotal: 1 },
        { items: [{ id: "red-berries", qty: 1.5 }] },
        {
          items: [
            { id: "red-berries", qty: 1 },
            { id: "red-berries", qty: 1 },
          ],
        },
        { fulfillment: "delivery" },
        { role: "Teacher", fulfillment: "delivery" },
        { website: "spam" },
      ])
        assert.ok((await place(payload(extra))).status >= 400);
      assert.equal(
        (await DB.prepare("SELECT COUNT(*) n FROM vb_orders").first()).n,
        0,
      );
    },
  );
  await t.test(
    "Cloudflare enforces Monday/Tuesday pickup and fridge only on Tuesday",
    async () => {
      await clear();
      const dates = availableDates("Teacher");
      const wednesday = new Date(`${dates[1]}T12:00:00Z`);
      wednesday.setUTCDate(wednesday.getUTCDate() + 1);
      const menu = await (await request("/api/catalog")).json();
      assert.deepEqual(menu.dates.Teacher, dates);
      assert.equal(
        (
          await place(
            payload({ role: "Teacher", date: dates[1], fulfillment: "staff" }),
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await place(
            payload({
              role: "Teacher",
              date: wednesday.toISOString().slice(0, 10),
              fulfillment: "fridge",
            }),
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await place(
            payload({ role: "Teacher", date: dates[1], fulfillment: "fridge" }),
          )
        ).status,
        201,
      );
    },
  );
  await t.test(
    "concurrent retries create only one order; changed replay is rejected",
    async () => {
      await clear();
      const key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => place(payload(), key)),
      );
      assert.ok(responses.every((r) => r.status === 201));
      const receipts = await Promise.all(responses.map((r) => r.json()));
      assert.equal(new Set(receipts.map((r) => r.reference)).size, 1);
      assert.equal(
        (await DB.prepare("SELECT COUNT(*) n FROM vb_orders").first()).n,
        1,
      );
      assert.equal(
        (await place(payload({ firstName: "Changed" }), key)).status,
        409,
      );
    },
  );
  await t.test(
    "concurrent orders cannot oversell a week, even across different pickup days",
    async () => {
      await clear();
      const dates = availableDates("Teacher");
      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          place(
            payload({
              role: "Teacher",
              date: dates[i % 2],
              fulfillment: "fridge",
            }),
          ),
        ),
      );
      assert.equal(responses.filter((r) => r.status === 201).length, 6);
      assert.equal(responses.filter((r) => r.status === 409).length, 6);
      assert.equal(
        (await DB.prepare("SELECT SUM(quantity) n FROM vb_orders").first()).n,
        6,
      );
      const order = await DB.prepare(
        "SELECT id FROM vb_orders LIMIT 1",
      ).first();
      const store = createD1Store(DB.withSession("first-primary"));
      await store.updateOrder(order.id, { status: "cancelled" }, { from: vars.EMAIL_FROM });
      assert.equal((await place()).status, 201);
    },
  );
  await t.test(
    "price changes or unavailability between validation and insertion cannot slip through",
    async () => {
      await clear();
      for (const changed of [
        { price: 400, available: 1 },
        { price: 350, available: 0 },
      ]) {
        const underlying = DB.withSession("first-primary");
        let injected = false;
        const intercepted = {
          prepare(sql) {
            const stmt = underlying.prepare(sql);
            if (sql.startsWith("INSERT INTO vb_orders") && !injected) {
              injected = true;
              return {
                bind(...args) {
                  return {
                    async run() {
                      await DB.prepare(
                        "UPDATE vb_products SET price=?,available=? WHERE id=?",
                      )
                        .bind(changed.price, changed.available, "red-berries")
                        .run();
                      return stmt.bind(...args).run();
                    },
                  };
                },
              };
            }
            return stmt;
          },
        };
        await assert.rejects(
          () => createD1Store(intercepted).place(payload(), randomUUID()),
          /prix|indisponible/,
        );
        await DB.prepare(
          "UPDATE vb_products SET price=350,available=1 WHERE id=?",
        )
          .bind("red-berries")
          .run();
      }
      assert.equal(
        (await DB.prepare("SELECT COUNT(*) n FROM vb_orders").first()).n,
        0,
      );
    },
  );
  await t.test(
    "secure login, CSRF, status transitions, payment and audit work on the Worker",
    async () => {
      await clear();
      const receipt = await (await place()).json();
      const res = await login();
      assert.match(res.headers.get("set-cookie"), /HttpOnly/);
      assert.match(res.headers.get("set-cookie"), /Secure/);
      assert.match(res.headers.get("set-cookie"), /SameSite=Strict/);
      const path = "/api/admin/orders/" + receipt.reference;
      assert.equal(
        (
          await request(path, {
            method: "PATCH",
            body: { status: "preparing" },
            headers: { Cookie: cookie },
          })
        ).status,
        403,
      );
      assert.equal((await patch(path, { status: "collected" })).status, 409);
      assert.equal((await patch(path, { status: "preparing" })).status, 200);
      assert.equal((await patch(path, { status: "ready" })).status, 200);
      assert.equal((await patch(path, { status: "collected" })).status, 409);
      assert.equal((await patch(path, { paymentStatus: "paid" })).status, 200);
      assert.equal((await patch(path, { status: "collected" })).status, 200);
      assert.equal(
        (
          await DB.prepare("SELECT COUNT(*) n FROM vb_audit WHERE order_id=?")
            .bind(receipt.reference)
            .first()
        ).n,
        4,
      );
      assert.equal(
        (
          await patch("/api/admin/products/matcha-dream", {
            price: 450,
            available: false,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await place(
            payload({
              items: [{ id: "matcha-dream", qty: 1 }],
              expectedTotal: 450,
            }),
          )
        ).status,
        409,
      );
      await patch("/api/admin/products/matcha-dream", {
        price: 450,
        available: true,
      });
      assert.equal(
        (
          await request("/api/admin/logout", {
            method: "POST",
            body: {},
            headers: { Cookie: cookie, "X-CSRF-Token": csrf },
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/api/admin/orders", { headers: { Cookie: cookie } }))
          .status,
        401,
      );
    },
  );
  await t.test(
    "competing staff updates do not lose a payment or overwrite another status",
    async () => {
      await clear();
      const receipt = await (await place()).json();
      const store = createD1Store(DB.withSession("first-primary"));
      const results = await Promise.allSettled([
        store.updateOrder(receipt.reference, { status: "preparing" }),
        store.updateOrder(receipt.reference, { paymentStatus: "paid" }),
      ]);
      assert.ok(results.some((r) => r.status === "fulfilled"));
      const saved = (await store.list())[0];
      if (results[0].status === "fulfilled")
        assert.equal(saved.status, "preparing");
      if (results[1].status === "fulfilled")
        assert.equal(saved.payment_status, "paid");
      for (const r of results.filter((r) => r.status === "rejected"))
        assert.equal(r.reason.status, 409);
    },
  );
  await t.test(
    "sessions expire and login throttling survives individual requests",
    async () => {
      await clear();
      await login();
      await DB.prepare("UPDATE vb_sessions SET expires=0").run();
      assert.equal(
        (await request("/api/admin/session", { headers: { Cookie: cookie } }))
          .status,
        401,
      );
      await DB.prepare("DELETE FROM vb_rate_limits").run();
      for (let i = 0; i < 5; i++)
        assert.equal(
          (
            await request("/api/admin/login", {
              method: "POST",
              body: { password: "wrong" },
            })
          ).status,
          401,
        );
      assert.equal(
        (
          await request("/api/admin/login", {
            method: "POST",
            body: { password },
          })
        ).status,
        429,
      );
    },
  );
  await t.test(
    "order throttling and suspended ordering are enforced",
    async () => {
      await clear();
      // Fill the already validated fixed-window counter rather than make 120 orders.
      await place();
      await DB.prepare(
        "UPDATE vb_rate_limits SET count=120 WHERE key LIKE 'order:%'",
      ).run();
      assert.equal((await place()).status, 429);
      await update({ ORDERS_OPEN: "false" });
      await DB.prepare("DELETE FROM vb_rate_limits").run();
      assert.equal((await place()).status, 503);
    },
  );
  await t.test(
    "preview/live orders are isolated; live activation requires setup and an explicit HTTPS origin",
    async () => {
      await update({ ORDER_MODE: "live" });
      assert.equal((await request("/api/catalog")).status, 503);
      await update({ ORDER_MODE: "live", LIVE_SETUP_CONFIRMED: "true" });
      await clear();
      const previewStore = createD1Store(DB.withSession("first-primary"), true);
      await previewStore.place(payload(), randomUUID());
      const live = await (await place()).json();
      assert.match(live.reference, /^VB-/);
      assert.equal(live.demo, false);
      await login();
      const orders = await (
        await request("/api/admin/orders", { headers: { Cookie: cookie } })
      ).json();
      assert.equal(orders.orders.length, 1);
      assert.equal(orders.orders[0].demo, 0);
    },
  );
  await t.test(
    "legacy persistence, Turnstile validation, replay and e-mail failures",
    async () => {
      await clear();
      const menu = await (await request("/api/catalog")).json();
      assert.equal(menu.turnstileSiteKey, "fictional-public-key");
      for (const token of [
        null,
        "bad",
        "wrong-host",
        "wrong-action",
        "unavailable",
      ]) {
        const res = await place(payload({ cf_token: token }));
        assert.ok(res.status >= 400, token);
      }
      assert.equal(
        (await DB.prepare("SELECT COUNT(*) n FROM vb_orders").first()).n,
        0,
      );
      const key = randomUUID();
      const body = payload({ role: "Teacher", fulfillment: "staff" });
      const result = await (await place(body, key)).json();
      assert.equal(result.emailStatus, "sent");
      const legacy = await DB.prepare(
        "SELECT * FROM orders WHERE order_number=?",
      )
        .bind(result.reference)
        .first();
      assert.equal(legacy.name, "Test Customer");
      assert.equal(legacy.total_amount, "3.50");
      assert.match(legacy.delivery_location, /09 h 30 à 09 h 45/);
      assert.equal(JSON.parse(legacy.order_items)[0].subtotal, "3.50");
      const replay = await (
        await place({ ...body, cf_token: "expired-token" }, key)
      ).json();
      assert.equal(replay.reference, result.reference);
      assert.equal(
        (
          await DB.prepare(
            "SELECT attempts FROM vb_email_outbox WHERE order_id=?",
          )
            .bind(result.reference)
            .first()
        ).attempts,
        1,
      );
      assert.equal(
        (await place({ ...body, firstName: "Changed" }, key)).status,
        409,
      );
      const failed = await (
        await place(payload({ email: "fail@example.invalid" }))
      ).json();
      assert.equal(failed.emailStatus, "failed");
      assert.ok(
        await DB.prepare("SELECT order_number FROM orders WHERE order_number=?")
          .bind(failed.reference)
          .first(),
      );
      const preview = createD1Store(DB.withSession("first-primary"), true);
      await preview.place(payload(), randomUUID());
      assert.equal(
        (
          await DB.prepare(
            "SELECT COUNT(*) n FROM orders WHERE order_number LIKE 'DEMO-%'",
          ).first()
        ).n,
        0,
      );
      assert.deepEqual(
        await DB.prepare(
          "SELECT * FROM orders WHERE order_number='0042'",
        ).first(),
        oldRow,
      );
    },
  );
  await t.test(
    "historical orders and e-mail retries require admin authentication and CSRF",
    async () => {
      assert.equal((await request("/api/admin/legacy-orders")).status, 401);
      await login();
      const history = await (
        await request("/api/admin/legacy-orders", {
          headers: { Cookie: cookie },
        })
      ).json();
      assert.deepEqual(history.orders, [oldRow]);
      const failed = await DB.prepare(
        "SELECT order_id FROM vb_email_outbox WHERE status='failed'",
      ).first();
      const path = `/api/admin/email/${failed.order_id}`;
      assert.equal(
        (await request(path, { method: "POST", body: {} })).status,
        401,
      );
      assert.equal(
        (
          await request(path, {
            method: "POST",
            body: {},
            headers: { Cookie: cookie },
          })
        ).status,
        403,
      );
      const retry = await request(path, {
        method: "POST",
        body: {},
        headers: { Cookie: cookie, "X-CSRF-Token": csrf },
      });
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).emailStatus, "failed");
      await DB.prepare(
        "UPDATE vb_email_outbox SET first_attempt=0 WHERE order_id=?",
      )
        .bind(failed.order_id)
        .run();
      const review = await request(path, {
        method: "POST",
        body: {},
        headers: { Cookie: cookie, "X-CSRF-Token": csrf },
      });
      assert.equal((await review.json()).emailStatus, "review");
    },
  );
  await t.test(
    "legacy capacity counts future old orders without counting mirrored orders twice",
    async () => {
      await clear();
      await DB.prepare(
        "INSERT INTO orders(order_number,pickup_date,order_items) VALUES('0043',?,?)",
      )
        .bind(payload().date, JSON.stringify([{ name: "Old product", qty: 5 }]))
        .run();
      assert.equal((await place()).status, 201);
      assert.equal((await place()).status, 409);
    },
  );
  await t.test(
    "unreadable historical items block the affected week without damaging history",
    async () => {
      await clear();
      await DB.prepare(
        "INSERT INTO orders(order_number,pickup_date,order_items) VALUES('0043',?,'bad json')",
      )
        .bind(payload().date)
        .run();
      assert.equal((await place()).status, 503);
      assert.equal(
        (await DB.prepare("SELECT COUNT(*) n FROM vb_orders").first()).n,
        0,
      );
      assert.equal(
        (
          await DB.prepare(
            "SELECT order_items FROM orders WHERE order_number='0043'",
          ).first()
        ).order_items,
        "bad json",
      );
    },
  );
  await t.test(
    "legacy write failure rolls back the internal order and outbox",
    async () => {
      await clear();
      await DB.prepare(
        "CREATE TRIGGER reject_test_legacy BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT,'test_failure'); END",
      ).run();
      assert.equal((await place()).status, 500);
      assert.equal(
        (await DB.prepare("SELECT COUNT(*) n FROM vb_orders").first()).n,
        0,
      );
      assert.equal(
        (await DB.prepare("SELECT COUNT(*) n FROM vb_email_outbox").first()).n,
        0,
      );
      await DB.prepare("DROP TRIGGER reject_test_legacy").run();
    },
  );
  await t.test("password rotation invalidates existing sessions", async () => {
    const newSalt = "c".repeat(32),
      newHash = `${newSalt}:${scryptSync(password, newSalt, 64).toString("hex")}`;
    await update({ ORDER_MODE: "live", LIVE_SETUP_CONFIRMED: "true" }, newHash);
    assert.equal(
      (await request("/api/admin/session", { headers: { Cookie: cookie } }))
        .status,
      401,
    );
  });
});
