import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID, scryptSync } from 'node:crypto';
import { createD1Store } from '../cloudflare/store.js';
import { createWorker } from '../cloudflare/worker.js';
import { buildCancellation, sendCancellation } from '../cloudflare/integrations.js';
import { availableDates } from '../public/schedule.js';

function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0001_legacy_compatibility.sql', '0002_cherry_berry_unavailable.sql', '0003_cancellation_emails.sql'])
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
const from = {from:'VitaminBoost <order@example.invalid>'};
const env = {RESEND_API_KEY:'fictional-test-key'};

test('cancellation preserves reason, confirmation and legacy data; replay cannot overwrite reason', async t => {
  const {sql,store,place} = fixture(t);
  const order = await place();
  const confirmation = sql.prepare('SELECT payload FROM vb_email_outbox').get().payload;
  await store.updateOrder(order.reference,{status:'cancelled',cancellationReason:'Plus de fruits.\nMerci de votre compréhension.'},from);
  await store.updateOrder(order.reference,{status:'cancelled',cancellationReason:'Replacement'},from);
  const saved = sql.prepare('SELECT * FROM vb_cancellation_emails').get();
  assert.equal(saved.reason,'Plus de fruits.\nMerci de votre compréhension.');
  assert.equal(sql.prepare('SELECT status FROM vb_orders').get().status,'cancelled');
  assert.equal(sql.prepare('SELECT payload FROM vb_email_outbox').get().payload,confirmation);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM orders').get().n,1);
  assert.equal((await store.list())[0].cancellation_reason,saved.reason);
  assert.deepEqual(JSON.parse(saved.payload).to,['customer@example.invalid']);
});
test('invalid reason leaves order active; outbox failure rolls back cancellation', async t => {
  const {sql,store,place} = fixture(t); const order = await place();
  for(const value of ['x'.repeat(1001),{},null]) await assert.rejects(store.updateOrder(order.reference,{status:'cancelled',cancellationReason:value},from),{status:400});
  sql.exec("CREATE TRIGGER reject_cancel BEFORE INSERT ON vb_cancellation_emails BEGIN SELECT RAISE(ABORT,'test_failure'); END;");
  await assert.rejects(store.updateOrder(order.reference,{status:'cancelled'},from),/test_failure/);
  assert.equal(sql.prepare('SELECT status FROM vb_orders').get().status,'received');
});
test('cancellation sends once, uses separate key, preserves payload on retry and stops old uncertain retries',async t=>{
  const {sql,db,store,place}=fixture(t);const order=await place();
  await store.updateOrder(order.reference,{status:'cancelled'},from);
  const calls=[];const fake=async(url,init)=>{calls.push(init);return calls.length===1?new Response('',{status:503}):Response.json({id:'fake-id'});};
  assert.equal(await sendCancellation(db,order.reference,env,fake,1000),'failed');
  await Promise.all(Array.from({length:5},()=>sendCancellation(db,order.reference,env,fake,2000)));
  assert.equal(calls.length,2);
  assert.equal(calls[0].body,calls[1].body);
  assert.equal(calls[0].headers['Idempotency-Key'],'order-cancellation/'+order.reference);
  assert.equal(await sendCancellation(db,order.reference,env,fake,3000),'sent');
  sql.exec("UPDATE vb_cancellation_emails SET status='failed',first_attempt=0");
  assert.equal(await sendCancellation(db,order.reference,env,fake,23*3600000),'review');
  assert.equal(calls.length,2);
});
test('email escapes reason and names and never promises an automatic refund',()=>{
  const mail=buildCancellation({id:'VB-TEST',first_name:'<img>',date:'2026-10-12',email:'customer@example.invalid',payment_status:'paid'},'<script>alert(1)</script>\nPas de stock',from);
  assert.ok(!mail.html.includes('<script>'));
  assert.match(mail.html,/&lt;script&gt;/);
  assert.match(mail.text,/organiser le remboursement/);
  assert.match(mail.text,/Pas de stock/);
});
test('preview cancellation saves message but sends no email; collected order cannot be cancelled',async t=>{
  const {sql,db,store,place}=fixture(t);const order=await place();
  await store.updateOrder(order.reference,{status:'preparing'});
  await store.updateOrder(order.reference,{status:'ready'});
  await store.updateOrder(order.reference,{status:'collected',paymentStatus:'paid'});
  await assert.rejects(store.updateOrder(order.reference,{status:'cancelled'},from),{status:409});
  sql.exec('UPDATE vb_orders SET demo=1');
  const preview=createD1Store(db,true);
  const receipt=await preview.place({firstName:'Demo',lastName:'Test',email:'demo@example.invalid',role:'Teacher',date:availableDates('Teacher')[0],fulfillment:'fridge',items:[{id:'red-berries',qty:1}],expectedTotal:350},randomUUID());
  await preview.updateOrder(receipt.reference,{status:'cancelled',cancellationReason:'Test'});
  assert.equal(await sendCancellation(db,receipt.reference,env,()=>{throw Error('must not send')}),'not_required');
});
test('worker requires login and CSRF, reports failed cancellation email and allows safe retry',async t=>{
  const {db,sql,place}=fixture(t);const order=await place();
  const origin='https://vitaminboost.test',salt='a'.repeat(32),password='fictional-test-password';
  const vars={...env,DB:db,ORDER_MODE:'live',PUBLIC_ORIGIN:origin,LIVE_SETUP_CONFIRMED:'true',TURNSTILE_SECRET:'fake',TURNSTILE_SITE_KEY:'fake',EMAIL_FROM:from.from,ORDER_NOTIFICATION_EMAIL:'team@example.invalid',ADMIN_PASSWORD_HASH:salt+':'+scryptSync(password,salt,64).toString('hex')};
  let sends=0; const worker=createWorker(async()=>++sends===1?new Response('',{status:503}):Response.json({id:'test-id'}));
  const req=(url,method,body,headers={})=>worker.fetch(new Request(origin+url,{method,headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),vars);
  const route='/api/admin/orders/'+order.reference;
  assert.equal((await req(route,'PATCH',{status:'cancelled'})).status,401);
  const login=await req('/api/admin/login','POST',{password}); assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrf;
  assert.equal((await req(route,'PATCH',{status:'cancelled'},{Cookie:cookie})).status,403);
  const headers={Cookie:cookie,'X-CSRF-Token':csrf};
  const result=await req(route,'PATCH',{status:'cancelled',cancellationReason:'Rupture de stock'},headers);
  assert.equal(result.status,200);assert.equal((await result.json()).cancellationEmailStatus,'failed');
  const retry=await req('/api/admin/cancellation-email/'+order.reference,'POST',{},headers);
  assert.equal((await retry.json()).emailStatus,'sent');
  assert.equal((await req('/api/admin/email/'+order.reference,'POST',{},headers)).status,409);
  await req(route,'PATCH',{status:'cancelled'},headers);assert.equal(sends,2);
});
