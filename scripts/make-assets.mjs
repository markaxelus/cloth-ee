// Original vector artwork and fictional product fixtures. No third-party images.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(path.join(root,'public/assets/garments'),{recursive:true});
const defs=c=>`<defs><linearGradient id="fabric" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".83"/></linearGradient><pattern id="weave" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 1H6M1 0V6" stroke="#fff" stroke-opacity=".13" stroke-width=".5"/></pattern></defs>`;
const shapes={
shirt:`<path d="M128 32L66 58 12 139 68 180 99 139 88 427Q200 455 312 427L301 139 332 180 388 139 334 58 272 32Q260 84 200 87 140 84 128 32Z"/><path d="M130 33Q139 99 200 101 261 99 271 33M95 136L114 180M305 136L286 180M90 415Q200 440 310 415" fill="none" stroke="#645373" stroke-opacity=".23" stroke-width="5"/><path d="M151 133Q139 243 146 397M257 132Q266 254 255 397" fill="none" stroke="#fff" stroke-opacity=".19" stroke-width="4"/><path d="M223 143h42v53q-21 17-42 0Z" fill="#fff" fill-opacity=".14"/>`,
pants:`<path d="M87 22Q200 34 313 22L322 157 303 464 218 464 200 194 182 464 97 464 78 157Z"/><path d="M88 48Q200 61 312 48M200 54V194M92 78Q140 84 136 124M308 78Q260 84 264 124M102 437H181M219 437H297" fill="none" stroke="#453f3b" stroke-opacity=".22" stroke-width="4"/><circle cx="200" cy="41" r="5" fill="#61594e"/>`,
hat:`<path d="M89 253Q87 118 200 112 313 118 311 253L354 307Q199 368 46 307Z"/><path d="M91 253Q200 283 309 253M98 258L74 301M301 259L326 302" fill="none" stroke="#4d5c43" stroke-opacity=".28" stroke-width="6"/><path d="M135 164Q155 133 194 130" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="9" stroke-linecap="round"/>`,
glasses:`<path d="M24 185Q97 163 167 185L184 215H216L233 185Q303 163 376 185L364 275Q299 310 239 272L219 236H181L161 272Q101 310 36 275Z"/><path d="M48 203Q100 189 151 203L145 257Q101 278 54 257ZM249 203Q300 189 352 203L346 257Q299 278 255 257Z" fill="#504b64" fill-opacity=".85"/><path d="M62 216L96 207M265 216L297 207" fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="6" stroke-linecap="round"/>`,
scarf:`<path d="M95 120Q203 168 301 113L312 208Q204 254 85 211Z"/><path d="M142 207L225 229 206 438 119 421ZM225 217L301 205 326 364 247 386Z"/><path d="M100 146Q200 192 300 144M98 181Q200 226 305 180M137 408L133 447M158 412L155 450M180 416L178 452M200 420L199 455" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="7"/>`,
shoes:`<path d="M23 196L95 177 116 226 178 253 176 292H20ZM215 196L287 177 308 226 370 253 368 292H212Z"/><path d="M20 278H177V302H20ZM212 278H369V302H212Z" fill="#f8f6ef"/><path d="M96 214L125 214M104 230L141 230M288 214L317 214M296 230L333 230" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`
};
const specs=[
['cloud-tee','The cloud tee','Cloud Club','shirt','#b9a4dd','Cotton',48,7.2,'Lilac','An easy everyday shape, with a little room to move.'],
['oat-shirt','Sunday linen','Slow Sunday','shirt','#ddd2b8','Linen',76,6.4,'Oat','A breezy layer for slow mornings and warm afternoons.'],
['peach-tee','Peach, please','Cloud Club','shirt','#efb9a3','Cotton',48,7.2,'Peach','A soft pop of colour for your everyday rotation.'],
['moss-pants','The day-off pant','Slow Sunday','pants','#879981','Cotton',92,12.8,'Moss','Relaxed lines, roomy pockets and a go-anywhere colour.'],
['cream-pants','Wide awake','Cloud Club','pants','#d8cbb3','Linen',98,10.6,'Sand','An airy wide-leg silhouette to dress up or down.'],
['bucket-hat','A little shade','Daydream Supply','hat','#adbea0','Cotton',32,2.1,'Sage','Your sunny-day plus one.'],
['sun-glasses','Rose-tinted','Daydream Supply','glasses','#c795ab','Other',58,null,'Rose','A playful frame preview. No UV rating is claimed.'],
['wool-scarf','Warm company','Slow Sunday','scarf','#d8afc5','Wool',64,9.8,'Blush','A cosy colour accent for cooler days.'],
['daily-shoes','Everyday clouds','Daydream Supply','shoes','#a5bcb5','Other',110,null,'Mint','A simple sneaker silhouette for the camera fitting room.'],
['run-tee','Ready, set, go','Cloud Club','shirt','#92bcc0','Polyester',54,5.8,'Seafoam','A quick-drying fabric concept for a more active day.']
];
const products=[];
for(const [id,title,vendor,category,colorHex,material,price,carbon,color,description]of specs){
  const boxes={shirt:'0 0 400 480',pants:'0 0 400 480',hat:'35 100 330 260',glasses:'14 168 372 139',scarf:'70 103 267 352',shoes:'12 165 366 146'};
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${boxes[category]}">${defs(colorHex)}<g fill="url(#fabric)" stroke-linejoin="round">${shapes[category]}</g></svg>`;
  await writeFile(path.join(root,`public/assets/garments/${id}.svg`),svg);
  const sizes=category==='shoes'?['40','41','42','43','44']:['hat','glasses','scarf'].includes(category)?['One size']:['XS','S','M','L','XL'];
  const claim=value=>({value,status:'demo',url:null,date:null});
  products.push({id,title,vendor,category,colorHex,description,source:'demo',imageUrl:`/assets/garments/${id}.svg`,overlayUrl:`/assets/garments/${id}.svg`,overlayPngUrl:`/assets/garments/${id}.png`,
    variants:sizes.map(size=>({id:`${id}-${size}`,title:`${color} / ${size}`,size,color,price,currency:'CAD',available:true})),materials:material==='Other'?[]:[{name:material,percent:100}],materialsStatus:'demo',
    passport:{sourcing:claim(material==='Linen'?'Illustrative route: flax grown in France.':material==='Wool'?'Illustrative route: wool sourced in New Zealand.':'Illustrative route: fibre sourcing location not established.'),manufacturing:claim('Illustrative route: fabric processing and garment assembly in Portugal.'),wages:{value:'Not disclosed',status:'unknown',url:null,date:null},ethics:claim('Fictional brand. No audit, certification or ethical rating is claimed.'),carbon:carbon?{kgCO2e:carbon,boundary:'Illustrative cradle-to-delivery fixture; excludes use, returns and end of life.',method:'Made-up demo value for testing the interface. Not an LCA.',url:null,date:null,status:'demo'}:null}});
}
await writeFile(path.join(root,'shared/catalog.json'),JSON.stringify(products,null,2)+'\n');
await writeFile(path.join(root,'public/assets/logo.svg'),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect x="2" y="2" width="76" height="76" rx="27" fill="#c5b2e6"/><path d="M24 30Q25 18 40 18 53 18 53 29L42 39 63 52Q67 57 60 59H19Q12 57 18 52L38 39" fill="none" stroke="#3c2b58" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="33" cy="51" r="2" fill="#3c2b58"/><circle cx="47" cy="51" r="2" fill="#3c2b58"/></svg>`);
await writeFile(path.join(root,'public/assets/person.svg'),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 800"><defs><linearGradient id="skin"><stop stop-color="#e1b89c"/><stop offset="1" stop-color="#f0d1b8"/></linearGradient><linearGradient id="pants"><stop stop-color="#cdc6b7"/><stop offset="1" stop-color="#e0d9ca"/></linearGradient></defs><ellipse cx="250" cy="776" rx="139" ry="14" fill="#867396" opacity=".1"/><path d="M212 148H288L293 209H208Z" fill="url(#skin)"/><path d="M195 239L163 268 131 438 125 498Q126 519 141 511L160 464 202 332ZM303 241L336 268 368 438 374 498Q374 519 359 511L340 464 298 332Z" fill="url(#skin)"/><path d="M200 208Q250 229 300 208L319 423 301 469H198L181 423Z" fill="#f2ece2"/><path d="M196 440Q250 452 304 440L312 569 298 737H254L250 549 246 737H202L188 569Z" fill="url(#pants)"/><path d="M202 729H247L243 765H181Q171 758 202 745ZM255 729H298L307 745Q339 758 320 765H256Z" fill="#f6f2e9" stroke="#d7cfc3" stroke-width="2"/><ellipse cx="250" cy="111" rx="54" ry="68" fill="url(#skin)"/><path d="M196 109Q181 39 235 37 289 22 305 82L300 119 286 83Q246 106 212 82L204 121Z" fill="#55493f"/><path d="M236 145Q250 152 262 144" fill="none" stroke="#ba896f" stroke-width="3" stroke-linecap="round"/></svg>`);
console.log('Created 10 original garment illustrations, mannequin, logo and sample catalog.');
