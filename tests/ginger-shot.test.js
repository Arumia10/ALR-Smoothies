import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createD1Store } from '../cloudflare/store.js';
import { availableDates } from '../public/schedule.js';
import { PRODUCTS } from '../public/catalog.js';
function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0001_legacy_compatibility.sql', '0002_cherry_berry_unavailable.sql', '0003_cancellation_emails.sql', '0004_ginger_shot.sql', '0005_product_weekly_limits.sql'])
    sql.exec(readFileSync(new URL('../migrations-legacy/' + file, import.meta.url), 'utf8'));
  const db = {
    prepare(query) {
      const statement = (args = []) => ({
        bind: (...values) => statement(values),
        first: async () => sql.prepare(query).get(...args) || null,
        all: async () => ({ results: sql.prepare(query).all(...args) }),
        run: async () => ({ meta: sql.prepare(query).run(...args) }),
        execute: () => ({ results: sql.prepare(query).all(...args) }),
      });
      return statement();
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const results = statements.map(s => s.execute()); sql.exec('COMMIT'); return results; }
      catch(e) { sql.exec('ROLLBACK'); throw e; }
    },
    withSession() { return db; },
  };
  const store = createD1Store(db, false);
  const place = () => store.place({ firstName:'Test', lastName:'Customer', email:'customer@example.invalid', role:'Teacher', date:availableDates('Teacher')[0], fulfillment:'fridge', items:[{id:'red-berries',qty:1}], expectedTotal:350 }, randomUUID(), {email:{from:'VitaminBoost <order@example.invalid>'}});
  return { sql, db, store, place };
}

const now = new Date('2026-10-11T12:00:00Z');
const data = patch => ({firstName:'Test',lastName:'Customer',email:'test@example.invalid',role:'Teacher',date:'2026-10-12',fulfillment:'delivery',room:'B204',items:[{id:'ginger-shot',qty:2}],expectedTotal:PRODUCTS.find(p=>p.id==='ginger-shot').price*2,...patch});
test('Ginger Shot keeps its 40 ml portion, ingredient list, price and image through checkout',async t=>{
  const {sql,store}=fixture(t);const menu=await store.catalog();const shot=menu.find(p=>p.id==='ginger-shot');
  assert.equal(shot.price,100);assert.equal(shot.portion,'40 ml');assert.equal(shot.size,40);assert.equal(shot.category,'shots');assert.equal(shot.preparation,'');assert.ok(shot.available);assert.ok(Number.isInteger(shot.price)&&shot.price>0);
  assert.equal(shot.ingredients,'Gingembre, citron, orange, dattes, une pincée de sel');
  const receipt=await store.place(data(),randomUUID(),{now,email:{from:'VitaminBoost <order@example.invalid>'}});
  const saved=sql.prepare('SELECT * FROM vb_orders WHERE id=?').get(receipt.reference);
  assert.equal(saved.total,shot.price*2);assert.equal(JSON.parse(saved.items)[0].name,'Ginger Shot');
  assert.equal(saved.delivery_location,'Livraison à l’école · B204 · Lundi · 09 h 30 à 09 h 45');
  const mail=JSON.parse(sql.prepare('SELECT payload FROM vb_email_outbox WHERE order_id=?').get(receipt.reference).payload);
  assert.match(mail.html,/ginger-shot.png/);assert.match(mail.text,/09 h 30 à 09 h 45/);
  await assert.rejects(store.place(data({expectedTotal:1}),randomUUID(),{now}),/prix/);
  await store.updateProduct('ginger-shot',{price:shot.price,available:false});
  await assert.rejects(store.place(data(),randomUUID(),{now}),/indisponible/);
});
test('Ginger Shot migration can be repeated without resetting existing prices or availability',t=>{
  const {sql}=fixture(t);sql.prepare("UPDATE vb_products SET price=275,available=0 WHERE id='ginger-shot'").run();
  sql.exec(readFileSync(new URL('../migrations-legacy/0004_ginger_shot.sql',import.meta.url),'utf8'));
  const row=sql.prepare("SELECT price,available FROM vb_products WHERE id='ginger-shot'").get();
  assert.equal(row.price,275);assert.equal(row.available,0);
});
