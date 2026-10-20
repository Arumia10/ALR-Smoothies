import test from "node:test";
import assert from "node:assert/strict";
import { orderLabels, labelDestination, labelsDocumentXml, createLabelsDocx, DOCX_TYPE } from "../public/order-labels.js";
import { createWorker } from "../cloudflare/worker.js";

const order = {
  id: "VB-EXEMPLE", first_name: "Léa", last_name: "Müller", status: "received",
  fulfillment: "staff", items: [{ name: "Red Berries", qty: 2 }, { name: "Ginger Shot", qty: 3 }],
};
test("Cloudflare serves the new label module while keeping application sources private", async () => {
  const fetched = [];
  const env = { ASSETS: { fetch(request) { fetched.push(new URL(request.url).pathname); return new Response("export const test = true;", { headers: { "Content-Type": "text/javascript" } }); } } };
  const worker = createWorker();
  assert.equal((await worker.fetch(new Request("https://example.invalid/order-labels.js"), env)).status, 200);
  assert.deepEqual(fetched, ["/order-labels.js"]);
  assert.equal((await worker.fetch(new Request("https://example.invalid/cloudflare/store.js"), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://example.invalid/order-labels.js", { method: "POST" }), env)).status, 405);
});
test("one label per unit, cancelled orders excluded, test orders clearly marked", () => {
  const labels = orderLabels([order, { ...order, status: "cancelled" }, { ...order, demo: 1 }]);
  assert.equal(labels.length, 10);
  assert.equal(labels.filter(l => l.product === "Red Berries").length, 4);
  assert.equal(labels[0].name, "Léa Müller");
  assert.equal(labels[0].destination, "Retrait : Proffen Konferenz");
  assert.equal(labels[0].demo, false);
  assert.equal(labels[9].demo, true);
  assert.match(labelsDocumentXml(labels), /TEST · Ginger Shot/);
});
test("labels preserve pickup and custom staff/teacher delivery destinations", () => {
  assert.equal(labelDestination({ fulfillment: "library" }), "Retrait : Devant la bibliothèque");
  assert.equal(labelDestination({ fulfillment: "fridge" }), "Retrait : Frigo à l’extérieur du Proffenkonferenz");
  for (const room of ["Service technique", "Secrétariat élèves", "Direction", "Bâtiment A · salle 202"]) {
    assert.equal(labelDestination({ fulfillment: "delivery", room }), "Livraison : " + room);
  }
});
test("empty selections and malformed quantities fail rather than silently losing labels", () => {
  for (const qty of [0, -1, 1.5, "2", 10001]) assert.throws(() => orderLabels([{ ...order, items: [{ qty }] }]));
  assert.throws(() => createLabelsDocx([]), /Aucune étiquette/);
  for (const start of [0, 52, 1.5, NaN]) assert.throws(() => createLabelsDocx(orderLabels([order]), start), /position/);
});
test("51 cells per A4 sheet, exact label dimensions, correct overflow and initial blanks", () => {
  const label = orderLabels([order])[0];
  for (const [count, start, pages] of [[1, 1, 1], [51, 1, 1], [52, 1, 2], [2, 51, 2], [102, 1, 2]]) {
    const xml = labelsDocumentXml(Array(count).fill(label), start);
    assert.equal((xml.match(/<w:tbl>/g) || []).length, pages);
    assert.equal((xml.match(/<w:tc>/g) || []).length, pages * 51);
    assert.equal((xml.match(/<w:tr>/g) || []).length, pages * 17);
    assert.equal((xml.match(/w:type="page"/g) || []).length, pages - 1);
    assert.equal((xml.match(/Léa Müller/g) || []).length, count);
    assert.match(xml, /w:pgSz w:w="11907" w:h="16838"/);
    assert.match(xml, /w:trHeight w:val="958" w:hRule="exact"/);
    assert.match(xml, /w:tcW w:w="3969"/);
    const cells = [...xml.matchAll(/<w:tc>(.*?)<\/w:tc>/g)].map(m => m[1]);
    for (let i = 0; i < start - 1; i++) assert.ok(!cells[i].includes("Léa"));
    assert.ok(cells[start - 1].includes("Léa"));
  }
});
test("XML escapes client content and download is a real DOCX ZIP", async () => {
  const label = { name: 'Zoé <&> "Test"', product: "Ginger Shot", destination: "Livraison : SePAS & Direction" };
  const xml = labelsDocumentXml([label]);
  assert.match(xml, /Zoé &lt;&amp;&gt; &quot;Test&quot;/);
  assert.ok(!xml.includes('Zoé <&>'));
  const blob = createLabelsDocx([label]);
  assert.equal(blob.type, DOCX_TYPE);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), 3);
});
