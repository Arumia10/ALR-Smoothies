import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('admin opens a reason dialog without cancelling, then sends the message only on confirmation',async()=>{
  const nodes=new Map(), requests=[];
  const node=(id)=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,open:false,dataset:{},listeners:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},replaceChildren(){},focus(){},reset(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)},querySelectorAll(){return [node('submit-button'),node('#cancel-back'),node('#cancel-reason')]}});return nodes.get(id)};
  node('#status-filter').value='all';
  const order={id:'VB-TEST',first_name:'Client',last_name:'Test',email:'test@example.invalid',role:'Teacher',date:'2026-10-12',fulfillment:'staff',status:'received',payment_status:'unpaid',total:350,quantity:1,items:[{name:'Red Berries',qty:1,price:350}],demo:0};
  const code=readFileSync(new URL('../public/admin.js',import.meta.url),'utf8').replace(/^import .+;$/gm,'');
  const scope={document:{querySelector:node},window:{scrollTo(){}},money:()=> '3,50 €',formatDate:()=> 'lundi 12 octobre',fulfillmentOptions:()=>[],setTimeout:()=>1,clearTimeout(){},confirm(){throw Error('unexpected native confirm')},fetch:async(url,init)=>{
    requests.push({url,...init});
    if(init.method==='PATCH'){order.status='cancelled';order.cancellation_reason=JSON.parse(init.body).cancellationReason;order.cancellation_email_status='sent';return {ok:true,json:async()=>({cancellationEmailStatus:'sent'})}}
    const response=url.endsWith('/session')?{csrf:'test-csrf'}:url==='api/catalog'?{products:[],demo:false}: {orders:[order],demo:false};
    return {ok:true,json:async()=>response};
  }};
  await vm.runInNewContext('(async()=>{'+code+'})()',scope);
  for(const fn of node('#admin-orders').listeners.click) await fn({target:{closest:selector=>selector==='[data-order]'?{dataset:{order:order.id,status:'cancelled'}}:null}});
  assert.equal(node('#cancel-dialog').open,true);
  assert.equal(requests.filter(r=>r.method==='PATCH').length,0);
  node('#cancel-reason').value='Plus de fruits <test>';
  await node('#cancel-form').listeners.submit[0]({preventDefault(){},target:node('#cancel-form')});
  const saved=requests.find(r=>r.method==='PATCH');
  assert.equal(JSON.parse(saved.body).cancellationReason,'Plus de fruits <test>');
  assert.equal(saved.headers['X-CSRF-Token'],'test-csrf');
  assert.equal(node('#cancel-dialog').open,false);
  assert.match(node('#admin-orders').innerHTML,/Plus de fruits &lt;test&gt;/);
  assert.ok(!node('#admin-orders').innerHTML.includes('data-email='));
});
