import { CATEGORIES, MATERIALS, money, perWear, shippingEstimate, garmentPlacement } from '/shared/domain.mjs';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
// ?view=ar swaps in the glasses layout. Same markup and state, different CSS.
if(new URLSearchParams(location.search).get('view')==='ar')document.documentElement.dataset.view='ar';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PALETTES={soft:['#b9a4dd','#eee0cd','#a7b6a0','#dfb6c3'],earth:['#879981','#b69070','#e1ccaa','#6b7466'],bold:['#e29486','#717fbd','#d1bd5e','#9075b4']};
let products=[],state=null,session='',category='all',query='',tab='details',page='studio',health=null,events=null,attached=null;
let cameraStream=null,cameraDeviceId='',poseTask=null,localPose=null,raf=0,previousFrame=0,lastPosePost=0,lastFramePost=0,shareBusy=false,recording=null,recordTimer=null,busy=false,renderKey='';
let actionQueue=Promise.resolve();
const selected=()=>products.find(p=>p.id===state?.productId);
const variant=()=>selected()?.variants.find(v=>v.id===state.variantId);
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,5500);}
async function request(url,data,method){const r=await fetch(url,{method:method||(data?'POST':'GET'),headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok)throw Error(j.error||`HTTP ${r.status}`);return j;}
function receive(s){if(!state||s.revision>=state.revision){state=s;localStorage.setItem('clothee-session',session);render();}}
function action(a){actionQueue=actionQueue.catch(()=>{}).then(()=>request(`/api/sessions/${session}/action`,a)).then(receive).catch(e=>toast(e.message));return actionQueue;}
function displayImage(p){return p.imageUrl||'/assets/logo.svg';}
function render(){
  if(!state)return;
  const key=JSON.stringify({...state,revision:0,pose:null,poseAt:0,hasFrame:false});
  if(key===renderKey)return;renderKey=key;
  const p=selected(),v=variant();
  $('#saved-count').textContent=state.favorites.length;
  $('#selected-brand').textContent=p.vendor;$('#selected-title').textContent=p.title;
  $('#studio-garment').src=p.overlayUrl||'';$('#studio-garment').hidden=!p.overlayUrl;
  $('#camera-garment').src=p.overlayUrl||'';
  $('#floating-note').innerHTML=p.source==='demo'?'a little cloud energy <span>☁</span>':'your next favourite <span>✦</span>';
  $('#product-price').innerHTML=`${escape(money(v.price,v.currency))} <small>${escape(v.currency)}</small>`;
  $('#product-description').textContent=p.description;
  $('#variant').innerHTML=p.variants.map(x=>`<option value="${escape(x.id)}" ${x.id===v.id?'selected':''} ${x.available?'':'disabled'}>${escape(x.title)}${x.available?'':' · Sold out'}</option>`).join('');
  $('#favorite').textContent=state.favorites.includes(p.id)?'♥':'♡';$('#favorite').classList.toggle('saved',state.favorites.includes(p.id));$('#favorite').setAttribute('aria-pressed',String(state.favorites.includes(p.id)));
  $('#palette-swatches').innerHTML=PALETTES[state.profile.palette].map(c=>`<span class="swatch" style="background:${c}" title="${c}"></span>`).join('');
  $('#checkout-note').textContent=p.source==='demo'?'Sample item · No purchase is made':'Opens Shopify checkout · Review before purchase';
  $('#fit-disclaimer').textContent=p.overlayUrl?'Illustrative 2D preview · Not a size prediction':'No transparent overlay supplied for this item';
  placeStudio();renderProducts();renderPassport();renderWardrobe();renderAssistant();
}
function renderProducts(){
  $('#categories').innerHTML=[['all','All'],...CATEGORIES.map(x=>[x,{shirt:'Tops',pants:'Pants',hat:'Hats',glasses:'Glasses',scarf:'Scarves',shoes:'Shoes'}[x]])].map(([id,title])=>`<button class="chip ${category===id?'active':''}" data-category="${id}" aria-pressed="${category===id}">${title}</button>`).join('');
  const list=products.filter(p=>(category==='all'||p.category===category)&&`${p.title} ${p.vendor} ${p.materials.map(m=>m.name).join(' ')}`.toLowerCase().includes(query));
  $('#product-list').innerHTML=list.length?list.map(p=>`<button class="product-card ${state.productId===p.id?'selected':''}" data-product="${escape(p.id)}" aria-label="Try ${escape(p.title)}" aria-pressed="${state.productId===p.id}"><span class="thumbnail" style="background:${escape(p.colorHex)}22"><img src="${escape(displayImage(p))}" alt=""></span><span><span class="vendor">${escape(p.vendor)}</span><h3>${escape(p.title)}</h3><span class="card-price">${escape(money(p.variants[0].price,p.variants[0].currency))}</span></span>${state.productId===p.id?'<i class="selection-dot"></i>':''}</button>`).join(''):'<p class="empty">No pieces here yet. Try another category or search.</p>';
}
function renderPassport(){
  const p=selected(),v=variant();let html='';
  $$('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-selected',String(b.dataset.tab===tab));});
  if(tab==='details'){
    const material=MATERIALS[p.materials[0]?.name.toLowerCase()]||MATERIALS.other;
    html=`<div class="material-badge"><span>❋</span>${p.materials.length?p.materials.map(m=>`${m.percent}% ${escape(m.name)}`).join(' · '):'Composition not disclosed'}</div><p class="material-summary">${escape(material.good)}</p><p class="material-tradeoff">${escape(material.tradeoff)}</p><span class="evidence-status">${p.materialsStatus==='demo'?'Illustrative sample composition':p.materialsStatus==='unknown'?'Missing composition':'Merchant-reported composition'}</span>`;
  }else if(tab==='story'){
    html=['sourcing','manufacturing','wages','ethics'].map(k=>{const c=p.passport[k];return `<div class="evidence-card"><h3>${{sourcing:'01 · Fibre & sourcing',manufacturing:'02 · Made into something',wages:'03 · The people behind it',ethics:'04 · Ethics & evidence'}[k]}</h3><p>${escape(c.value)}</p><span class="evidence-status">${c.status==='demo'?'Fictional demonstration':c.status==='unknown'?'Not disclosed':'Brand-reported'}</span>${c.url?` <a href="${escape(c.url)}" target="_blank" rel="noopener noreferrer">Read source ↗</a>`:''}</div>`;}).join('');
  }else{
    const c=p.passport.carbon;
    html=`<p class="eyebrow">AT ${state.wears} PLANNED WEARS</p><p class="impact-number">${escape(money(perWear(v.price,state.wears),v.currency))} <small>/ wear</small></p><label class="impact-note">Try a different wear count<input id="wears-slider" aria-label="Planned wear count" type="range" min="1" max="100" value="${state.wears}"></label><p class="impact-note">Purchase price divided by planned wears. This does not change production emissions.</p><div class="evidence-card"><h3>Carbon information</h3><p>${c?`${c.kgCO2e.toFixed(1)} kg CO₂e · ${escape(c.status==='demo'?'illustrative data':'brand-reported')}`:'Not disclosed. No footprint has been inferred.'}</p>${c?`<p>${escape(c.boundary)}</p><p>${escape(c.method)}</p>${c.url?`<a href="${escape(c.url)}" target="_blank" rel="noopener noreferrer">Method & source ↗</a>`:''}`:''}</div>`;
  }
  if(tab==='impact')html+=`<details class="shipping-details"><summary>Shipping what-if ↗</summary><p class="impact-note">Example assumptions, not this product's footprint. Replace with route-specific inputs.</p><form id="shipping-form"><label>Parcel mass (kg)<input name="massKg" type="number" min="0" step="any" value="0.5" required></label><label>One-way distance (km)<input name="distanceKm" type="number" min="0" step="any" value="1000" required></label><label>Factor (kg CO₂e / tonne-km)<input name="kgCO2ePerTonneKm" type="number" min="0" step="any" value="0.1" required></label><label class="return-option"><input name="return" type="checkbox"> Include a same-route return</label><button class="chip" type="submit">Calculate scenario</button><output id="shipping-result"></output></form></details>`;
  $('#passport-content').innerHTML=html;
}
function placeStudio(){
  const boxes={shirt:[50,38,57,34],pants:[50,74,37,39],hat:[50,9,30,12],glasses:[50,15,24,5],scarf:[50,31,25,23],shoes:[50,94,44,8]};
  const [x,y,w,h]=boxes[selected().category],f=state.fit,el=$('#studio-garment');
  el.style.cssText=`left:${x+f.x*100}%;top:${y+f.y*100}%;width:${w*f.scale}%;height:${h*f.scale}%;transform:translate(-50%,-50%) rotate(${f.rotation}deg)`;
}
function renderWardrobe(){
  const saved=products.filter(p=>state.favorites.includes(p.id));
  $('#wardrobe-list').innerHTML=saved.length?saved.map(p=>`<article class="wardrobe-card"><img src="${escape(displayImage(p))}" alt="${escape(p.title)}"><h3>${escape(p.title)}</h3><p>${state.worn[p.id]||0} logged wears · ${escape(p.vendor)}</p><button class="primary" data-product="${escape(p.id)}" data-return-studio="true">Try this piece</button><button class="text-button" data-wear="${escape(p.id)}">＋ Log a wear</button></article>`).join(''):'<p class="empty">Your wardrobe is waiting. Tap the heart on a piece you like.</p>';
}
function renderAssistant(){
  const a=state.assistant;if(!a)return;
  $('#assistant-answer').textContent=a.say;$('#assistant-mode').textContent=a.mode==='live'?'OMNI connected':'Offline demo';
  const p=products.find(p=>p.id===a.recommendation);
  $('#assistant-result').innerHTML=(p?`<div class="recommendation">${escape(p.title)}<button data-product="${escape(p.id)}">Try suggestion ↗</button></div>`:'')+(a.observedLabel?`<p>Observed label text: ${escape(a.observedLabel)}</p>`:'')+(a.mode==='live'?`<p>Inputs: ${a.modalities.vision?'image + ':''}${a.modalities.audio?'recorded speech + ':''}language · ${(a.latencyMs/1000).toFixed(1)} s</p>`:'')+'<button class="text-button" id="read-answer">▶ Read answer aloud</button> <button class="text-button" id="stop-speaking">■ Stop speaking</button>';
}
function showPage(value){page=value;for(const p of ['studio','wardrobe','materials'])$(`#${p}-page`).hidden=p!==value;$$('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===value));}
function setBusy(value){busy=value;$('#ask').disabled=value;$('#voice').disabled=value;$('#assistant-mode').textContent=value?'Thinking…':health.omniMode==='live'?'OMNI ready':'Offline demo';}
async function ask(audio){
  if(busy||recording)return;
  const text=$('#question').value.trim();const image=attached||(cameraStream?snapshotCamera():null);
  if(!text&&!image&&!audio){toast('Ask a question or add a photo first.');return;}
  setBusy(true);
  try{const answer=await request(`/api/sessions/${session}/assistant`,{text,image,audio});$('#question').value='';const s=await request(`/api/sessions/${session}`);receive(s);if(audio)speak(answer.say);}
  catch(e){toast(e.message);}finally{setBusy(false);}
}
async function attach(file){
  if(!file)return;if(file.size>12*1024*1024){toast('Choose a photo smaller than 12 MB.');return;}
  const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,900/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);attached=c.toDataURL('image/jpeg',.8);$('#attachment-preview').src=attached;$('#attachment-row').hidden=false;toast('Photo attached. Add a question or record your voice.');}catch{toast('Could not read that photo. Try JPEG or PNG.');}finally{URL.revokeObjectURL(url);}
}
function snapshotCamera(){const v=$('#camera-video');if(!v.videoWidth)return null;const c=document.createElement('canvas');const ratio=Math.min(1,640/v.videoWidth);c.width=v.videoWidth*ratio;c.height=v.videoHeight*ratio;c.getContext('2d').drawImage(v,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.65);}
function resizeVideo(){const v=$('#camera-video'),host=$('#camera-view');if(!v.videoWidth)return;const scale=Math.min(host.clientWidth/v.videoWidth,host.clientHeight/v.videoHeight);$('#video-plane').style.width=v.videoWidth*scale+'px';$('#video-plane').style.height=v.videoHeight*scale+'px';$('#video-plane').classList.toggle('mirrored',$('#mirror-camera').checked);}
async function startCamera(){
  if(cameraStream)return;
  if(!navigator.mediaDevices?.getUserMedia){toast('Camera requires localhost or HTTPS. Use Expo on a phone, or HTTPS for a mobile browser.');return;}
  try{cameraStream=await navigator.mediaDevices.getUserMedia({video:{...(cameraDeviceId?{deviceId:{exact:cameraDeviceId}}:{facingMode:'user'}),width:{ideal:960},height:{ideal:720}},audio:false});
    const v=$('#camera-video');v.srcObject=cameraStream;await v.play();$('#mannequin').hidden=true;$('#camera-view').hidden=false;$('#camera-options').hidden=false;$('#floating-note').hidden=true;$('#camera-mode').classList.add('active');$('#studio-mode').classList.remove('active');resizeVideo();action({type:'mode',value:'camera'});
    updateCameraLabel();
    $('#preview-status').textContent='Loading local body tracking…';
    try{if(!poseTask){const {FilesetResolver,PoseLandmarker}=await import('/vendor/vision_bundle.mjs');const vision=await FilesetResolver.forVisionTasks('/vendor/wasm');poseTask=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'/vendor/pose_landmarker_lite.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.6,minPosePresenceConfidence:.6,minTrackingConfidence:.6});}$('#preview-status').textContent='Step back so your body is visible';}
    catch{toast('Camera is on. For automatic tracking, run npm run setup:pose and reload. Manual alignment is available.');$('#preview-status').textContent='Camera · manual alignment';}
    if(cameraStream)loopCamera();else{poseTask?.close();poseTask=null;}
  }catch(e){stopCamera();toast(`Camera unavailable: ${e.message}`);}
}
function updateCameraLabel(){
  const track=cameraStream?.getVideoTracks()[0];$('#camera-label').textContent=track?.label||'Camera';
  $('#mirror-label').textContent=$('#mirror-camera').checked?'Mirror selfie':'Normal view';
}
async function switchCamera(){
  if(!navigator.mediaDevices?.enumerateDevices)return;
  try{
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
    if(devices.length<2){$('#mirror-camera').checked=!$('#mirror-camera').checked;resizeVideo();updateCameraLabel();toast('Only one camera was found, so Cloth-ee switched between mirrored and normal view.');return;}
    const current=cameraStream?.getVideoTracks()[0]?.getSettings().deviceId||cameraDeviceId;
    const index=Math.max(0,devices.findIndex(d=>d.deviceId===current));const next=devices[(index+1)%devices.length];cameraDeviceId=next.deviceId;
    cancelAnimationFrame(raf);cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;localPose=null;
    $('#mirror-camera').checked=/front|facetime|selfie/i.test(next.label);await startCamera();toast(`Using ${next.label||'the next camera'}.`);
  }catch(e){toast(`Could not switch camera: ${e.message}`);}
}
function stopCamera(){
  cancelAnimationFrame(raf);cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;localPose=null;poseTask?.close();poseTask=null;
  $('#camera-video').srcObject=null;$('#mannequin').hidden=false;$('#camera-view').hidden=true;$('#camera-options').hidden=true;$('#floating-note').hidden=false;$('#share-frames').checked=false;$('#studio-mode').classList.add('active');$('#camera-mode').classList.remove('active');$('#preview-status').textContent='✦ Style preview';
  if(session){action({type:'pose',pose:null});action({type:'mode',value:'studio'});request(`/api/sessions/${session}/frame`,{image:null}).catch(()=>{});}
}
function drawCameraGarment(){
  const v=$('#camera-video'),el=$('#camera-garment');let placement;
  if(poseTask)placement=garmentPlacement(selected().category,localPose,v.videoWidth/v.videoHeight);
  else placement={x:.5,y:.45,width:.45,height:.5,rotation:0};
  if(!placement||!selected().overlayUrl){el.hidden=true;return;}
  const p=placement,f=state.fit;el.hidden=false;el.style.cssText=`left:${(p.x+f.x)*100}%;top:${(p.y+f.y)*100}%;width:${p.width*f.scale*100}%;height:${p.height*f.scale*100}%;transform:translate(-50%,-50%) rotate(${p.rotation+f.rotation}deg)`;
}
function loopCamera(time=0){
  if(!cameraStream)return;const v=$('#camera-video');
  if(time-previousFrame>65&&v.readyState>=2){previousFrame=time;
    if(poseTask){try{const result=poseTask.detectForVideo(v,performance.now());const points=result.landmarks[0];localPose=points?points.map((p,i)=>({x:Math.min(3,Math.max(-2,localPose?localPose[i].x*.3+p.x*.7:p.x)),y:Math.min(3,Math.max(-2,localPose?localPose[i].y*.3+p.y*.7:p.y)),visibility:p.visibility??0})):null;
      $('#preview-status').textContent=garmentPlacement(selected().category,localPose,v.videoWidth/v.videoHeight)?'● Body tracked · 2D preview':'Step back into the camera view';
    }catch(error){localPose=null;$('#preview-status').textContent='Camera · manual alignment';console.warn('Pose tracking failed:',error.message);poseTask.close();poseTask=null;toast('Body tracking could not run in this browser. Enable WebGL / hardware acceleration, or use manual alignment.');}}
    drawCameraGarment();
    if(time-lastPosePost>240){lastPosePost=time;request(`/api/sessions/${session}/action`,{type:'pose',pose:localPose}).catch(()=>{});}
    if($('#share-frames').checked&&time-lastFramePost>200&&!shareBusy){lastFramePost=time;shareBusy=true;const image=snapshotCamera();if(image)request(`/api/sessions/${session}/frame`,{image,pose:localPose,mirror:$('#mirror-camera').checked}).catch(()=>{}).finally(()=>shareBusy=false);else shareBusy=false;}
  }
  raf=requestAnimationFrame(loopCamera);
}
async function toggleVoice(){
  if(recording){await finishRecording();return;}
  if(!navigator.mediaDevices?.getUserMedia){toast('Microphone requires localhost or HTTPS.');return;}
  let stream,context;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true},video:false});context=new AudioContext();await context.audioWorklet.addModule('/audio-worklet.js');await context.resume();
    const source=context.createMediaStreamSource(stream),worklet=new AudioWorkletNode(context,'clothee-recorder');const mute=context.createGain();mute.gain.value=0;source.connect(worklet);worklet.connect(mute);mute.connect(context.destination);
    recording={stream,context,source,worklet,chunks:[],sampleRate:context.sampleRate};worklet.port.onmessage=e=>{if(recording)recording.chunks.push(e.data);};
    $('#voice').classList.add('recording');$('#voice').innerHTML='■ <span>Send</span>';$('#media-note').textContent='Listening. Tap Send to submit your voice and attached/current camera photo. Maximum 15 seconds.';recordTimer=setTimeout(finishRecording,15000);
  }catch(e){stream?.getTracks().forEach(t=>t.stop());await context?.close().catch(()=>{});toast(`Microphone unavailable: ${e.message}`);}
}
async function finishRecording(){
  if(!recording)return;clearTimeout(recordTimer);const r=recording;recording=null;r.source.disconnect();r.worklet.disconnect();r.stream.getTracks().forEach(t=>t.stop());await r.context.close();
  $('#voice').classList.remove('recording');$('#voice').innerHTML='◉ <span>Talk</span>';$('#media-note').textContent='Recorded speech goes to the configured OMNI provider when sent.';
  const count=r.chunks.reduce((a,c)=>a+c.length,0);if(count<r.sampleRate*.25){toast('Recording was too short. Try again.');return;}
  const audio=wav(r.chunks,r.sampleRate);await ask(audio);
}
function wav(chunks,sampleRate){
  const length=chunks.reduce((a,c)=>a+c.length,0),buffer=new ArrayBuffer(44+length*2),v=new DataView(buffer);const str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,36+length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,length*2,true);let at=44;for(const chunk of chunks)for(const s of chunk){v.setInt16(at,Math.max(-1,Math.min(1,s))*(s<0?32768:32767),true);at+=2;}let binary='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return 'data:audio/wav;base64,'+btoa(binary);
}
function speak(text){if(!('speechSynthesis' in window)){toast('Speech playback is not available in this browser.');return;}speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(text));}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.category){category=b.dataset.category;renderProducts();}
  if(b.dataset.product){await action({type:'select',productId:b.dataset.product});if(b.dataset.returnStudio)showPage('studio');}
  if(b.dataset.tab){tab=b.dataset.tab;renderPassport();}
  if(b.dataset.page)showPage(b.dataset.page);
  if(b.dataset.close)$(`#${b.dataset.close}`).close();
  if(b.dataset.wear){await action({type:'select',productId:b.dataset.wear});await action({type:'wear'});toast('One wear logged. Good things deserve a repeat.');}
  if(b.id==='read-answer'&&state.assistant)speak(state.assistant.say);
  if(b.id==='stop-speaking'&&'speechSynthesis' in window)speechSynthesis.cancel();
});
$('#search').addEventListener('input',e=>{query=e.target.value.toLowerCase();renderProducts();});
$('#variant').addEventListener('change',e=>action({type:'variant',variantId:e.target.value}));
$('#favorite').onclick=()=>action({type:'favorite'});
$('#next').onclick=()=>action({type:'next',category});$('#previous').onclick=()=>action({type:'previous',category});
$('#ask').onclick=()=>ask();$('#question').addEventListener('keydown',e=>{if(e.key==='Enter')ask();});$('#voice').onclick=toggleVoice;
$('#attach-open').onclick=()=>$('#photo-input').click();$('#scan-open').onclick=()=>{$('#question').value='Read the visible brand, fibre composition, care instructions and origin on this tag. Explain what remains unknown.';$('#photo-input').click();};$('#photo-input').onchange=e=>attach(e.target.files[0]);
$('#remove-attachment').onclick=()=>{attached=null;$('#attachment-row').hidden=true;$('#photo-input').value='';};
$('#camera-mode').onclick=()=>startCamera();$('#studio-mode').onclick=()=>{if(cameraStream)stopCamera();};$('#stop-camera').onclick=stopCamera;$('#switch-camera').onclick=switchCamera;$('#mirror-camera').onchange=()=>{resizeVideo();updateCameraLabel();};
$('#share-frames').onchange=e=>{if(!e.target.checked)request(`/api/sessions/${session}/frame`,{image:null}).catch(()=>{});else toast('Sharing the camera view with devices in this session.');};
new ResizeObserver(resizeVideo).observe($('#stage'));
$('#profile-open').onclick=()=>{for(const[k,v]of Object.entries(state.profile))$('#profile-form').elements[k].value=v;$('#profile-dialog').showModal();};
$('#profile-form').onsubmit=async e=>{e.preventDefault();const form=new FormData(e.target);await action({type:'profile',profile:{heightCm:Number(form.get('heightCm')),topSize:form.get('topSize'),bottomSize:form.get('bottomSize'),shoeSize:form.get('shoeSize'),palette:form.get('palette')}});$('#profile-dialog').close();};
$('#pair-open').onclick=()=>{$('#server-address').value=location.origin;$('#pair-code').value=session;$('#pair-dialog').showModal();};
$('#copy-pair').onclick=async()=>{try{await navigator.clipboard.writeText(session);toast('Session ID copied.');}catch{$('#pair-code').select();toast('Select and copy the session ID.');}};
$('#align-open').onclick=()=>{for(const k of ['x','y','scale','rotation'])$(`#fit-${k}`).value=state.fit[k];$('#align-dialog').showModal();};
for(const k of ['x','y','scale','rotation'])$(`#fit-${k}`).onchange=()=>action({type:'fit',fit:Object.fromEntries(['x','y','scale','rotation'].map(x=>[x,Number($(`#fit-${x}`).value)]))});
$('#reset-fit').onclick=async()=>{await action({type:'fit',fit:{x:0,y:0,scale:1,rotation:0}});for(const k of ['x','y','scale','rotation'])$(`#fit-${k}`).value=state.fit[k];};
$('#passport-content').addEventListener('change',e=>{if(e.target.id==='wears-slider')action({type:'wears',value:Number(e.target.value)});});
$('#passport-content').addEventListener('submit',e=>{if(e.target.id!=='shipping-form')return;e.preventDefault();const data=new FormData(e.target);try{const kg=shippingEstimate({massKg:Number(data.get('massKg')),distanceKm:Number(data.get('distanceKm')),kgCO2ePerTonneKm:Number(data.get('kgCO2ePerTonneKm')),returnFraction:data.get('return')?1:0});$('#shipping-result').textContent=`${kg.toFixed(3)} kg CO₂e · Transport scenario only. Assumes the same mode/distance for a return; excludes other lifecycle stages.`;}catch(error){toast(error.message);}});
$('#checkout').onclick=async()=>{const button=$('#checkout');button.disabled=true;try{const result=await request(`/api/sessions/${session}/checkout`,{});if(result.checkoutUrl){location.assign(result.checkoutUrl);}else toast(result.message);}catch(e){toast(e.message);}finally{button.disabled=false;}};
$('#end-session').onclick=async()=>{if(cameraStream)stopCamera();events?.close();await request(`/api/sessions/${session}`,undefined,'DELETE').catch(()=>{});localStorage.removeItem('clothee-session');location.hash='';location.reload();};
let pointerX=0;$('#stage').addEventListener('pointerdown',e=>{pointerX=e.clientX;});$('#stage').addEventListener('pointerup',e=>{const delta=e.clientX-pointerX;if(Math.abs(delta)>65)action({type:delta<0?'next':'previous',category});});
window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)||document.querySelector('dialog[open]'))return;if(e.key==='ArrowRight')action({type:'next',category});if(e.key==='ArrowLeft')action({type:'previous',category});});
window.addEventListener('pagehide',()=>{cameraStream?.getTracks().forEach(t=>t.stop());recording?.stream.getTracks().forEach(t=>t.stop());events?.close();});
async function boot(){
  try{const result=await Promise.all([request('/api/catalog'),request('/api/health')]);products=result[0].products;health=result[1];
    $('#mode-banner').textContent=health.catalogMode==='demo'?'Sample collection · Fictional brands and illustrative impact data':`Shopify collection · Product claims are merchant-reported${health.catalogTruncated?' · First 250 products shown':''}`;
    $('#assistant-mode').textContent=health.omniMode==='live'?'OMNI ready':'Offline demo';
    const supplied=new URLSearchParams(location.hash.slice(1)).get('session');session=supplied||localStorage.getItem('clothee-session')||'';
    if(/^[a-f0-9]{32}$/.test(session)){try{state=await request(`/api/sessions/${session}`);}catch{session='';}}else session='';
    if(!session){state=await request('/api/sessions',{});session=state.sessionId;}
    localStorage.setItem('clothee-session',session);render();
    $('#material-list').innerHTML=Object.values(MATERIALS).map(m=>`<article class="material-card"><h3>${escape(m.name)}</h3><p>${escape(m.good)}</p><p>${escape(m.tradeoff)}</p><p>${escape(m.care)}</p></article>`).join('');
    events=new EventSource(`/api/sessions/${session}/events`);events.onopen=()=>{$('#connection').innerHTML='<i></i> Fitting room connected';};events.onmessage=e=>receive(JSON.parse(e.data));events.onerror=()=>{$('#connection').textContent='Reconnecting…';};
  }catch(e){toast(e.message);$('#connection').textContent='Server unavailable';$('#product-list').innerHTML='<p class="empty">Could not load the fitting room. Restart the service and reload.</p>';}
}
boot();
