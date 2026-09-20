import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const version='0.10.32';
const root=new URL('../public/vendor/',import.meta.url);
const files=[
  ['vision_bundle.mjs',`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/vision_bundle.mjs`],
  ...['vision_wasm_internal.wasm','vision_wasm_internal.js','vision_wasm_nosimd_internal.wasm','vision_wasm_nosimd_internal.js'].map(f=>['wasm/'+f,`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm/${f}`]),
  ['pose_landmarker_lite.task','https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task']
];
await mkdir(new URL('wasm/',root),{recursive:true});
for(const [name,url]of files){const r=await fetch(url,{signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error(`Download failed for ${name}: HTTP ${r.status}`);const bytes=new Uint8Array(await r.arrayBuffer());await writeFile(new URL(name,root),bytes);console.log(`${name}: ${bytes.length} bytes`);}
console.log(`Pose tracking is ready in ${fileURLToPath(root)}. Reload the fitting room.`);
