import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { createD1Store } from "../cloudflare/store.js";
import { createStore } from "../lib/store.js";
import { sendConfirmation } from "../cloudflare/integrations.js";

const now=new Date("2026-10-24T10:00:00Z");
const options={now,email:{from:"VitaminBoost <test@example.invalid>"}};
const input=patch=>({firstName:"Alex",lastName:"Test",email:"test@example.invalid",role:"Teacher",date:"2026-10-26",fulfillment:"staff",items:[{id:"red-berries",qty:2}],expectedTotal:700,paymentMethod:"wero",paymentDeclared:true,...patch});
function fixture(t){
  const sql=new DatabaseSync(":memory:");t.after(()=>sql.close());sql.exec("PRAGMA foreign_keys=ON");
  const folder=new URL("../migrations-legacy/",import.meta.url);
  for(const name of readdirSync(folder).filter(f=>f.endsWith(".sql")).sort())sql.exec(readFileSync(new URL(name,folder),"utf8"));
  const db={
    prepare(query){const statement=(args=[])=>({bind:(...values)=>statement(values),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:sql.prepare(query).run(...args)}),execute:()=>({results:sql.prepare(query).all(...args)})});return statement();},
    async batch(statements){sql.exec("BEGIN");try{const result=statements.map(s=>s.execute());sql.exec("COMMIT");return result;}catch(e){sql.exec("ROLLBACK");throw e;}},
    withSession(){return db;},
  };
  return {sql,db,store:createD1Store(db,false)};
}

test("Wero declaration saves the canonical amount atomically and never marks payment as verified",async t=>{
  const {sql,db,store}=fixture(t), key=randomUUID(), body=input({weeklyReminder:true,paymentStatus:"paid",payment_status:"paid",declaredAmount:1});
  const receipt=await store.place(body,key,options);
  assert.equal(receipt.paymentStatus,"unpaid");assert.equal(receipt.paymentDeclared,true);
  assert.equal(sql.prepare("SELECT amount FROM vb_payment_declarations").get().amount,700);
  assert.equal(sql.prepare("SELECT enabled FROM vb_reminder_subscriptions").get().enabled,1);
  const [order]=await store.list();assert.equal(order.payment_status,"unpaid");assert.ok(order.payment_declared_at);
  const payload=JSON.parse(sql.prepare("SELECT payload FROM vb_email_outbox").get().payload);
  assert.match(payload.text,/déclaré avoir effectué le paiement avec Wero/);assert.match(payload.html,/Total de la commande/);
  assert.doesNotMatch(payload.html,/Total à payer au retrait/);assert.match(payload.text,/vérifiera sa réception et le montant/);
  let sends=0;const fake=async()=>{sends++;return Response.json({id:"fake-wero-email"});};
  await sendConfirmation(db,receipt.reference,{RESEND_API_KEY:"fake"},fake);
  assert.deepEqual(await store.place(body,key,options),receipt);
  await sendConfirmation(db,receipt.reference,{RESEND_API_KEY:"fake"},fake);
  assert.equal(sends,1);assert.equal(sql.prepare("SELECT COUNT(*) n FROM vb_payment_declarations").get().n,1);
  await store.updateOrder(receipt.reference,{status:"preparing"});await store.updateOrder(receipt.reference,{status:"ready"});
  await assert.rejects(store.updateOrder(receipt.reference,{status:"collected"}),/paiement/);
  await store.updateOrder(receipt.reference,{paymentStatus:"paid"});await store.updateOrder(receipt.reference,{status:"collected"});
  assert.equal((await store.list())[0].payment_status,"paid");
});

test("Wero requires an explicit declaration while collection and older clients still work",async t=>{
  const {store,sql}=fixture(t);
  for(const patch of [{paymentDeclared:false},{paymentDeclared:"true"},{paymentDeclared:undefined},{paymentMethod:"other"},{paymentMethod:"collection",paymentDeclared:true}])
    await assert.rejects(store.place(input(patch),randomUUID(),options),/mode de paiement/);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM vb_orders").get().n,0);
  const later=await store.place(input({paymentMethod:"collection",paymentDeclared:false}),randomUUID(),options);
  assert.equal(later.paymentDeclared,false);
  const legacy=input();delete legacy.paymentMethod;delete legacy.paymentDeclared;
  await store.place(legacy,randomUUID(),options);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM vb_payment_declarations").get().n,0);
  assert.match(JSON.parse(sql.prepare("SELECT payload FROM vb_email_outbox LIMIT 1").get().payload).text,/Paiement au retrait/);
});

test("declaration write failure rolls back the order, email and reminder preference",async t=>{
  const {store,sql}=fixture(t);
  sql.exec("CREATE TRIGGER reject_declaration BEFORE INSERT ON vb_payment_declarations BEGIN SELECT RAISE(ABORT,'test'); END");
  await assert.rejects(store.place(input({weeklyReminder:true}),randomUUID(),options));
  for(const table of ["orders","vb_orders","vb_email_outbox","vb_reminder_subscriptions","vb_payment_declarations"])
    assert.equal(sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,table);
});

test("cancelling a declared Wero payment explains reimbursement without claiming money was verified",async t=>{
  const {store,sql}=fixture(t);const receipt=await store.place(input(),randomUUID(),options);
  await store.updateOrder(receipt.reference,{status:"cancelled",cancellationReason:"Produit indisponible"},options.email);
  const mail=JSON.parse(sql.prepare("SELECT payload FROM vb_cancellation_emails").get().payload);
  assert.match(mail.text,/Si vous avez déjà payé, contactez l’équipe/);assert.doesNotMatch(mail.text,/Aucun paiement n’est demandé/);
});

test("local orders keep declarations distinct from verified payment",t=>{
  const store=createStore();t.after(()=>store.db.close());
  const key=randomUUID(), body=input();const receipt=store.place(body,key,options);
  assert.equal(receipt.paymentDeclared,true);assert.equal(receipt.paymentStatus,"unpaid");
  assert.deepEqual(store.place(body,key,options),receipt);
  assert.ok(store.list()[0].payment_declared_at);
  assert.equal(store.db.prepare("SELECT amount FROM payment_declarations").get().amount,700);
});

function browser(){
  const source=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const nodes=new Map(),requests=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,checked:false,disabled:false,textContent:"",innerHTML:"",classList:{add(){},remove(){}},append(){},prepend(){},focus(){}});return nodes.get(id);};
  let fail=false;
  const context=vm.createContext({
    $:node,service:{demo:false},form:{elements:{paymentMethod:{value:"collection"}},reset(){}},submitting:false,turnstileToken:"",orderSnapshot:"",orderKey:"",crypto:{randomUUID},AbortSignal,
    FormData:class{get(name){return {firstName:"Alex",lastName:"Test",email:"test@example.invalid",fulfillment:"staff",role:"Teacher",date:"2026-10-26"}[name]??"";}},
    cartLines:()=>[{id:"red-berries",qty:2}],total:()=>700,money:v=>(v/100).toFixed(2)+" €",formatDate:()=>"lundi",fulfillmentText:()=>"Proffen Konferenz",escapeHTML:String,
    stopTurnstile(){},securityVisible:()=>false,prepareTurnstile(){},persist(){},document:{createElement:()=>({})},
    fetch:async(url,init)=>{requests.push({url,...init});if(fail)throw new TypeError("network");return {ok:true,json:async()=>({reference:"VB-TEST",total:700,date:"2026-10-26",demo:false,paymentDeclared:JSON.parse(init.body).paymentDeclared,emailStatus:"sent"})};},
  });
  vm.runInContext(source.slice(source.indexOf("function details()"),source.indexOf("function fulfillmentText")),context);
  vm.runInContext(source.slice(source.indexOf("function wantsWero()"),source.indexOf('$(".filters").addEventListener')),context);
  return {context,node,requests,run:code=>vm.runInContext(code,context),fail:()=>{fail=true;}};
}

test("checkout shows Wero on selection, sends only on explicit final confirmation, and preserves retries",async()=>{
  const f=browser();f.run("updatePaymentChoice()");assert.equal(f.node("#checkout-wero").hidden,true);
  f.run('form.elements.paymentMethod.value="wero";updatePaymentChoice()');
  assert.equal(f.node("#checkout-wero").hidden,false);assert.equal(f.node("#checkout-wero-total").textContent,"7.00 €");
  assert.match(f.node("#place-order").textContent,/J’ai effectué le paiement/);
  assert.equal(f.requests.length,0);
  await f.run("submitOrder()");assert.equal(f.requests.length,0);
  f.node("#review-consent").checked=true;
  await f.run("submitOrder()");assert.equal(f.requests.length,1);
  const sent=JSON.parse(f.requests[0].body);assert.equal(sent.paymentMethod,"wero");assert.equal(sent.paymentDeclared,true);
  assert.match(f.node("#order-success").innerHTML,/l’équipe vérifiera le paiement/);
  assert.doesNotMatch(f.node("#order-success").innerHTML,/Le paiement s’effectue à la remise/);
  const retry=browser();retry.run('form.elements.paymentMethod.value="wero"');retry.node("#review-consent").checked=true;retry.fail();
  await retry.run("submitOrder()");await retry.run("submitOrder()");
  assert.match(retry.node("#order-error").textContent,/ne payez pas une deuxième fois/);
  assert.equal(retry.requests[0].headers["Idempotency-Key"],retry.requests[1].headers["Idempotency-Key"]);
});

test("preview hides real payment; QR and mobile link use supplied destination and are responsive",()=>{
  const f=browser();f.run('service.demo=true;form.elements.paymentMethod.value="wero";updatePaymentChoice()');
  assert.equal(f.node("#checkout-payment-choice").hidden,true);assert.equal(f.node("#checkout-wero").hidden,true);assert.equal(f.run("details().paymentDeclared"),false);
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(html,/id="checkout-wero-link"[^>]*href="https:\/\/wero-checkout.prod-pci.buckaroo.io\/\?wero-context=eyJzIjoic180NmlSMjN2MCIsImQiOiIyVFBDTSBNaW5pLWVudHJlcHJpc2UiLCJyIjoiMlRQQ00gTWluaS1lbnRyZXByaXNlIn0"[^>]*rel="noopener noreferrer"/);
  assert.match(css,/@media \(max-width: 760px\), \(pointer: coarse\)/);
  assert.match(css,/\.checkout-wero \.wero-desktop \{ display: none; \}/);
  assert.match(html,/id="checkout-wero"[\s\S]*?src="assets\/wero-qr.png"/);
});

test("team label distinguishes a declaration from a received payment",()=>{
  const code=readFileSync(new URL("../public/admin.js",import.meta.url),"utf8");
  const start=code.indexOf("const orderPaymentLabel");const end=code.indexOf(";",start)+1;
  const context=vm.createContext({});vm.runInContext(code.slice(start,end),context);
  assert.match(vm.runInContext('orderPaymentLabel({payment_status:"unpaid",payment_declared_at:"date"})',context),/à vérifier/);
  assert.equal(vm.runInContext('orderPaymentLabel({payment_status:"paid",payment_declared_at:"date"})',context),"Payé");
  assert.equal(vm.runInContext('orderPaymentLabel({payment_status:"unpaid"})',context),"À payer");
});
