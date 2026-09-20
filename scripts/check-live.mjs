import {readFile} from 'node:fs/promises';
import {loadDemoCatalog,loadShopifyCatalog} from '../server/catalog.mjs';
import {askOmni} from '../server/omni.mjs';
import {newState} from '../shared/domain.mjs';
let products=await loadDemoCatalog();
if(process.env.CATALOG_MODE==='shopify'){
  const r=await loadShopifyCatalog();products=r.products;console.log(`Shopify: fetched ${products.length} products. First variant: ${products[0].variants[0].title}`);
}else console.log('Shopify is in demo mode; no live Shopify call made.');
if(process.env.OMNI_MODE!=='live'){console.log('OMNI is in demo mode; no live model call made.');process.exit(0);}
const imagePath=process.env.OMNI_TEST_IMAGE,audioPath=process.env.OMNI_TEST_AUDIO;
if(!imagePath||!audioPath){console.error('To test all three modalities, set OMNI_TEST_IMAGE=/path/to/label.jpg and OMNI_TEST_AUDIO=/path/to/question.wav. No OMNI request was made.');process.exit(1);}
const image='data:image/jpeg;base64,'+(await readFile(imagePath)).toString('base64');
const audio='data:audio/wav;base64,'+(await readFile(audioPath)).toString('base64');
const result=await askOmni({text:'Use the label image and my spoken question. State what is visible and what remains unknown.',image,audio,state:newState(products),products});
console.log(JSON.stringify({mode:result.mode,model:result.model,modalities:result.modalities,say:result.say,recommendation:result.recommendation},null,2));
