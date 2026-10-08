import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function setup(){
  const nodes=new Map(), timers=new Map(), scripts=[], renders=[], removed=[];let seq=0,readyCallback;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',checked:false,disabled:false,listeners:{},classList:{add(){},remove(){}},focus(){},addEventListener(e,fn){this.listeners[e]=fn}});return nodes.get(id)};
  const api={ready(fn){readyCallback=fn},render(selector,config){renders.push(config);return String(renders.length)},remove(id){removed.push(id)}};
  const scope={service:{turnstileSiteKey:'fake-test-key'},submitting:false,checkout:{open:true,addEventListener(e,fn){this[e]=fn}},form:{hidden:false,reportValidity:()=>true,addEventListener(e,fn){this[e]=fn}},$:node,document:{createElement:()=>({remove(){this.removed=true}}),head:{append(s){scripts.push(s)}}},window:{},requestAnimationFrame:fn=>{fn();return 1},setTimeout(fn,delay){const id=++seq;timers.set(id,{fn,delay});return id},clearTimeout:id=>timers.delete(id),resetSubmit(){node('#place-order').disabled=!vm.runInContext('turnstileToken',context)},details:()=>({}),renderReview(){}};
  const context=vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('let turnstileToken'),source.indexOf('function resetSubmit()')),context);
  const formStart=source.indexOf('form.addEventListener("submit"');
  vm.runInContext(source.slice(formStart,source.indexOf('$("#back-details")',formStart)),context);
  const flush=async()=>{for(let n=0;n<10;n++)await Promise.resolve()};
  return {node,scope,scripts,renders,removed,timers,flush,run:code=>vm.runInContext(code,context),load:async()=>{scope.window.turnstile=api;scripts.at(-1).onload();readyCallback();await flush()},ready:async()=>{readyCallback();await flush()},tick:async delay=>{const entry=[...timers].find(([,t])=>t.delay===delay);assert.ok(entry,'missing timer '+delay);timers.delete(entry[0]);entry[1].fn();await flush()}};
}
test('first review starts verification automatically after script ready, with retry hidden',async()=>{
  const f=setup();f.node('#review-step').hidden=true;
  f.scope.form.submit({preventDefault(){}});
  assert.equal(f.scripts.length,1);assert.equal(f.node('#security-retry').hidden,true);
  await f.load();assert.equal(f.renders.length,1);
  assert.equal(f.renders[0].execution,'render');assert.equal(f.renders[0]['refresh-expired'],'auto');
  f.renders[0].callback('valid-token');
  assert.equal(f.node('#place-order').disabled,false);assert.equal(f.node('#security-retry').hidden,true);
});
test('preloading is shared with checkout and waits for readiness',async()=>{
  const f=setup();const preload=f.run('loadTurnstile()');const start=f.run('prepareTurnstile()');
  assert.equal(f.scripts.length,1);await f.load();await Promise.all([preload,start]);assert.equal(f.renders.length,1);
});
test('failed script load retries automatically once then exposes fallback',async()=>{
  const f=setup();f.run('prepareTurnstile()');f.scripts[0].onerror();await f.flush();
  assert.equal(f.node('#security-retry').hidden,true);await f.tick(1000);assert.equal(f.scripts.length,2);
  f.scripts[1].onerror();await f.flush();assert.equal(f.node('#security-retry').hidden,false);assert.equal(f.node('#place-order').disabled,true);
});
test('stalled challenge restarts once and a successful automatic retry enables submission',async()=>{
  const f=setup();f.run('prepareTurnstile()');await f.load();await f.tick(20000);await f.tick(1000);
  assert.equal(f.renders.length,2);assert.deepEqual(f.removed,['1']);f.renders[1].callback('new-token');assert.equal(f.node('#place-order').disabled,false);
});
test('expiry clears stale token and waits for automatic refreshed token',async()=>{
  const f=setup();f.run('prepareTurnstile()');await f.load();f.renders[0].callback('old-token');f.renders[0]['expired-callback']();
  assert.equal(f.node('#place-order').disabled,true);assert.equal(f.node('#security-retry').hidden,true);
  f.renders[0].callback('fresh-token');assert.equal(f.node('#place-order').disabled,false);
});
test('closing checkout before loading completes prevents hidden widget and stale callbacks',async()=>{
  const f=setup();f.run('prepareTurnstile()');f.scope.checkout.open=false;f.scope.checkout.close();await f.load();assert.equal(f.renders.length,0);
  f.scope.checkout.open=true;await f.run('prepareTurnstile()');f.run('stopTurnstile()');f.renders[0].callback('stale');assert.equal(f.run('turnstileToken'),'');
});
test('interactive challenge is not interrupted by the automatic restart timer',async()=>{
  const f=setup();f.run('prepareTurnstile()');await f.load();f.renders[0]['before-interactive-callback']();
  assert.equal([...f.timers.values()].filter(t=>t.delay===20000).length,0);
  assert.match(f.node('#security-message').textContent,/ci-dessus/);
});
test('overlapping initializations render only the latest widget and no verification is bypassed',async()=>{
  const f=setup();const a=f.run('prepareTurnstile()'),b=f.run('prepareTurnstile()');await f.load();await Promise.all([a,b]);assert.equal(f.renders.length,1);assert.equal(f.node('#place-order').disabled,true);
  f.scope.submitting=true;await f.run('prepareTurnstile()');assert.equal(f.renders.length,1);
});
