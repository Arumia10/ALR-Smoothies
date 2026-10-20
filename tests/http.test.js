import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, scryptSync } from "node:crypto";
import { createApp } from "../server.js";
import { availableDates } from "../public/schedule.js";
const origin = "http://127.0.0.1:4187",
  password = "test-only-password-no-real-access",
  salt = "a".repeat(32);
const adminHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
test("HTTP security, order submission, and authenticated administration", async (t) => {
  const { server } = await createApp({
    database: ":memory:",
    origin,
    adminHash,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(4187, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = (path, { method = "GET", body, headers = {} } = {}) =>
    fetch(origin + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  let cookie, csrf, reference;
  await t.test(
    "public files load with security headers; private files and admin data are blocked",
    async () => {
      const page = await request("/");
      assert.equal(page.status, 200);
      const labelsModule = await request("/order-labels.js");
      assert.equal(labelsModule.status, 200);
      assert.match(labelsModule.headers.get("content-type"), /javascript/);
      assert.match(await labelsModule.text(), /createLabelsDocx/);
      assert.match(
        page.headers.get("content-security-policy"),
        /frame-ancestors 'none'/,
      );
      for (const path of [
        "/server.js",
        "/.env",
        "/.data/preview.sqlite",
        "/lib/store.js",
      ])
        assert.equal((await request(path)).status, 404);
      assert.equal((await request("/api/admin/orders")).status, 401);
    },
  );
  const payload = {
    firstName: "Test",
    lastName: "Customer",
    email: "test@example.invalid",
    role: "Student",
    date: availableDates("Student")[0],
    fulfillment: "library",
    room: "",
    website: "",
    items: [{ id: "red-berries", qty: 1 }],
    expectedTotal: 350,
  };
  await t.test("cross-origin order submission is rejected", async () =>
    assert.equal(
      (
        await request("/api/orders", {
          method: "POST",
          body: payload,
          headers: {
            Origin: "https://evil.invalid",
            "Idempotency-Key": randomUUID(),
          },
        })
      ).status,
      403,
    ),
  );
  await t.test("concurrent repeated requests create one order", async () => {
    const key = randomUUID(),
      responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request("/api/orders", {
            method: "POST",
            body: payload,
            headers: { "Idempotency-Key": key },
          }),
        ),
      );
    assert.ok(responses.every((r) => r.status === 201));
    const data = await Promise.all(responses.map((r) => r.json()));
    assert.equal(new Set(data.map((d) => d.reference)).size, 1);
    reference = data[0].reference;
    assert.equal(data[0].paymentStatus, "unpaid");
  });
  await t.test(
    "team login sets an HttpOnly session and a CSRF token",
    async () => {
      assert.equal(
        (
          await request("/api/admin/login", {
            method: "POST",
            body: { password: "wrong" },
          })
        ).status,
        401,
      );
      const res = await request("/api/admin/login", {
        method: "POST",
        body: { password },
      });
      assert.equal(res.status, 200);
      const header = res.headers.get("set-cookie");
      assert.match(header, /HttpOnly/);
      assert.match(header, /SameSite=Strict/);
      cookie = header.split(";")[0];
      csrf = (await res.json()).csrf;
      assert.ok(csrf);
    },
  );
  await t.test(
    "admin reads work only with session; writes need CSRF",
    async () => {
      const res = await request("/api/admin/orders", {
        headers: { Cookie: cookie },
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).orders.length, 1);
      assert.equal(
        (
          await request(`/api/admin/orders/${reference}`, {
            method: "PATCH",
            body: { status: "preparing" },
            headers: { Cookie: cookie },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(`/api/admin/orders/${reference}`, {
            method: "PATCH",
            body: { status: "preparing" },
            headers: { Cookie: cookie, "X-CSRF-Token": csrf },
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "admin availability changes are enforced on new orders",
    async () => {
      const res = await request("/api/admin/products/red-berries", {
        method: "PATCH",
        body: { price: 350, available: false },
        headers: { Cookie: cookie, "X-CSRF-Token": csrf },
      });
      assert.equal(res.status, 200);
      assert.equal(
        (
          await request("/api/orders", {
            method: "POST",
            body: payload,
            headers: { "Idempotency-Key": randomUUID() },
          })
        ).status,
        409,
      );
    },
  );
  await t.test("logout invalidates the session", async () => {
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
  });
});
