import test from 'node:test';
import assert from 'node:assert/strict';
import {askOmni,parseAnswer,readCompletion,validateMedia} from '../server/omni.mjs';
import {loadDemoCatalog} from '../server/catalog.mjs';
import {newState} from '../shared/domain.mjs';
const products=await loadDemoCatalog(),state=newState(products);
const image='data:image/jpeg;base64,/9j/2Q==';
const audio='data:audio/wav;base64,UklGRg==';
test('offline mode never pretends to have read media',async()=>{
  const r=await askOmni({image,audio,state,products},{OMNI_MODE:'demo'});assert.equal(r.mode,'demo');assert.equal(r.modalities.audio,false);assert.match(r.say,/have not analyzed/);
});
test('raw speech, image and language share the same OMNI request',async()=>{
  const env={OMNI_MODE:'live',OMNI_MODEL:'sponsor-model',OMNI_API_KEY:'fixture',OMNI_CHAT_URL:'https://provider.invalid/v1/chat/completions',OMNI_COMBINED_INPUT:'true'};
  let body;
  const r=await askOmni({text:'Something breathable?',image,audio,state,products},env,async(url,options)=>{body=JSON.parse(options.body);return Response.json({choices:[{message:{content:JSON.stringify({say:'Compare the linen item.',recommendation:'oat-shirt',observedLabel:null,palette:['#AABBCC']})}}]});});
  assert.deepEqual(body.messages[1].content.map(c=>c.type),['text','image_url','input_audio']);assert.equal(body.stream,true);assert.equal(body.messages[1].content[2].input_audio.format,'wav');assert.equal(r.recommendation,'oat-shirt');assert.equal(r.modalities.audio,true);
});
test('combined-input capability must be explicit',async()=>{
  await assert.rejects(()=>askOmni({image,audio,state,products},{OMNI_MODE:'live',OMNI_MODEL:'x',OMNI_API_KEY:'x',OMNI_CHAT_URL:'https://provider.invalid'}),/Confirm this sponsor model/);
});
test('unknown recommended product cannot be applied and unsafe colors are removed',()=>{
  const r=parseAnswer(JSON.stringify({say:'Hello',recommendation:'invented',palette:['red;evil','javascript:x','#123456']}),products);assert.equal(r.recommendation,null);assert.deepEqual(r.palette,['#123456']);
  assert.throws(()=>parseAnswer('not json',products),/unstructured/);
});
test('SSE handles network chunk boundaries, CRLF, metadata and done',async()=>{
  const text=': heartbeat\r\ndata: {"choices":[{"delta":{"content":"Hello "}}]}\r\n\r\ndata: {"choices":[],"usage":{}}\n\ndata: {"choices":[{"delta":{"content":"world"}}]}\n\ndata: [DONE]\n\n';
  const encoded=new TextEncoder().encode(text);const stream=new ReadableStream({start(controller){for(let i=0;i<encoded.length;i+=7)controller.enqueue(encoded.slice(i,i+7));controller.close();}});
  assert.equal(await readCompletion(new Response(stream,{headers:{'content-type':'text/event-stream'}})),'Hello world');
});
test('bad media and upstream failures are explicit',async()=>{
  assert.throws(()=>validateMedia('https://arbitrary.invalid/photo','image'),/Unsupported/);
  await assert.rejects(()=>readCompletion(new Response('Unauthorized',{status:401})),/HTTP 401/);
});

import {once} from 'node:events';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApplication} from '../server/index.mjs';
import {parseScan,scanOmni} from '../server/omni.mjs';
import {buildTown,observableOf,groundTruthOf,GARMENTS,BRANDS} from '../shared/town/index.mjs';
const live={OMNI_MODE:'live',OMNI_MODEL:'sponsor-model',OMNI_API_KEY:'sk-fixture-1234',OMNI_CHAT_URL:'https://provider.invalid/v1/chat/completions'};
const sse=(content,usage)=>new Response(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\ndata: ${JSON.stringify({choices:[],usage})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
test('town scan sends pixels only, and a faithful description matches the worn garments',async()=>{
  const town=buildTown('cloth-ee-2026'),resident=town.residents[0],truth=groundTruthOf(resident,town);
  // Stand-in for a model that sees perfectly: the words and colours of the observation, no ids.
  const seen=observableOf(resident,{town}).garments.map(({slot,silhouette,colorName,colorHex,pattern,patchText})=>({slot,silhouette,colorName,colorHex,pattern,patchText}));
  let sent;
  const app=await createApplication({env:{...live,CATALOG_MODE:'demo'},fetcher:async(url,options)=>{sent=options.body;return sse(JSON.stringify({transcript:null,say:'A shirt and trousers.',garments:seen}),{prompt_tokens:900,completion_tokens:100,total_tokens:1000});}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  try{
    const r=await fetch(`http://127.0.0.1:${app.server.address().port}/api/town/scan`,{method:'POST',body:JSON.stringify({image})});const data=await r.json();
    assert.equal(r.status,200);assert.equal(data.mode,'live');assert.equal(data.tokens,1000);
    for(const c of data.catalogCandidates)assert.equal(c.matches[0].garmentId,truth.outfit[c.slot]);
    for(const secret of [resident.id,resident.name,...GARMENTS.flatMap(g=>[g.id,g.name]),...BRANDS.map(b=>b.label)])assert.ok(!sent.includes(secret),`request leaked ${secret}`);
  }finally{app.server.closeAllConnections();app.server.close();}
});
test('scan splits image and audio across messages until combined input is confirmed, and logs usage without the key',async()=>{
  const log=path.join(await mkdtemp(path.join(tmpdir(),'clothee-')),'calls.jsonl');let body;
  const fetcher=async(url,options)=>{body=JSON.parse(options.body);return sse('{"say":"ok","garments":[]}',{prompt_tokens:5,completion_tokens:2,total_tokens:7});};
  await scanOmni({image,audio},{...live,OMNI_USAGE_LOG:log},fetcher);
  assert.deepEqual(body.messages.slice(1).map(m=>m.content.map(c=>c.type)),[['text','image_url'],['input_audio']]);
  await scanOmni({image,audio},{...live,OMNI_COMBINED_INPUT:'true'},fetcher);
  assert.deepEqual(body.messages.slice(1).map(m=>m.content.map(c=>c.type)),[['text','image_url','input_audio']]);
  const text=await readFile(log,'utf8'),record=JSON.parse(text.trim());
  assert.equal(record.purpose,'town-scan');assert.equal(record.total_tokens,7);assert.equal(record.key_suffix,'1234');assert.equal(record.success,true);assert.ok(!text.includes(live.OMNI_API_KEY));
});
test('scan answers are reduced to known slots and real colours, and demo mode refuses',async()=>{
  const r=parseScan('```json\n'+JSON.stringify({say:'Hi',garments:[{slot:'top',silhouette:'t-shirt',colorHex:'#AABBCC'},{slot:'top',colorHex:'#000000'},{slot:'cape',colorHex:'#000000'},{slot:'shoes',colorHex:'red'},{slot:'hat',silhouette:'crown',colorHex:'#112233'}]})+'\n```');
  assert.deepEqual(r.garments.map(g=>[g.slot,g.silhouette,g.colorHex]),[['top','t-shirt','#aabbcc'],['hat',null,'#112233']]);
  await assert.rejects(()=>scanOmni({image},{OMNI_MODE:'demo'}),/not live/);
  await assert.rejects(()=>scanOmni({},live),/capture image is required/);
});
