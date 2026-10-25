import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStore } from "../lib/store.js";
import { availableDates, fulfillmentOptions } from "../public/schedule.js";
import { cleanCart } from "../public/catalog.js";
const now = new Date("2026-10-04T12:00:00Z");
const order = (overrides = {}) => ({
  firstName: "Test",
  lastName: "Customer",
  email: "test@example.invalid",
  role: "Student",
  date: "2026-10-05",
  fulfillment: "library",
  room: "",
  website: "",
  items: [{ id: "red-berries", qty: 2 }],
  expectedTotal: 700,
  ...overrides,
});
function fixture(t) {
  const store = createStore();
  t.after(() => store.db.close());
  return store;
}
test("Monday cutoff uses Luxembourg time, including daylight saving", () => {
  assert.equal(
    availableDates("Student", new Date("2026-10-05T05:59:59Z"))[0],
    "2026-10-05",
  );
  assert.equal(
    availableDates("Student", new Date("2026-10-05T06:00:00Z"))[0],
    "2026-10-12",
  );
  assert.equal(
    availableDates("Student", new Date("2026-11-30T06:59:59Z"))[0],
    "2026-11-30",
  );
  assert.equal(
    availableDates("Student", new Date("2026-11-30T07:00:00Z"))[0],
    "2026-12-07",
  );
  assert.deepEqual(availableDates("Teacher", now).slice(0, 2), [
    "2026-10-05",
    "2026-10-06",
  ]);
  assert.equal(
    availableDates("Student", new Date("2026-10-06T07:00:00Z"))[0],
    "2026-10-12",
  );
});
test("students cannot choose staff, delivery or Tuesday pickup", (t) => {
  const s = fixture(t);
  for (const patch of [
    { fulfillment: "delivery", room: "B204" },
    { fulfillment: "staff" },
    { date: "2026-10-06" },
    { role: "Administrator" },
  ])
    assert.throws(
      () => s.place(order(patch), randomUUID(), { now }),
      /profil|date|retrait/,
    );
  assert.equal(fulfillmentOptions("Student", "2026-10-06").length, 0);
});
test("valid order persists item prices and unpaid status", (t) => {
  const s = fixture(t);
  const r = s.place(order(), randomUUID(), { now });
  assert.equal(r.total, 700);
  assert.match(r.reference, /^DEMO-/);
  assert.equal(s.list()[0].payment_status, "unpaid");
  s.updateProduct("red-berries", { price: 400, available: true });
  assert.equal(s.list()[0].items[0].price, 350);
});
test("tampered total, fractional quantities, duplicate items and excessive orders are rejected", (t) => {
  const s = fixture(t);
  for (const patch of [
    { expectedTotal: 1 },
    { items: [{ id: "red-berries", qty: 1.5 }] },
    { items: [{ id: "red-berries", qty: -1 }] },
    { items: [{ id: "red-berries", qty: 21 }] },
    {
      items: [
        { id: "red-berries", qty: 1 },
        { id: "red-berries", qty: 1 },
      ],
    },
  ])
    assert.throws(() => s.place(order(patch), randomUUID(), { now }));
  assert.equal(s.list().length, 0);
});
test("idempotency returns the same receipt and rejects changed details", (t) => {
  const s = fixture(t),
    key = randomUUID();
  const first = s.place(order(), key, { now });
  assert.deepEqual(s.place(order(), key, { now }), first);
  assert.equal(s.list().length, 1);
  assert.throws(
    () => s.place(order({ firstName: "Different" }), key, { now }),
    /autre commande/,
  );
});
test("capacity is shared across Monday and Tuesday, and cancellations release it", (t) => {
  const s = fixture(t);
  const first = s.place(order(), randomUUID(), { now, capacity: 2 });
  assert.throws(
    () =>
      s.place(
        order({ role: "Teacher", date: "2026-10-06", fulfillment: "fridge" }),
        randomUUID(),
        { now, capacity: 2 },
      ),
    /capacité/,
  );
  s.updateOrder(first.reference, { status: "cancelled" });
  assert.doesNotThrow(() =>
    s.place(order(), randomUUID(), { now, capacity: 2 }),
  );
});
test("unavailable products, closed dates, missing delivery location and honeypot are rejected", (t) => {
  const s = fixture(t);
  assert.throws(
    () =>
      s.place(
        order({ role: "Teacher", fulfillment: "delivery" }),
        randomUUID(),
        { now },
      ),
    /livraison/,
  );
  assert.throws(
    () => s.place(order({ website: "spam" }), randomUUID(), { now }),
    /acceptée/,
  );
  assert.throws(
    () => s.place(order(), randomUUID(), { now, closedDates: ["2026-10-05"] }),
    /date/,
  );
  s.updateProduct("red-berries", { price: 350, available: false });
  assert.throws(() => s.place(order(), randomUUID(), { now }), /indisponible/);
});
test("status transitions and payment recording are audited", (t) => {
  const s = fixture(t),
    r = s.place(order(), randomUUID(), { now });
  assert.throws(
    () => s.updateOrder(r.reference, { status: "collected" }),
    /pas autorisé/,
  );
  s.updateOrder(r.reference, { status: "preparing" });
  s.updateOrder(r.reference, { status: "ready" });
  assert.throws(
    () => s.updateOrder(r.reference, { status: "collected" }),
    /Enregistrez le paiement/,
  );
  s.updateOrder(r.reference, { paymentStatus: "paid" });
  s.updateOrder(r.reference, { status: "collected" });
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM audit").get().n, 4);
  assert.throws(
    () => s.updateOrder(r.reference, { status: "received" }),
    /pas autorisé/,
  );
});
test("SQL metacharacters stay data and malformed input is rejected", (t) => {
  const s = fixture(t);
  s.place(order({ firstName: "O'Reilly <script>" }), randomUUID(), { now });
  assert.equal(s.list()[0].first_name, "O'Reilly <script>");
  for (const data of [
    null,
    [],
    order({ email: "invalid" }),
    order({ firstName: "\ninvalid" }),
    order({ items: [null] }),
  ])
    assert.throws(() => s.place(data, randomUUID(), { now }));
});
test("stored cart ignores invalid IDs and values", () =>
  assert.deepEqual(
    cleanCart({
      "red-berries": 100,
      "ruby-boost": -1,
      unknown: 2,
      "golden-sunrise": "3",
    }),
    { "red-berries": 20 },
  ));

test("staff pickup is Monday only; Tuesday is fridge only and Wednesday is rejected", (t) => {
  const s = fixture(t);
  for (const role of ["Teacher", "Other"]) {
    assert.deepEqual(availableDates(role, now), [
      "2026-10-05",
      "2026-10-06",
      "2026-10-12",
      "2026-10-13",
      "2026-10-19",
      "2026-10-20",
    ]);
    for (const [date, options] of [
      ["2026-10-05", ["staff", "fridge", "delivery"]],
      ["2026-10-06", ["fridge"]],
    ]) {
      assert.deepEqual(
        fulfillmentOptions(role, date).map((o) => o.id),
        options,
      );
      for (const fulfillment of options)
        assert.doesNotThrow(() =>
          s.place(order({ role, date, fulfillment, room: "B204", deliveryDepartment: "direction" }), randomUUID(), { now }),
        );
    }
    assert.throws(
      () =>
        s.place(
          order({ role, date: "2026-10-06", fulfillment: "staff" }),
          randomUUID(),
          { now },
        ),
      /retrait/,
    );
    assert.throws(
      () =>
        s.place(
          order({ role, date: "2026-10-07", fulfillment: "fridge" }),
          randomUUID(),
          { now },
        ),
      /date/,
    );
    assert.equal(fulfillmentOptions(role, "2026-10-07").length, 0);
  }
  assert.equal(
    fulfillmentOptions("Student", "2026-10-05")[0].time,
    "Lundi · 09 h 30",
  );
  assert.deepEqual(fulfillmentOptions("Student", "2026-10-06"), []);
});
test("Monday 08:00 closes the whole collection week on the server", (t) => {
  const s = fixture(t),
    cutoff = new Date("2026-10-05T06:00:00Z");
  for (const date of ["2026-10-05", "2026-10-06", "2026-10-07"])
    assert.throws(
      () =>
        s.place(
          order({ role: "Teacher", date, fulfillment: "fridge" }),
          randomUUID(),
          { now: cutoff },
        ),
      /date/,
    );
  assert.doesNotThrow(() =>
    s.place(order({ date: "2026-10-12" }), randomUUID(), { now: cutoff }),
  );
  assert.deepEqual(
    availableDates("Teacher", new Date("2026-10-06T05:00:00Z")).slice(0, 2),
    ["2026-10-12", "2026-10-13"],
  );
});
test("French currency and calendar display match local conventions", async () => {
  const { money } = await import("../public/catalog.js");
  const { formatDate } = await import("../public/schedule.js");
  assert.match(money(350), /3,50\s*€/);
  assert.match(formatDate("2026-10-05"), /lundi 5 octobre/);
});

test("breakfast jars and smoothies keep their own price and portions in a mixed order", (t) => {
  const s = fixture(t),
    menu = s.catalog();
  const jars = menu.filter((p) => p.category === "breakfast");
  assert.deepEqual(
    jars.map((p) => [p.id, p.price, p.portion]),
    [
      ["berry-dream", 450, "1 pot"],
      ["matcha-dream", 450, "1 pot"],
    ],
  );
  assert.ok(jars.every((p) => p.available && !p.size && p.preparation === ""));
  assert.match(jars[0].ingredients, /vanille/);
  assert.match(jars[1].ingredients, /matcha/);
  const receipt = s.place(
    order({
      items: [
        { id: "red-berries", qty: 1 },
        { id: "berry-dream", qty: 1 },
        { id: "matcha-dream", qty: 1 },
      ],
      expectedTotal: 1250,
    }),
    randomUUID(),
    { now },
  );
  assert.equal(receipt.total, 1250);
  assert.deepEqual(
    s.list()[0].items.map((i) => i.price),
    [350, 450, 450],
  );
  s.updateProduct("matcha-dream", { price: 450, available: false });
  assert.throws(
    () =>
      s.place(
        order({ items: [{ id: "matcha-dream", qty: 1 }], expectedTotal: 450 }),
        randomUUID(),
        { now },
      ),
    /indisponible/,
  );
});
test("one of every available item can be ordered while Cherry Berry is paused", (t) => {
  const s = fixture(t),
    items = s
      .catalog()
      .filter((p) => p.available)
      .map((p) => ({ id: p.id, qty: 1 }));
  assert.equal(items.length, 10);
  assert.equal(
    s.place(order({ items, expectedTotal: 3450 }), randomUUID(), { now }).total,
    3450,
  );
  assert.deepEqual(cleanCart({ "berry-dream": 2, "matcha-dream": 1 }), {
    "berry-dream": 2,
    "matcha-dream": 1,
  });
});

test("menu order matches the owner and Cherry Berry can be re-enabled by the team", (t) => {
  const s = fixture(t);
  assert.deepEqual(
    s
      .catalog()
      .slice(0, 8)
      .map((p) => p.id),
    [
      "red-berries",
      "ruby-boost",
      "cherry-berry",
      "raspberry-sunset",
      "mango-blush",
      "golden-sunrise",
      "tropical-fire",
      "green-refresh",
    ],
  );
  const cherry = order({
    items: [{ id: "cherry-berry", qty: 1 }],
    expectedTotal: 350,
  });
  assert.throws(() => s.place(cherry, randomUUID(), { now }), /indisponible/);
  s.updateProduct("cherry-berry", { price: 350, available: true });
  assert.equal(s.place(cherry, randomUUID(), { now }).total, 350);
});
