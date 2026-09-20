import { readFile } from 'node:fs/promises';
import { CATEGORIES } from '../shared/domain.mjs';

export async function loadDemoCatalog() {
  return JSON.parse(await readFile(new URL('../shared/catalog.json', import.meta.url), 'utf8'));
}
const PRODUCT_QUERY = `query ClotheeCatalog($after: String) {
  products(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title vendor description productType handle
      featuredImage { url altText }
      passport: metafield(namespace: "clothee", key: "passport") { value }
      overlay: metafield(namespace: "clothee", key: "overlay_url") { value }
      category: metafield(namespace: "clothee", key: "category") { value }
      variants(first: 100) {
        pageInfo { hasNextPage }
        nodes { id title availableForSale selectedOptions { name value } price { amount currencyCode } }
      }
    }
  }
}`;
export function safeHttpUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
}
export async function shopifyRequest(query, variables = {}, env = process.env, fetcher = fetch) {
  const domain = env.SHOPIFY_STORE_DOMAIN || '';
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain)) throw new Error('Set SHOPIFY_STORE_DOMAIN to your store.myshopify.com hostname');
  if (!env.SHOPIFY_STOREFRONT_TOKEN) throw new Error('SHOPIFY_STOREFRONT_TOKEN is missing');
  const version = env.SHOPIFY_API_VERSION || '2026-07';
  if (!/^20\d\d-(01|04|07|10)$/.test(version)) throw new Error('Invalid Shopify API version');
  const header = env.SHOPIFY_TOKEN_KIND === 'private' ? 'Shopify-Storefront-Private-Token' : 'X-Shopify-Storefront-Access-Token';
  const res = await fetcher(`https://${domain}/api/${version}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', [header]: env.SHOPIFY_STOREFRONT_TOKEN },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`Shopify returned HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Shopify: ${json.errors.map(e => e.message).join('; ').slice(0,500)}`);
  if (!json.data) throw new Error('Shopify returned no data');
  return json.data;
}
const field = value => {
  if (!value || typeof value.value !== 'string' || !safeHttpUrl(value.url)) return { value: 'Not disclosed', status: 'unknown', url: null, date: null };
  // Merchant-entered claims are never promoted to independent verification.
  return { value: value.value.slice(0,1500), status: 'brand-reported', url: safeHttpUrl(value.url), date: String(value.date || '').slice(0,30) };
};
export function normalizeProduct(p) {
  let meta = {};
  try { meta = JSON.parse(p.passport?.value || '{}'); } catch { /* Malformed metadata stays unknown. */ }
  if (!meta || typeof meta !== 'object') meta = {};
  let category = String(p.category?.value || p.productType || '').toLowerCase();
  const aliases = { shirts:'shirt', tops:'shirt', trousers:'pants', hats:'hat', scarves:'scarf', sunglasses:'glasses', footwear:'shoes' };
  category = aliases[category] || category;
  if (!CATEGORIES.includes(category)) category = 'shirt';
  const variants = p.variants.nodes.map(v => ({
    id:v.id, title:v.title, available:v.availableForSale,
    size:v.selectedOptions.find(o => o.name.toLowerCase()==='size')?.value || 'One size',
    color:v.selectedOptions.find(o => /colou?r/i.test(o.name))?.value || 'Original',
    price:Number(v.price.amount), currency:v.price.currencyCode
  }));
  const materials = Array.isArray(meta.materials) ? meta.materials.filter(m => typeof m.name === 'string' && Number.isFinite(m.percent) && m.percent>=0 && m.percent<=100).map(m=>({name:m.name.slice(0,60),percent:m.percent})).slice(0,12) : [];
  const carbon = meta.carbon;
  return {
    id:p.id,title:p.title,vendor:p.vendor,description:p.description,category,source:'shopify',
    imageUrl:safeHttpUrl(p.featuredImage?.url),overlayUrl:safeHttpUrl(p.overlay?.value),
    colorHex:/^#[0-9a-f]{6}$/i.test(meta.colorHex) ? meta.colorHex : '#b5a2df',
    variants,materials,materialsStatus:materials.length?'brand-reported':'unknown',
    variantsTruncated:Boolean(p.variants.pageInfo?.hasNextPage),
    passport: { sourcing:field(meta.sourcing), manufacturing:field(meta.manufacturing), wages:field(meta.wages), ethics:field(meta.ethics),
      carbon: carbon && Number.isFinite(carbon.kgCO2e) && carbon.kgCO2e>=0 && safeHttpUrl(carbon.url) && typeof carbon.boundary==='string'
        ? { kgCO2e:carbon.kgCO2e, boundary:carbon.boundary.slice(0,300), method:String(carbon.method||'Not disclosed').slice(0,300),url:safeHttpUrl(carbon.url),date:String(carbon.date||''),status:'brand-reported' } : null }
  };
}
export async function loadShopifyCatalog(env = process.env, fetcher = fetch) {
  const products = []; let after = null; let truncated = false;
  for (let page=0; page<5; page++) {
    const d = await shopifyRequest(PRODUCT_QUERY,{after},env,fetcher);
    products.push(...d.products.nodes.filter(p=>p.variants.nodes.length).map(normalizeProduct));
    truncated = d.products.pageInfo.hasNextPage;
    if (!truncated) break;
    after = d.products.pageInfo.endCursor;
  }
  if (!products.length) throw new Error('No published products found in the Shopify sales channel');
  return {products,truncated};
}
export async function createCart(variantId, env = process.env, fetcher = fetch) {
  const d = await shopifyRequest(`mutation ClotheeCart($input: CartInput!) {
    cartCreate(input:$input) { cart { id checkoutUrl } userErrors { field message } }
  }`,{input:{lines:[{merchandiseId:variantId,quantity:1}]}},env,fetcher);
  const c = d.cartCreate;
  if (c.userErrors?.length) throw new Error(c.userErrors.map(e=>e.message).join('; '));
  if (!c.cart?.checkoutUrl || !safeHttpUrl(c.cart.checkoutUrl)) throw new Error('Shopify did not return a secure checkout URL');
  return c.cart;
}
