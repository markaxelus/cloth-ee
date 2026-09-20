// Optional UI verification: npm install --no-save playwright && npx playwright install chromium
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createApplication} from '../server/index.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const app=await createApplication({env:{CATALOG_MODE:'demo',OMNI_MODE:'demo'}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
const url=`http://127.0.0.1:${app.server.address().port}`;
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',...(process.env.CLOTHEE_VIDEO_FIXTURE?['--use-file-for-fake-video-capture='+process.env.CLOTHEE_VIDEO_FIXTURE]:[])]});
const context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['camera','microphone']});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning'&&m.text().includes('Pose tracking failed'))console.log(m.text());});
try{
  await page.goto(url);await page.waitForSelector('.product-card.selected');
  assert.equal(await page.locator('#selected-title').innerText(),'The cloud tee');
  await page.screenshot({path:new URL('../artifacts/Cloth-ee_Desktop.png',import.meta.url).pathname,fullPage:true});
  await page.click('#next');await page.waitForFunction(()=>document.querySelector('#selected-title').textContent==='Sunday linen');
  await page.click('#favorite');await page.waitForFunction(()=>document.querySelector('#saved-count').textContent==='1');
  await page.click('[data-page=wardrobe]');await page.waitForSelector('.wardrobe-card');await page.click('[data-wear]');await page.waitForFunction(()=>document.querySelector('.wardrobe-card p').textContent.startsWith('1'));
  await page.click('[data-page=studio]');await page.click('[data-tab=story]');assert.match(await page.locator('#passport-content').innerText(),/Not disclosed/);
  await page.click('[data-tab=impact]');await page.locator('#wears-slider').fill('50');await page.locator('#wears-slider').dispatchEvent('change');await page.waitForFunction(()=>document.querySelector('.impact-number').textContent.includes('1.52'));
  await page.click('.shipping-details summary');await page.check('[name=return]');await page.click('#shipping-form button');assert.match(await page.locator('#shipping-result').innerText(),/0.100 kg/);
  await page.click('#profile-open');await page.locator('[name=heightCm]').fill('181');await page.locator('[name=palette]').selectOption('earth');await page.click('#profile-form button[type=submit]');await page.waitForFunction(()=>!document.querySelector('#profile-dialog').open);
  await page.fill('#question','Something breathable for a warm day');await page.click('#ask');await page.waitForSelector('.recommendation');assert.match(await page.locator('#assistant-answer').innerText(),/demo rules/);
  // A second independent browser tab controls the exact same session.
  const id=await page.evaluate(()=>localStorage.getItem('clothee-session'));const second=await context.newPage();await second.goto(url+'/#session='+id);await second.waitForSelector('.product-card.selected');await second.click('[data-product=peach-tee]');await page.waitForFunction(()=>document.querySelector('#selected-title').textContent==='Peach, please');await second.close();
  await page.click('#checkout');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Shopify'));
  await page.click('[data-tab=details]');await page.click('[data-product=cloud-tee]');
  // In-memory browser camera exercises WASM initialization and missing-landmark behavior.
  await page.click('#camera-mode');await page.waitForFunction(()=>document.querySelector('#camera-video').videoWidth>0,{},{timeout:15000});
  await page.waitForFunction(()=>!document.querySelector('#preview-status').textContent.includes('Loading'),{},{timeout:40000});
  await page.waitForTimeout(1500);
  const cameraStatus=await page.locator('#preview-status').innerText();
  assert.ok(!cameraStatus.includes('manual alignment')&&!cameraStatus.includes('paused'),'Pose inference must initialize and execute');
  if(process.env.CLOTHEE_VIDEO_FIXTURE)assert.match(cameraStatus,/Body tracked/,'The official person fixture should produce usable landmarks');
  await page.check('#share-frames');await page.waitForFunction(async()=>{const id=localStorage.getItem('clothee-session');const r=await fetch('/api/sessions/'+id+'/frame');return r.status===200&&JSON.parse(r.headers.get('x-clothee-frame-pose')).pose?.length===33;});
  await page.waitForSelector('#toast[hidden]',{state:'attached',timeout:10000});
  await page.screenshot({path:new URL('../artifacts/Cloth-ee_Camera_Test.png',import.meta.url).pathname,fullPage:true});
  console.log('Camera:',cameraStatus);
  await page.click('#stop-camera');
  // Exercise microphone bytes and the deliberate offline-media disclosure.
  await page.click('#voice');await page.waitForSelector('#voice.recording');await page.waitForTimeout(600);await page.click('#voice');await page.waitForFunction(()=>document.querySelector('#assistant-answer').textContent.includes('have not analyzed'));
  await page.click('#stop-speaking');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:new URL('../artifacts/Cloth-ee_Mobile_Web.png',import.meta.url).pathname,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile layout must not overflow horizontally');
  await page.click('[data-page=materials]');assert.equal(await page.locator('.material-card').count(),5);
  assert.deepEqual(errors,[]);console.log('Browser flow passed: desktop/mobile, paired tabs, navigation, wardrobe, profile, evidence, cost per wear, demo stylist, checkout, camera initialization.');
}finally{await browser.close();app.server.closeAllConnections();app.server.close();}
