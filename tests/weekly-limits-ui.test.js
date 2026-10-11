import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('Team form displays stored quotas and sends numbers, zero and unlimited with CSRF',async()=>{
  const nodes=new Map(), requests=[];
  const node=(id)=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,open:false,dataset:{},listeners:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},replaceChildren(){},focus(){},reset(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)},querySelectorAll(){return [node('submit-button'),node('#cancel-back'),node('#cancel-reason')]}});return nodes.get(id)};
  node('#status-filter').value='all';

 const code=readFileSync(new URL('../public/admin.js',import.meta.url),'utf8').replace(/^import .+;$/gm,'');
 const scope={document:{querySelector:node},window:{scrollTo(){}},money:()=>'',formatDate:()=>'',fulfillmentOptions:()=>[],setTimeout:()=>1,clearTimeout(){},fetch:async(url,init)=>{
 requests.push({url,...init});
 const response=init.method==='PATCH'?{}:url.endsWith('/session')?{csrf:'test-csrf'}:url==='api/catalog'?{products:[{id:'ginger-shot',name:'Ginger Shot',price:100,available:true,weeklyLimit:30}],demo:false}:{orders:[],demo:false};
 return {ok:true,json:async()=>response};
 }};
 await vm.runInNewContext('(async()=>{'+code+'})()',scope);
 assert.match(node('#admin-products').innerHTML,/name="weeklyLimit"[^>]+value="30"/);
 const button={disabled:false},form={dataset:{product:'ginger-shot'},querySelector:()=>button,elements:{price:{value:'1.00'},available:{checked:true},weeklyLimit:{value:''}}};
 for(const [text,expected] of [['24',24],['0',0],['',null]]){
 form.elements.weeklyLimit.value=text;
 await node('#admin-products').listeners.submit[0]({preventDefault(){},target:form});
 const saved=requests.at(-1);assert.equal(saved.method,'PATCH');assert.equal(saved.url,'api/admin/products/ginger-shot');
 assert.equal(JSON.parse(saved.body).weeklyLimit,expected);assert.equal(saved.headers['X-CSRF-Token'],'test-csrf');assert.equal(button.disabled,false);
 }
});
