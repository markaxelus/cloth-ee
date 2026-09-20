import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newState, transition, MATERIALS } from '../shared/domain.mjs';
import { loadDemoCatalog, loadShopifyCatalog, createCart } from './catalog.mjs';
import { askOmni, validateMedia } from './omni.mjs';
import { renderPanel, releaseSession, shutdownPanels } from './panels.mjs';
import { townRoutes } from './town.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm','.task':'application/octet-stream'};
const problem=(message,status=400)=>Object.assign(new Error(message),{status});
async function body(req) {let size=0;const chunks=[];for await(const b of req){size+=b.length;if(size>13*1024*1024)throw problem('Request exceeds 13 MB',413);chunks.push(b);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw problem('Invalid JSON');}}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
export async function createApplication({env=process.env,products:injected,fetcher=fetch}={}) {
  const catalogMode=env.CATALOG_MODE==='shopify'?'shopify':'demo';
  const loaded=injected?{products:injected,truncated:false}:catalogMode==='shopify'?await loadShopifyCatalog(env,fetcher):{products:await loadDemoCatalog(),truncated:false};
  const products=loaded.products, sessions=new Map(),limits=new Map();
  const town=townRoutes({env,fetcher});
  const snapshot=s=>({...s.state,sessionId:s.id,expiresInMinutes:120,hasFrame:Boolean(s.frame&&Date.now()-s.frameAt<6000)});
  function broadcast(s){const event=`data: ${JSON.stringify(snapshot(s))}\n\n`;for(const client of s.clients)client.write(event);}
  function getSession(id){const s=sessions.get(id);if(!s)throw problem('Session expired or not found. Create or pair a new session.',404);s.touched=Date.now();return s;}
  function rate(key,cap,ms){const now=Date.now();let x=limits.get(key);if(!x||x.end<now){x={count:0,end:now+ms};limits.set(key,x);}if(++x.count>cap)throw problem('Too many requests. Please wait and try again.',429);}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Permissions-Policy','camera=(self), microphone=(self)');
    const origin=req.headers.origin;
    const allowed=(env.ALLOWED_ORIGINS||'http://localhost:8081,http://127.0.0.1:8081').split(',');
    if(origin){let same=false;try{same=new URL(origin).host===req.headers.host;}catch{}
      if(!same&&!allowed.includes(origin)){json(res,403,{error:'Origin is not allowed'});return;}
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
    }
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    try {
      const u=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(u.pathname);
      if(req.method==='GET'&&pathname==='/api/health'){json(res,200,{ok:true,catalogMode,omniMode:env.OMNI_MODE==='live'?'live':'demo',omniConfigured:Boolean(env.OMNI_API_KEY&&env.OMNI_MODEL&&env.OMNI_CHAT_URL),combinedInput:env.OMNI_COMBINED_INPUT==='true',productCount:products.length,catalogTruncated:loaded.truncated});return;}
      if(req.method==='GET'&&pathname==='/api/catalog'){json(res,200,{products,materials:MATERIALS,mode:catalogMode,truncated:loaded.truncated});return;}
      if(req.method==='POST'&&pathname==='/api/sessions'){
        rate(`create:${req.socket.remoteAddress}`,20,60000);if(sessions.size>=200)throw problem('Demo server session capacity reached',503);
        const s={id:randomBytes(16).toString('hex'),state:newState(products),clients:new Set(),touched:Date.now(),frame:null,frameAt:0};sessions.set(s.id,s);json(res,201,snapshot(s));return;
      }
      const panel=pathname.match(/^\/api\/sessions\/([a-f0-9]{32})\/panel\/(workspace|rail|passport)$/);
      if(panel&&req.method==='GET'){
        const s=getSession(panel[1]);const port=server.address()?.port;
        let png;try{png=await renderPanel(s.id,panel[2],s.state.revision,`http://127.0.0.1:${port}`);}
        catch(e){throw problem('Panel rendering is unavailable: '+e.message,503);}
        const head={'Content-Type':'image/png','Cache-Control':'no-store','X-Clothee-Revision':String(s.state.revision)};
        if(png.fitting)head['X-Clothee-Fitting']=JSON.stringify(png.fitting);
        res.writeHead(200,head);res.end(png);return;
      }
      const match=pathname.match(/^\/api\/sessions\/([a-f0-9]{32})(?:\/(events|action|assistant|checkout|frame))?$/);
      if(match){const s=getSession(match[1]);const op=match[2];
        if(req.method==='DELETE'&&!op){for(const c of s.clients)c.end();s.frame=null;sessions.delete(s.id);releaseSession(s.id).catch(()=>{});json(res,200,{deleted:true});return;}
        if(req.method==='GET'&&!op){json(res,200,snapshot(s));return;}
        if(req.method==='GET'&&op==='events'){
          if(s.clients.size>=12)throw problem('Too many viewers for this session',429);
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
          res.write(`data: ${JSON.stringify(snapshot(s))}\n\n`);s.clients.add(res);
          const pulse=setInterval(()=>res.write(': keepalive\n\n'),20000);
          req.on('close',()=>{s.clients.delete(res);clearInterval(pulse);});return;
        }
        if(req.method==='POST'&&op==='action'){
          rate(`action:${s.id}`,600,60000);s.state=transition(s.state,await body(req),products);broadcast(s);json(res,200,snapshot(s));return;
        }
        if(req.method==='GET'&&op==='frame'){
          if(!s.frame||Date.now()-s.frameAt>6000){res.writeHead(204,{'Cache-Control':'no-store'});res.end();return;}
          res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Clothee-Frame-Pose':JSON.stringify({pose:s.framePose||null,poseAt:s.frameAt,mirror:Boolean(s.frameMirror)})});res.end(s.frame);return;
        }
        if(req.method==='POST'&&op==='frame'){
          rate(`frame:${s.id}`,600,60000);const b=await body(req);
          if(b.image===null){s.frame=null;s.frameAt=0;s.frameMirror=false;json(res,200,{ok:true});return;}
          const value=validateMedia(b.image,'image');if(!value?.startsWith('data:image/jpeg;'))throw problem('Frame must be JPEG');
          s.framePose=transition(s.state,{type:'pose',pose:b.pose??null},products).pose;
          s.frame=Buffer.from(value.split(',')[1],'base64');s.frameAt=Date.now();s.frameMirror=Boolean(b.mirror);json(res,200,{ok:true});return;
        }
        if(req.method==='POST'&&op==='assistant'){
          rate(`assistant:${s.id}`,12,60000);if(s.assistantBusy)throw problem('The stylist is already answering',409);
          const b=await body(req);if(typeof b.text!=='undefined'&&(typeof b.text!=='string'||b.text.length>2000))throw problem('Question exceeds 2000 characters');
          const started=Date.now();let answer;s.assistantBusy=true;
          try{answer=await askOmni({text:b.text,image:b.image,audio:b.audio,state:s.state,products},env,fetcher);}finally{s.assistantBusy=false;}
          answer.latencyMs=Date.now()-started;
          // Merge onto the newest state so a slow AI response cannot undo a swipe.
          s.state={...s.state,assistant:answer,message:answer.say,revision:s.state.revision+1};broadcast(s);json(res,200,answer);return;
        }
        if(req.method==='POST'&&op==='checkout'){
          rate(`checkout:${s.id}`,8,60000);
          const selected=products.find(p=>p.id===s.state.productId);const variant=selected.variants.find(v=>v.id===s.state.variantId);
          if(!variant?.available)throw problem('This variant is unavailable',409);
          if(selected.source!=='shopify'){json(res,200,{mode:'demo',checkoutUrl:null,message:'Sample item. Connect a Shopify store to create a real cart.'});return;}
          const cart=await createCart(variant.id,env,fetcher);json(res,200,{mode:'shopify',checkoutUrl:cart.checkoutUrl});return;
        }
        throw problem('Method is not supported',405);
      }
      // The town society (shared/town/*). /observation and /brief are the only model-facing
      // payloads and are asserted clean inside town.mjs; everything else here is render-side.
      if(await town.handle(req,res,pathname,u,{json,problem,body,rate}))return;
      if(pathname.startsWith('/api/'))throw problem('API route not found',404);
      if(req.method!=='GET'&&req.method!=='HEAD')throw problem('Method is not supported',405);
      const base=pathname.startsWith('/shared/')?path.join(root,'shared'):path.join(root,'public');
      const rel=pathname.startsWith('/shared/')?pathname.slice(8):pathname==='/'?'index.html':pathname.slice(1);
      const file=path.resolve(base,rel);
      if(!file.startsWith(base+path.sep)||path.basename(file).startsWith('.'))throw problem('Not found',404);
      const info=await stat(file).catch(()=>null);if(!info?.isFile())throw problem('Not found',404);
      const bytes=await readFile(file);res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
    }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'The service could not complete the request. Check the server configuration.'});else res.end();if(!e.status)console.error('[cloth-ee]',e.message);}
  });
  const reap=setInterval(()=>{const now=Date.now();for(const [id,s]of sessions){if(s.frame&&now-s.frameAt>6000)s.frame=null;if(now-s.touched>7200000){for(const c of s.clients)c.end();sessions.delete(id);releaseSession(id).catch(()=>{});}}for(const[k,v]of limits)if(v.end<now)limits.delete(k);},30000);reap.unref();
  server.on('close',()=>{clearInterval(reap);for(const s of sessions.values())for(const c of s.clients)c.end();shutdownPanels().catch(()=>{});});
  return {server,sessions,products};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {server}=await createApplication();const port=Number(process.env.PORT)||3000;server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Cloth-ee ready: http://localhost:${port}\nFor a phone, use this computer's LAN IP and the same port.`));}
  catch(e){console.error('Cloth-ee could not start:',e.message);process.exitCode=1;}
}
