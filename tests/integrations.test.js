import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  buildConfirmation,
  sendConfirmation,
  verifyTurnstile,
} from "../cloudflare/integrations.js";

const env = {
  TURNSTILE_SECRET: "fictional-secret",
  RESEND_API_KEY: "fictional-key",
};
function outbox(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec(
    `CREATE TABLE vb_email_outbox(order_id TEXT PRIMARY KEY,payload TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,first_attempt INTEGER,lease_until INTEGER,last_error TEXT,provider_id TEXT)`,
  );
  sql
    .prepare("INSERT INTO vb_email_outbox(order_id,payload) VALUES(?,?)")
    .run(
      "VB-TEST",
      JSON.stringify({ to: ["test@example.invalid"], text: "Fixed payload" }),
    );
  const db = {
    prepare(query) {
      const stmt = sql.prepare(query);
      return {
        bind(...args) {
          return {
            first: async () => stmt.get(...args),
            run: async () => stmt.run(...args),
          };
        },
      };
    },
  };
  return { db, sql };
}

test("Turnstile checks success, hostname and action and fails closed on network errors", async () => {
  const valid = {
    success: true,
    hostname: "vitaminboost.test",
    action: "order",
  };
  let calls = 0;
  const fake = async (url, init) => {
    calls++;
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    assert.equal(JSON.parse(init.body).secret, env.TURNSTILE_SECRET);
    return Response.json(valid);
  };
  await verifyTurnstile(
    "fictional-token",
    env,
    "https://vitaminboost.test",
    fake,
  );
  assert.equal(calls, 1);
  for (const invalid of [
    { ...valid, success: false },
    { ...valid, hostname: "evil.invalid" },
    { ...valid, action: "login" },
  ])
    await assert.rejects(
      () =>
        verifyTurnstile(
          "fictional-token",
          env,
          "https://vitaminboost.test",
          async () => Response.json(invalid),
        ),
      { status: 403 },
    );
  for (const token of [null, "", "x".repeat(2049)])
    await assert.rejects(
      () => verifyTurnstile(token, env, "https://vitaminboost.test", fake),
      { status: 400 },
    );
  await assert.rejects(
    () =>
      verifyTurnstile(
        "fictional-token",
        env,
        "https://vitaminboost.test",
        async () => {
          throw Error("network");
        },
      ),
    { status: 503 },
  );
});

test("confirmation escapes customer HTML, uses canonical totals and hides team copy", () => {
  const mail = buildConfirmation(
    {
      first: "<img src=x onerror=alert(1)>",
      email: "test@example.invalid",
      id: "VB-TEST",
      items: [{ name: "Berry Dream", qty: 2, price: 450 }],
      total: 900,
      date: "2026-10-12",
      location: "Proffen Konferenz · 09 h 30 à 09 h 45",
    },
    {
      from: "VitaminBoost <orders@example.invalid>",
      notify: "team@example.invalid",
    },
  );
  assert.ok(!mail.html.includes("<img"));
  assert.match(mail.html, /&lt;img/);
  assert.match(mail.text, /9,00 €/);
  assert.match(mail.text, /09 h 30 à 09 h 45/);
  assert.deepEqual(mail.to, ["test@example.invalid"]);
  assert.deepEqual(mail.bcc, ["team@example.invalid"]);
});

test("outbox failure preserves payload; retry uses same provider key and sends only once", async (t) => {
  const { db, sql } = outbox(t);
  let calls = [];
  const fake = async (url, init) => {
    calls.push({ url, body: init.body, key: init.headers["Idempotency-Key"] });
    return calls.length === 1
      ? new Response("", { status: 503 })
      : Response.json({ id: "mock-provider-id" });
  };
  assert.equal(
    await sendConfirmation(db, "VB-TEST", env, fake, 1000),
    "failed",
  );
  assert.equal(await sendConfirmation(db, "VB-TEST", env, fake, 2000), "sent");
  assert.equal(await sendConfirmation(db, "VB-TEST", env, fake, 3000), "sent");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(
    sql.prepare("SELECT attempts FROM vb_email_outbox").get().attempts,
    2,
  );
});

test("outbox lease prevents simultaneous sends and stops uncertain retries after 23 hours", async (t) => {
  const { db, sql } = outbox(t);
  let calls = 0;
  const fake = async () => {
    calls++;
    return Response.json({ id: "mock-id" });
  };
  await Promise.all(
    Array.from({ length: 8 }, () =>
      sendConfirmation(db, "VB-TEST", env, fake, 1000),
    ),
  );
  assert.equal(calls, 1);
  sql
    .prepare("UPDATE vb_email_outbox SET status='failed',first_attempt=0")
    .run();
  assert.equal(
    await sendConfirmation(db, "VB-TEST", env, fake, 23 * 3600000),
    "review",
  );
  assert.equal(calls, 1);
});

test("unconfirmed or malformed provider responses never become sent", async (t) => {
  const { db } = outbox(t);
  assert.equal(
    await sendConfirmation(
      db,
      "VB-TEST",
      env,
      async () => Response.json({}),
      1000,
    ),
    "failed",
  );
  assert.equal(
    await sendConfirmation(
      db,
      "VB-TEST",
      env,
      async () => {
        throw Error("timeout");
      },
      2000,
    ),
    "failed",
  );
});

test("compatibility migration initializes a blank database and rejects the incompatible replacement schema", (t) => {
  const migration = readFileSync(
    new URL(
      "../migrations-legacy/0001_legacy_compatibility.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const fresh = new DatabaseSync(":memory:");
  t.after(() => fresh.close());
  fresh.exec(migration);
  assert.equal(fresh.prepare("PRAGMA table_info('orders')").all().length, 9);
  assert.equal(fresh.prepare("SELECT COUNT(*) n FROM vb_products").get().n, 10);
  const other = new DatabaseSync(":memory:");
  t.after(() => other.close());
  other.exec(
    "CREATE TABLE orders(id TEXT PRIMARY KEY); INSERT INTO orders VALUES('keep-me')",
  );
  assert.throws(() => other.exec(migration), /no such column/);
  assert.equal(other.prepare("SELECT id FROM orders").get().id, "keep-me");
  assert.equal(
    other
      .prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='vb_orders'")
      .get().n,
    0,
  );
});

test("confirmation photographs match ordered IDs and keep saved prices",()=>{
 const base={first:'Camille',email:'test@example.invalid',id:'VB-TEST',date:'2026-10-12',location:'Lieu <test>',total:1000,items:[{id:'red-berries',name:'Red Berries',price:500,qty:2}]};
 const mail=buildConfirmation(base,{from:'test@example.invalid'});
 assert.match(mail.html,/https:\/\/vitaminboostalr.com\/assets\/Red%20Berries.png/);assert.doesNotMatch(mail.html,/berry-dream.png/);assert.match(mail.html,/10,00 €/);assert.match(mail.html,/2 × 5,00 €/);assert.match(mail.html,/Lieu &lt;test&gt;/);
 assert.match(mail.text,/bacs verts/);
 const unknown=buildConfirmation({...base,items:[{id:'https://evil.invalid/photo',name:'<img src=x>',price:500,qty:2}]},{from:'test@example.invalid'});
 assert.doesNotMatch(unknown.html,/<img/);assert.match(unknown.html,/&lt;img src=x&gt;/);
});
