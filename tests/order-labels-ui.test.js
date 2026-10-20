import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { orderLabels, createLabelsDocx, LABELS_PER_SHEET } from "../public/order-labels.js";

test("team downloads individual and date-filtered label sheets without modifying orders", async () => {
  const nodes = new Map(), downloads = [], blobs = [], requests = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", hidden: false, disabled: false, dataset: {}, listeners: {}, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }, setAttribute() {}, focus() {},
      showModal() { this.open = true; }, close() { this.open = false; }, replaceChildren() {},
    });
    return nodes.get(id);
  };
  node("#status-filter").value = "all";
  const base = { id: "VB-1", first_name: "Léa", last_name: "Müller", email: "test@example.invalid", role: "Teacher", date: "2026-10-26", status: "received", fulfillment: "staff", total: 700, quantity: 2, items: [{ name: "Red Berries", qty: 2, price: 350 }] };
  const orders = [base, { ...base, id: "VB-2", date: "2026-10-27", fulfillment: "fridge" }, { ...base, id: "VB-3", status: "cancelled" }];
  const scope = { orderLabels, createLabelsDocx, LABELS_PER_SHEET,
    document: { querySelector: node, body: { append() {} }, createElement() { return { click() { downloads.push(this.download); }, remove() {} }; } },
    window: { scrollTo() {} }, money: () => "", formatDate: () => "", fulfillmentOptions: () => [], setTimeout: () => 1, clearTimeout() {},
    URL: { createObjectURL(blob) { blobs.push(blob); return "blob:test"; }, revokeObjectURL() {} },
    fetch: async (url, init) => {
      requests.push({ url, method: init.method });
      return { ok: true, json: async () => url.endsWith("/session") ? { csrf: "test" } : url === "api/catalog" ? { products: [] } : { orders } };
    },
  };
  const code = readFileSync(new URL("../public/admin.js", import.meta.url), "utf8").replace(/^import .+;$/gm, "");
  await vm.runInNewContext("(async()=>{" + code + "})()", scope);
  assert.equal((node("#admin-orders").innerHTML.match(/data-labels=/g) || []).length, 2);
  node("#export-labels").listeners.click[0]();
  assert.match(node("#labels-summary").textContent, /^4 étiquettes/);
  node("#labels-start").value = "51";
  node("#labels-start").listeners.input[0]();
  assert.match(node("#labels-summary").textContent, /2 feuilles/);
  node("#labels-form").listeners.submit[0]({ preventDefault() {} });
  assert.equal(downloads[0], "vitaminboost-etiquettes.docx");
  assert.ok(blobs[0].size > 1000);
  node("#date-filter").value = "2026-10-27";
  node("#date-filter").listeners.change[0]();
  node("#export-labels").listeners.click[0]();
  assert.match(node("#labels-summary").textContent, /^2 étiquettes/);
  node("#labels-form").listeners.submit[0]({ preventDefault() {} });
  assert.equal(downloads[1], "vitaminboost-etiquettes-2026-10-27.docx");
  for (const fn of node("#admin-orders").listeners.click) await fn({ target: { closest: selector => selector === "[data-labels]" ? { dataset: { labels: "VB-1" } } : null } });
  assert.match(node("#labels-summary").textContent, /^2 étiquettes/);
  node("#labels-form").listeners.submit[0]({ preventDefault() {} });
  assert.equal(downloads[2], "vitaminboost-etiquettes-VB-1.docx");
  node("#date-filter").value = "2026-11-01";
  node("#date-filter").listeners.change[0]();
  assert.equal(node("#export-labels").disabled, true);
  assert.ok(requests.every(r => r.method === "GET"));
});
