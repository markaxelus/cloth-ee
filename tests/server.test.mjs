import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApplication} from '../server/index.mjs';
const app=await createApplication({env:{CATALOG_MODE:'demo',OMNI_MODE:'demo'}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const base=`http://127.0.0.1:${app.server.address().port}`;
async function api(route,payload,method){const r=await fetch(base+route,{method:method||(payload?'POST':'GET'),headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});return {status:r.status,data:r.status===204?null:await r.json()};}
test.after(()=>{app.server.closeAllConnections();app.server.close();});
test('two paired sessions stay isolated, state updates propagate, and deletion revokes access',async()=>{
  const a=(await api('/api/sessions',{})).data,b=(await api('/api/sessions',{})).data;
  assert.match(a.sessionId,/^[a-f0-9]{32}$/);assert.notEqual(a.sessionId,b.sessionId);
  const route='/api/sessions/'+a.sessionId;
  await api(route+'/action',{type:'next'});assert.equal((await api(route)).data.productId,'oat-shirt');assert.equal((await api('/api/sessions/'+b.sessionId)).data.productId,'cloud-tee');
  assert.equal((await api(route+'/action',{type:'select',productId:'invalid'})).status,400);
  const cart=await api(route+'/checkout',{});assert.equal(cart.data.checkoutUrl,null);assert.equal(cart.data.mode,'demo');
  await api(route,undefined,'DELETE');assert.equal((await api(route)).status,404);
});
test('camera frames expire and are absent from session JSON',async()=>{
  const s=(await api('/api/sessions',{})).data,route='/api/sessions/'+s.sessionId;
  await api(route+'/frame',{image:'data:image/jpeg;base64,/9j/2Q=='});assert.equal((await api(route)).data.hasFrame,true);assert.equal((await api(route)).data.frame,undefined);
  app.sessions.get(s.sessionId).frameAt=Date.now()-7000;
  assert.equal((await fetch(base+route+'/frame')).status,204);
});
test('a relayed frame keeps its capture-time pose when newer pose updates arrive',async()=>{
  const s=(await api('/api/sessions',{})).data,route='/api/sessions/'+s.sessionId;
  const captured=Array.from({length:33},()=>({x:.25,y:.4,visibility:.9}));
  await api(route+'/frame',{image:'data:image/jpeg;base64,/9j/2Q==',pose:captured,mirror:true});
  await api(route+'/action',{type:'pose',pose:captured.map(p=>({...p,x:.75}))});
  const r=await fetch(base+route+'/frame');const metadata=JSON.parse(r.headers.get('x-clothee-frame-pose'));
  assert.equal(metadata.pose[0].x,.25);assert.equal(metadata.mirror,true);assert.equal((await api(route)).data.pose[0].x,.75);
});
test('SSE emits initial state and subsequent selection',async()=>{
  const s=(await api('/api/sessions',{})).data,route='/api/sessions/'+s.sessionId;const controller=new AbortController();
  const response=await fetch(base+route+'/events',{signal:controller.signal});assert.equal(response.headers.get('content-type'),'text/event-stream');const reader=response.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/cloud-tee/);
  await api(route+'/action',{type:'select',productId:'oat-shirt'});const second=new TextDecoder().decode((await reader.read()).value);assert.match(second,/oat-shirt/);controller.abort();
});
test('cross-origin writes and private source file reads are rejected',async()=>{
  const r=await fetch(base+'/api/sessions',{method:'POST',headers:{origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);
  assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/..%2fserver%2findex.mjs')).status,404);
});
test('town experiments replay deterministically and isolate one published-passport signal',async()=>{
  const body={days:3,seed:'pitch-demo',publish:[]};
  const first=await api('/api/town/simulate',body),second=await api('/api/town/simulate',body);
  assert.equal(first.status,200);assert.deepEqual(first.data.cumulative,second.data.cumulative);assert.deepEqual(first.data.influence,second.data.influence);
  const changed=await api('/api/town/simulate',{...body,publish:['pellmell']});
  assert.equal(changed.status,200);assert.deepEqual(changed.data.publish,['pellmell']);assert.equal(changed.data.seed,'pitch-demo');
  assert.equal((await api('/api/town/simulate',{...body,publish:['not-a-brand']})).status,400);
});
test('a delayed assistant response cannot undo a newer clothing selection',async()=>{
  let release,started;const waitForStart=new Promise(r=>started=r);const gate=new Promise(r=>release=r);
  const live=await createApplication({env:{CATALOG_MODE:'demo',OMNI_MODE:'live',OMNI_API_KEY:'fixture',OMNI_MODEL:'test',OMNI_CHAT_URL:'https://provider.invalid/chat/completions'},fetcher:async()=>{started();await gate;return Response.json({choices:[{message:{content:JSON.stringify({say:'Worker pay is unknown.',recommendation:null,palette:[]})}}]});}});
  live.server.listen(0,'127.0.0.1');await once(live.server,'listening');const host=`http://127.0.0.1:${live.server.address().port}`;
  try{const s=await (await fetch(host+'/api/sessions',{method:'POST',body:'{}'})).json();const route=host+'/api/sessions/'+s.sessionId;
    const pending=fetch(route+'/assistant',{method:'POST',body:JSON.stringify({text:'What about wages?'})});await waitForStart;
    await fetch(route+'/action',{method:'POST',body:JSON.stringify({type:'select',productId:'peach-tee'})});release();await pending;
    const final=await (await fetch(route)).json();assert.equal(final.productId,'peach-tee');assert.equal(final.message,'Worker pay is unknown.');
  }finally{release();live.server.closeAllConnections();live.server.close();}
});
