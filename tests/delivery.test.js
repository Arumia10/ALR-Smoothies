import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createD1Store } from '../cloudflare/store.js';
import { availableDates, STAFF_DELIVERY_LOCATIONS } from '../public/schedule.js';
function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0001_legacy_compatibility.sql', '0002_cherry_berry_unavailable.sql', '0003_cancellation_emails.sql', '0004_ginger_shot.sql', '0005_product_weekly_limits.sql', '0007_wero_payment_declarations.sql'])
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

const now = new Date('2026-10-04T12:00:00Z');
const input = (patch = {}) => ({firstName:'Test',lastName:'Customer',email:'customer@example.invalid',role:'Teacher',date:'2026-10-05',fulfillment:'delivery',room:' B204 ',items:[{id:'red-berries',qty:1}],expectedTotal:350,...patch});
const options = {now,email:{from:'VitaminBoost <order@example.invalid>'}};
test('Monday delivery saves normalized destinations in D1, legacy orders and confirmation emails', async t => {
  const {sql,store} = fixture(t);
  const cases = [
    [input(), 'B204'],
    ...STAFF_DELIVERY_LOCATIONS.filter(d=>d.id!=='other').map(d=>[input({role:'Other',deliveryDepartment:d.id,room:'ignored'}),d.label]),
    [input({role:'Other',deliveryDepartment:'other',room:' Salle <B204> & accueil '}), 'Salle <B204> & accueil'],
  ];
  for (const [data,destination] of cases) {
    const receipt = await store.place(data,randomUUID(),options);
    const saved = sql.prepare('SELECT room,delivery_location FROM vb_orders WHERE id=?').get(receipt.reference);
    assert.equal(saved.room,destination);
    assert.equal(saved.delivery_location,'Livraison à l’école · '+destination+' · Lundi · 09 h 30 à 09 h 45');
    assert.equal(sql.prepare('SELECT delivery_location FROM orders WHERE order_number=?').get(receipt.reference).delivery_location,saved.delivery_location);
    const email = JSON.parse(sql.prepare('SELECT payload FROM vb_email_outbox WHERE order_id=?').get(receipt.reference).payload);
    assert.ok(email.text.includes(destination));
    assert.match(email.text,/Paiement à la livraison/);
    assert.match(email.html,/Votre livraison/);
    assert.doesNotMatch(email.html,/au retrait|<B204>/);
  }
  assert.equal((await store.list()).length,cases.length);
});
test('delivery rejects Tuesday, students and missing or invalid destinations without saving orders',async t=>{
  const {sql,store}=fixture(t);
  for(const patch of [
    {date:'2026-10-06'}, {role:'Student'}, {room:''}, {room:' '.repeat(4)}, {room:'x'.repeat(81)}, {room:'B204\n'}, {room:{}},
    {role:'Other'}, {role:'Other',deliveryDepartment:'unknown'}, {role:'Other',deliveryDepartment:'other',room:''},
  ]) await assert.rejects(store.place(input(patch),randomUUID(),options),{status:400});
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM vb_orders').get().n,0);
});
test('pickup discards stale delivery fields and retains pickup email wording',async t=>{
  const {sql,store}=fixture(t);
  await store.place(input({role:'Other',date:'2026-10-06',fulfillment:'fridge',deliveryDepartment:'direction'}),randomUUID(),options);
  assert.equal(sql.prepare('SELECT room FROM vb_orders').get().room,'');
  const email=JSON.parse(sql.prepare('SELECT payload FROM vb_email_outbox').get().payload);
  assert.match(email.html,/Votre retrait/);
  assert.doesNotMatch(email.text,/B204|Direction/);
});
