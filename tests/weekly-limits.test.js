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


import { createStore } from '../lib/store.js';
const now = new Date('2026-10-11T12:00:00Z');
const options = {now,email:{from:'VitaminBoost <order@example.invalid>'}};
const data = (qty=1,patch={}) => ({firstName:'Test',lastName:'Customer',email:'test@example.invalid',role:'Teacher',date:'2026-10-12',fulfillment:'fridge',items:[{id:'ginger-shot',qty}],expectedTotal:100*qty,...patch});
const limit = (store,value,id='ginger-shot',price=100) => store.updateProduct(id,{price,available:true,weeklyLimit:value});

test('D1 weekly product limits combine Monday and Tuesday, reset next week and replay safely',async t=>{
 const {store}=fixture(t);await limit(store,3);
 const first=await store.place(data(2),randomUUID(),options);
 const key=randomUUID();const request=data(1,{date:'2026-10-13'});
 const second=await store.place(request,key,options);
 assert.deepEqual(await store.place(request,key,options),second);
 await assert.rejects(store.place(data(),randomUUID(),options),/Ginger Shot n’est plus disponible/);
 await store.place(data(3,{date:'2026-10-19'}),randomUUID(),options);
 assert.equal((await store.list()).length,3);
 await store.updateOrder(first.reference,{status:'cancelled',cancellationReason:'Test'},options.email);
 await store.place(data(2),randomUUID(),options);
 await assert.rejects(store.place(data(),randomUUID(),options),/Ginger Shot/);
});
test('D1 rejects the whole mixed cart, retains existing orders when lowered, and supports zero and unlimited',async t=>{
 const {sql,store}=fixture(t);await limit(store,2);await store.place(data(),randomUUID(),options);
 await assert.rejects(store.place(data(2,{items:[{id:'ginger-shot',qty:2},{id:'red-berries',qty:1}],expectedTotal:550}),randomUUID(),options),/reste que 1/);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM vb_orders').get().n,1);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM vb_email_outbox').get().n,1);
 await limit(store,0);assert.equal((await store.list()).length,1);
 await assert.rejects(store.place(data(),randomUUID(),options),/Ginger Shot/);
 await store.place(data(1,{items:[{id:'red-berries',qty:1}],expectedTotal:350}),randomUUID(),options);
 await limit(store,null);await store.place(data(20),randomUUID(),options);
 await assert.rejects(store.place(data(),randomUUID(),{...options,capacity:1}),/capacité/);
});
test('D1 checks the latest limit and competing bookings atomically at insertion',async t=>{
 const {store}=fixture(t);await limit(store,1);
 await assert.rejects(store.place(data(),randomUUID(),{...options,beforeInsert:()=>store.place(data(),randomUUID(),options)}),/Ginger Shot/);
 assert.equal((await store.list()).length,1);
 await limit(store,5);
 await assert.rejects(store.place(data(),randomUUID(),{...options,beforeInsert:()=>limit(store,1)}),/Ginger Shot/);
 await limit(store,2);
 const results=await Promise.allSettled([store.place(data(),randomUUID(),options),store.place(data(),randomUUID(),options)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await store.list()).length,2);
});
test('D1 counts unlinked legacy items and isolates live and test reservations',async t=>{
 const {sql,db,store}=fixture(t);await limit(store,3);
 sql.prepare('INSERT INTO orders(order_number,pickup_date,order_items) VALUES(?,?,?)').run('OLD','2026-10-13',JSON.stringify([{name:'Ginger Shot',qty:2}]));
 await store.place(data(),randomUUID(),options);
 await assert.rejects(store.place(data(),randomUUID(),options),/Ginger Shot/);
 const demo=createD1Store(db,true);await demo.place(data(3),randomUUID(),options);
 await assert.rejects(demo.place(data(),randomUUID(),options),/Ginger Shot/);
 assert.equal((await store.list()).length,1);
});
test('Product limits persist, accept null and reject invalid values without changing price',async t=>{
 const {store}=fixture(t);assert.equal((await store.catalog()).find(p=>p.id==='ginger-shot').weeklyLimit,null);
 await limit(store,15);assert.equal((await store.catalog()).find(p=>p.id==='ginger-shot').weeklyLimit,15);
 await store.updateProduct('ginger-shot',{price:150,available:true});
 assert.equal((await store.catalog()).find(p=>p.id==='ginger-shot').weeklyLimit,15);
 for(const value of [-1,1.5,'2',true,10001,{},undefined])await assert.rejects(limit(store,value),/maximum hebdomadaire/);
 assert.equal((await store.catalog()).find(p=>p.id==='ginger-shot').price,150);
 await limit(store,null);assert.equal((await store.catalog()).find(p=>p.id==='ginger-shot').weeklyLimit,null);
});
test('Local reservations enforce the same weekly rules and cancellations restore stock',t=>{
 const store=createStore();t.after(()=>store.db.close());limit(store,2);
 const receipt=store.place(data(),randomUUID(),{now});
 store.place(data(1,{date:'2026-10-13'}),randomUUID(),{now});
 assert.throws(()=>store.place(data(),randomUUID(),{now}),/Ginger Shot/);
 store.updateOrder(receipt.reference,{status:'cancelled'});
 store.place(data(),randomUUID(),{now});store.place(data(2,{date:'2026-10-19'}),randomUUID(),{now});
 store.updateProduct('ginger-shot',{price:100,available:true});assert.equal(store.catalog().find(p=>p.id==='ginger-shot').weeklyLimit,2);
 assert.throws(()=>limit(store,-1),/maximum hebdomadaire/);
 limit(store,0);assert.throws(()=>store.place(data(),randomUUID(),{now}),/Ginger Shot/);
 limit(store,null);store.place(data(20),randomUUID(),{now});
});
