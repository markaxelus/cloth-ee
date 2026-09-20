import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,transition,garmentPlacement,perWear,shippingEstimate} from '../shared/domain.mjs';
import {loadDemoCatalog,normalizeProduct,createCart} from '../server/catalog.mjs';
const products=await loadDemoCatalog();
test('selection, sizing and favorites persist across ordinary navigation',()=>{
  let s=newState(products);s=transition(s,{type:'favorite'},products);s=transition(s,{type:'select',productId:'moss-pants'},products);
  assert.deepEqual(s.favorites,['cloud-tee']);assert.equal(s.variantId,'moss-pants-M');assert.equal(s.revision,2);
});
test('invalid products, sizes, profiles and non-finite alignment fail',()=>{
  const s=newState(products);
  for(const a of [{type:'select',productId:'missing'},{type:'variant',variantId:'wrong'},{type:'profile',profile:{heightCm:NaN}},{type:'fit',fit:{x:0,y:0,scale:Infinity,rotation:0}}])assert.throws(()=>transition(s,a,products));
  assert.equal(s.revision,0);
});
test('cost per wear and shipping units are explicit',()=>{
  assert.equal(perWear(60,30),2);assert.throws(()=>perWear(60,0));
  assert.equal(shippingEstimate({massKg:.5,distanceKm:1000,kgCO2ePerTonneKm:.1,returnFraction:1}),.1);
});
test('torso overlay is upright regardless of left/right landmark naming',()=>{
  const points=Array.from({length:33},()=>({x:.5,y:.5,visibility:1}));
  points[11]={x:.7,y:.3,visibility:1};points[12]={x:.3,y:.3,visibility:1};points[23]={x:.6,y:.65,visibility:1};points[24]={x:.4,y:.65,visibility:1};
  const placement=garmentPlacement('shirt',points,4/3);assert.equal(placement.rotation,0);assert.ok(Math.abs(placement.width-.66)<1e-6);assert.ok(placement.height>0);
  points[11].visibility=.2;assert.equal(garmentPlacement('shirt',points),null);assert.equal(garmentPlacement('shirt',null),null);
});
function shopProduct(meta={}){return {id:'gid://shopify/Product/1',title:'Real item',vendor:'Merchant',description:'Description',productType:'Tops',featuredImage:{url:'https://cdn.shopify.com/item.jpg'},passport:{value:JSON.stringify(meta)},variants:{nodes:[{id:'gid://shopify/ProductVariant/1',title:'Blue / M',availableForSale:true,selectedOptions:[{name:'Size',value:'M'},{name:'Color',value:'Blue'}],price:{amount:'55.00',currencyCode:'CAD'}}],pageInfo:{hasNextPage:false}}};}
test('unsourced claims remain unknown; sourced claims stay merchant reported',()=>{
  const p=normalizeProduct(shopProduct({wages:{value:'Living wage',status:'verified'},carbon:{kgCO2e:1},manufacturing:{value:'Canada',status:'verified',url:'https://example.com/report'}}));
  assert.equal(p.passport.wages.status,'unknown');assert.equal(p.passport.carbon,null);assert.equal(p.passport.manufacturing.status,'brand-reported');assert.equal(p.variants[0].size,'M');assert.equal(p.category,'shirt');
});
test('cart creation forwards exact Shopify merchandise variant and surfaces user errors',async()=>{
  const env={SHOPIFY_STORE_DOMAIN:'test-store.myshopify.com',SHOPIFY_STOREFRONT_TOKEN:'fixture',SHOPIFY_API_VERSION:'2026-07'};
  let sent;
  const cart=await createCart('gid://shopify/ProductVariant/123',env,async(url,options)=>{sent={url,options,body:JSON.parse(options.body)};return Response.json({data:{cartCreate:{cart:{id:'cart-1',checkoutUrl:'https://test-store.myshopify.com/checkouts/test'},userErrors:[]}}});});
  assert.equal(sent.body.variables.input.lines[0].merchandiseId,'gid://shopify/ProductVariant/123');assert.match(sent.url,/2026-07/);assert.ok(cart.checkoutUrl);
  await assert.rejects(()=>createCart('v',env,async()=>Response.json({data:{cartCreate:{cart:null,userErrors:[{message:'Sold out'}]}}})),/Sold out/);
});
