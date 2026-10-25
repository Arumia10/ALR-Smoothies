import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { createD1Store } from "../cloudflare/store.js";
import { createStore } from "../lib/store.js";
import { createWorker } from "../cloudflare/worker.js";
import { reminderWindow, runWeeklyReminders, buildReminder } from "../cloudflare/reminders.js";

const saturday = new Date("2026-10-24T10:00:00Z");
const sunday = Date.parse("2026-10-25T09:00:00Z");
const data = patch => ({ firstName: "Léa", lastName: "Test", email: "LEA@example.invalid", role: "Teacher", date: "2026-10-26", fulfillment: "staff", items: [{id:"red-berries",qty:1}], expectedTotal:350, ...patch });
const options = {now:saturday};
function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec("PRAGMA foreign_keys=ON");
  const migrations = new URL("../migrations-legacy/", import.meta.url);
  for (const file of readdirSync(migrations).filter(s=>s.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(file,migrations),"utf8"));
  const db = {
    prepare(query) {
      const statement = (args = []) => ({
        bind: (...values) => statement(values),
        first: async () => sql.prepare(query).get(...args) || null,
        all: async () => ({results:sql.prepare(query).all(...args)}),
        run: async () => ({meta:sql.prepare(query).run(...args)}),
        execute: () => ({results:sql.prepare(query).all(...args)}),
      });
      return statement();
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {const result = statements.map(s=>s.execute());sql.exec("COMMIT");return result;}
      catch(error){sql.exec("ROLLBACK");throw error;}
    },
    withSession(){return db;},
  };
  const env = {DB:db,ORDER_MODE:"live",LIVE_SETUP_CONFIRMED:"true",PUBLIC_ORIGIN:"https://vitaminboost.test",EMAIL_FROM:"VitaminBoost <test@example.invalid>",RESEND_API_KEY:"fake-key"};
  const store = createD1Store(db,false);
  const subscription = () => sql.prepare("SELECT * FROM vb_reminder_subscriptions").get();
  const queue = () => sql.prepare("SELECT * FROM vb_weekly_reminders ORDER BY sunday,email").all();
  const requests = [];
  const fetcher = async (url,init) => { requests.push({url,...init}); return Response.json({id:"fake-"+requests.length}); };
  const run = (time=sunday,send=fetcher,overrides={}) => runWeeklyReminders({...env,...overrides},send,{time,clock:()=>time,sleep:async()=>{}});
  return {sql,db,env,store,subscription,queue,requests,run,fetcher};
}

test("preferences require a successful real order; default legacy requests and demo do not subscribe",async t=>{
  const f=fixture(t);
  await f.store.place(data(),randomUUID(),options);assert.equal(f.subscription(),undefined);
  await assert.rejects(f.store.place(data({weeklyReminder:"true"}),randomUUID(),options),/rappel/);
  await assert.rejects(f.store.place(data({weeklyReminder:true}),randomUUID(),{...options,capacity:1}),/capacité/);
  assert.equal(f.subscription(),undefined);
  await createD1Store(f.db,true).place(data({weeklyReminder:true}),randomUUID(),options);
  assert.equal(f.subscription(),undefined);
  const key=randomUUID(), input=data({weeklyReminder:true});
  await f.store.place(input,key,options);
  assert.equal(f.subscription().email,"lea@example.invalid");assert.equal(f.subscription().enabled,1);
  const token=f.subscription().token;
  await f.store.place(data({weeklyReminder:false}),randomUUID(),options);
  assert.equal(f.subscription().enabled,0);assert.equal(f.subscription().token,token);
  await f.store.place(input,key,options);assert.equal(f.subscription().enabled,0);
  await f.store.place(input,randomUUID(),options);assert.equal(f.subscription().enabled,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM vb_reminder_subscriptions").get().n,1);
});

test("subscription persistence and the order are atomic, including simultaneous idempotent retries",async t=>{
  const f=fixture(t);
  f.sql.exec("CREATE TRIGGER reject_subscription BEFORE INSERT ON vb_reminder_subscriptions BEGIN SELECT RAISE(ABORT,'test'); END");
  await assert.rejects(f.store.place(data({weeklyReminder:true}),randomUUID(),options));
  assert.equal(f.sql.prepare("SELECT count(*) n FROM vb_orders").get().n,0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM orders").get().n,0);
  f.sql.exec("DROP TRIGGER reject_subscription");
  const key=randomUUID();
  const receipts=await Promise.all([f.store.place(data({weeklyReminder:true}),key,options),f.store.place(data({weeklyReminder:true}),key,options)]);
  assert.equal(receipts[0].reference,receipts[1].reference);
  assert.equal(f.subscription().source_order_id,receipts[0].reference);
});

test("Sunday 10:00 follows Luxembourg summer/winter time including both DST change days",()=>{
  for(const [before,at] of [
    ["2026-07-12T07:59:59Z","2026-07-12T08:00:00Z"],
    ["2026-11-01T08:59:59Z","2026-11-01T09:00:00Z"],
    ["2026-03-29T07:59:59Z","2026-03-29T08:00:00Z"],
    ["2026-10-25T08:59:59Z","2026-10-25T09:00:00Z"],
  ]) {
    assert.equal(reminderWindow(Date.parse(before)),null);
    assert.equal(reminderWindow(Date.parse(at)).cutoff,Date.parse(at));
    assert.equal(reminderWindow(Date.parse(at)+4*3600000).cutoff,Date.parse(at));
  }
  assert.equal(reminderWindow(Date.parse("2026-10-26T09:00:00Z")),null);
  assert.equal(reminderWindow(Date.parse("2026-10-25T22:00:00Z")),null);
});

test("only opted-in customers receive one individual reminder per Sunday; reminders recur next week",async t=>{
  const f=fixture(t);
  for(const patch of [{weeklyReminder:true},{weeklyReminder:true},{email:"no@example.invalid",weeklyReminder:false},{email:"old@example.invalid"}]) await f.store.place(data(patch),randomUUID(),options);
  await f.run(sunday-1);assert.equal(f.requests.length,0);
  await f.run();await f.run(sunday+60000);
  assert.equal(f.requests.length,1);assert.equal(f.queue()[0].status,"sent");
  const payload=JSON.parse(f.requests[0].body);
  assert.deepEqual(payload.to,["lea@example.invalid"]);assert.equal(payload.bcc,undefined);
  assert.match(payload.text,/https:\/\/vitaminboost.test\/#menu/);
  assert.match(payload.headers["List-Unsubscribe"],/unsubscribe\/[a-f0-9]{64}/);
  await f.run(sunday+7*86400000);assert.equal(f.requests.length,2);
  assert.notEqual(f.requests[0].headers["Idempotency-Key"],f.requests[1].headers["Idempotency-Key"]);
});

test("retry after an uncertain provider response uses the exact same payload and key",async t=>{
  const f=fixture(t);await f.store.place(data({weeklyReminder:true}),randomUUID(),options);
  await f.run(sunday,async(url,init)=>{f.requests.push({url,...init});throw new Error("response lost");});
  assert.equal(f.queue()[0].status,"failed");
  await f.run(sunday+60000);assert.equal(f.requests.length,1);
  f.sql.prepare("UPDATE vb_reminder_subscriptions SET first_name='Changed'").run();
  await f.run(sunday+5*60000);
  assert.equal(f.requests[0].body,f.requests[1].body);
  assert.equal(f.requests[0].headers["Idempotency-Key"],f.requests[1].headers["Idempotency-Key"]);
  assert.equal(f.queue()[0].attempts,2);assert.equal(f.queue()[0].status,"sent");
});

test("concurrent schedules cannot claim the same reminder; abandoned leases recover safely",async t=>{
  const f=fixture(t);await f.store.place(data({weeklyReminder:true}),randomUUID(),options);
  await Promise.all([f.run(),f.run()]);assert.equal(f.requests.length,1);
  f.sql.prepare("UPDATE vb_weekly_reminders SET status='sending',lease_until=?").run(sunday+120000);
  await f.run(sunday+60000);assert.equal(f.requests.length,1);
  await f.run(sunday+120000);assert.equal(f.requests.length,2);
  assert.equal(f.requests[0].headers["Idempotency-Key"],f.requests[1].headers["Idempotency-Key"]);
});

test("unsubscribe GET is scanner-safe; POST disables future and queued reminders without login",async t=>{
  const f=fixture(t);await f.store.place(data({weeklyReminder:true}),randomUUID(),options);
  await f.run(sunday,async()=>new Response("",{status:503}));
  const worker=createWorker(f.fetcher);
  const url=`https://vitaminboost.test/api/reminders/unsubscribe/${f.subscription().token}`;
  const get=await worker.fetch(new Request(url),{DB:f.db});
  assert.equal(get.status,200);assert.match(await get.text(),/Me désinscrire/);assert.equal(f.subscription().enabled,1);
  assert.equal(get.headers.get("referrer-policy"),"no-referrer");
  const bad=await worker.fetch(new Request(url,{method:"POST",headers:{origin:"https://other.test"}}),f.env);assert.equal(bad.status,403);
  const post=await worker.fetch(new Request(url,{method:"POST",body:"List-Unsubscribe=One-Click"}),{DB:f.db});
  assert.equal(post.status,200);assert.equal(f.subscription().enabled,0);assert.equal(f.queue()[0].status,"cancelled");
  assert.equal((await worker.fetch(new Request(url,{method:"POST"}),f.env)).status,200);
  await f.run(sunday+5*60000);await f.run(sunday+7*86400000);assert.equal(f.requests.length,0);
  assert.equal(f.sql.prepare("SELECT status FROM vb_orders").get().status,"received");
  assert.equal((await worker.fetch(new Request(url.replace(/[a-f0-9]{64}$/, "a".repeat(64))),f.env)).status,404);
});

test("late subscriptions start next Sunday; preview and paused ordering never send reminders",async t=>{
  const f=fixture(t);await f.store.place(data({weeklyReminder:true}),randomUUID(),{now:new Date(sunday+1000)});
  await f.run(sunday+60000);assert.equal(f.requests.length,0);
  const next=sunday+7*86400000;
  for(const env of [{ORDER_MODE:"preview"},{ORDERS_OPEN:"false"},{LIVE_SETUP_CONFIRMED:"false"}]) await f.run(next,f.fetcher,env);
  assert.equal(f.requests.length,0);
  await assert.rejects(f.run(next,f.fetcher,{PUBLIC_ORIGIN:"http://unsafe.test"}),/configuration/);
  await f.run(next);assert.equal(f.requests.length,1);
});

test("rate limits pause a batch; old uncertain sends and permanent errors are not retried forever",async t=>{
  const f=fixture(t);await f.store.place(data({weeklyReminder:true}),randomUUID(),options);
  await f.run(sunday,async()=>new Response("",{status:429}));
  assert.equal(f.queue()[0].last_error,"provider_http_429");
  f.sql.prepare("UPDATE vb_weekly_reminders SET first_attempt=?").run(sunday-24*3600000);
  await f.run(sunday+5*60000);assert.equal(f.queue()[0].status,"review");assert.equal(f.requests.length,0);
  await f.run(sunday+7*86400000,async()=>new Response("",{status:422}));
  assert.equal(f.queue()[1].status,"review");
});

test("batches continue next minute and unsubscribe removes a waiting recipient",async t=>{
  const f=fixture(t);
  const insert=f.sql.prepare("INSERT INTO vb_reminder_subscriptions VALUES(?,?,?,?,?,?)");
  for(let n=0;n<23;n++)insert.run(`person${n}@example.invalid`,"Test",1,n.toString(16).padStart(64,"0"),saturday.getTime(),`test-${n}`);
  await f.run();assert.equal(f.requests.length,20);
  const pending=f.sql.prepare("SELECT email FROM vb_weekly_reminders WHERE status='pending' LIMIT 1").get();
  f.sql.prepare("UPDATE vb_reminder_subscriptions SET enabled=0 WHERE email=?").run(pending.email);
  await f.run(sunday+60000);assert.equal(f.requests.length,22);
  assert.equal(f.queue().filter(r=>r.status==='cancelled').length,1);
});

test("HTML names are escaped and the checkout sends the current optional checkbox value",()=>{
  assert.match(buildReminder({email:"test@example.invalid",first_name:"<script>x</script>",token:"a".repeat(64)},{PUBLIC_ORIGIN:"https://vitaminboost.test",EMAIL_FROM:"test@example.invalid"}).html,/&lt;script&gt;/);
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(html,/<input[^>]+id="weekly-reminder"[^>]+checked[^>]*>/);
  assert.ok(html.indexOf('id="weekly-reminder"')<html.indexOf('id="place-order"'));
  const code=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const checkbox={checked:true};
  const context=vm.createContext({$:()=>checkbox,form:{},FormData:class{get(name){return {firstName:"Test",lastName:"Customer",email:"test@example.invalid",fulfillment:"staff"}[name]??"";}},cartLines:()=>[],total:()=>0});
  vm.runInContext(code.slice(code.indexOf("function details()"),code.indexOf("function fulfillmentText")),context);
  assert.equal(vm.runInContext("details().weeklyReminder",context),true);
  checkbox.checked=false;assert.equal(vm.runInContext("details().weeklyReminder",context),false);
});

test("local store saves the same opt-in preference transactionally without scheduling mail",t=>{
  const store=createStore();t.after(()=>store.db.close());
  store.place(data({weeklyReminder:true}),randomUUID(),{...options,demo:true});
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM vb_reminder_subscriptions").get().n,0);
  const key=randomUUID();store.place(data({weeklyReminder:true}),key,{...options,demo:false});
  store.place(data({weeklyReminder:false}),randomUUID(),{...options,demo:false});
  store.place(data({weeklyReminder:true}),key,{...options,demo:false});
  assert.equal(store.db.prepare("SELECT enabled FROM vb_reminder_subscriptions").get().enabled,0);
});
