import brandsJson from './brands.json' with { type: 'json' };
import garmentsJson from './garments.json' with { type: 'json' };
import personasJson from './personas.json' with { type: 'json' };
import factorsJson from './factors.json' with { type: 'json' };
import rolesJson from './roles.json' with { type: 'json' };

// Seed data is deep-frozen: the merchant sandbox flips passport.published, so a shallow
// copy would silently corrupt every later run. Clone (structuredClone) before mutating.
function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); }
  return v;
}
export const BRANDS = deepFreeze(brandsJson);
export const GARMENTS = deepFreeze(garmentsJson);
export const PERSONAS = deepFreeze(personasJson);
export const FACTORS = deepFreeze(factorsJson);
export const ROLES = deepFreeze(rolesJson);

export const SLOTS = ['top', 'bottom', 'outer', 'shoes', 'hat', 'scarf', 'glasses'];
export const REQUIRED_SLOTS = ['top', 'bottom', 'shoes'];
export const METRICS = ['co2e', 'water', 'waste'];
const PASSPORT_KEYS = ['materials', 'mass', 'origin', 'factory', 'wages', 'carbon', 'water', 'waste', 'endOfLife'];

const index = list => new Map(list.map(x => [x.id, x]));
const brandIndex = index(BRANDS), garmentIndex = index(GARMENTS), personaIndex = index(PERSONAS), roleIndex = index(ROLES);
const factorIndex = new Map(FACTORS.map(f => [`${f.material}:${f.metric}`, f]));

const lookup = (map, id, what) => {
  const hit = map.get(id);
  if (!hit) throw new Error(`Unknown ${what}: ${JSON.stringify(id)}`);
  return hit;
};
export const brand = id => lookup(brandIndex, id, 'brand');
export const garment = id => lookup(garmentIndex, id, 'garment');
export const persona = id => lookup(personaIndex, id, 'persona');
export const role = id => lookup(roleIndex, id, 'role');

export const garmentsBySlot = slot => GARMENTS.filter(g => g.slot === slot);
export const garmentsByBrand = brandId => GARMENTS.filter(g => g.brandId === brandId);
export const garmentsInShop = shop => GARMENTS.filter(g => shop.brandIds.includes(g.brandId));

export const factor = (material, metric) => factorIndex.get(`${material}:${metric}`);
const isSourced = f => !!f && f.status === 'sourced' && typeof f.sourceUrl === 'string' && f.sourceUrl.length > 0
  && typeof f.year === 'number' && typeof f.value === 'number';

// A metric is a number only when EVERY material has a sourced factor for it. Never partial-sum:
// a half-summed footprint reads as a real measurement and is worse than showing nothing.
export function footprintOf(g) {
  const out = { co2e: null, water: null, waste: null,
    unit: { co2e: 'kgCO2e', water: 'L', waste: 'kg' },
    boundary: 'material-based, cradle-to-gate', unsourced: [], complete: false };
  for (const metric of METRICS) {
    let sum = 0, blocked = false;
    for (const m of g.materials) {
      const f = factor(m.name, metric);
      if (isSourced(f)) sum += g.massKg * (m.percent / 100) * f.value;
      else { out.unsourced.push(`${m.name}:${metric}`); blocked = true; }
    }
    if (!blocked) out[metric] = sum;
  }
  out.complete = METRICS.every(m => out[m] !== null);
  return out;
}

export const disclosureCompleteness = g =>
  PASSPORT_KEYS.filter(k => g.passport.fields[k].status === 'disclosed').length / PASSPORT_KEYS.length;

export function validateSeedData() {
  const fail = m => { throw new Error(`Seed data invalid: ${m}`); };
  const ids = list => list.map(x => x.id).sort().join(',');
  if (ids(BRANDS) !== 'crux,halcyon,northbeck,pellmell,solane,verdant') fail(`brand ids are ${ids(BRANDS)}`);
  if (ids(PERSONAS) !== 'bargain,conscious,loyalist,minimalist,trend') fail(`persona ids are ${ids(PERSONAS)}`);
  if (GARMENTS.length !== 24) fail(`expected 24 garments, got ${GARMENTS.length}`);
  if (new Set(GARMENTS.map(g => g.id)).size !== 24) fail('garment ids are not unique');

  for (const slot of SLOTS) {
    const n = garmentsBySlot(slot).length;
    if (n < 3) fail(`slot ${slot} has ${n} options, needs >= 3`);
  }
  for (const g of GARMENTS) {
    if (!SLOTS.includes(g.slot)) fail(`${g.id} has unknown slot ${g.slot}`);
    if (!brandIndex.has(g.brandId)) fail(`${g.id} references unknown brand ${g.brandId}`);
    const total = g.materials.reduce((s, m) => s + m.percent, 0);
    if (total !== 100) fail(`${g.id} materials sum to ${total}, not 100`);
    for (const m of g.materials) {
      for (const metric of METRICS) if (!factor(m.name, metric)) fail(`${g.id} uses material ${m.name} with no ${metric} factor`);
    }
    const keys = Object.keys(g.passport.fields);
    if (keys.length !== 9 || PASSPORT_KEYS.some(k => !keys.includes(k))) fail(`${g.id} passport.fields keys are ${keys.join(',')}`);
  }
  for (const p of PERSONAS) {
    const total = Object.values(p.disposal).reduce((s, x) => s + x, 0);
    if (Math.abs(total - 1) > 1e-9) fail(`persona ${p.id} disposal weights sum to ${total}, not 1`);
  }
  const tags = new Set(GARMENTS.flatMap(g => g.styleTags));
  if (ids(ROLES) !== 'barista,courier,creative,influencer,office,retiree,shopStaff,student') fail(`role ids are ${ids(ROLES)}`);
  for (const r of ROLES) {
    // Schedule blocks are consumed by walking the list once per tick, so a gap or an overlap
    // leaves a resident with no block (or two) at that dayFraction. Checked, not assumed.
    let edge = 0;
    for (const b of r.schedule) {
      if (Math.abs(b.from - edge) > 1e-9) fail(`role ${r.id} schedule jumps from ${edge} to ${b.from}`);
      if (!(b.to > b.from)) fail(`role ${r.id} has a block ${b.from}->${b.to} that does not advance`);
      edge = b.to;
    }
    if (Math.abs(edge - 1) > 1e-9) fail(`role ${r.id} schedule ends at ${edge}, not 1`);
    const weights = Object.values(r.interactions);
    if (!weights.length || weights.some(w => !(w > 0))) fail(`role ${r.id} has a non-positive interaction weight`);
    const total = weights.reduce((s, w) => s + w, 0);
    if (Math.abs(total - 1) > 1e-9) fail(`role ${r.id} interaction weights sum to ${total}, not 1`);
    for (const t of [...r.dress.prefer, ...r.dress.avoid]) if (!tags.has(t)) fail(`role ${r.id} dress tag ${t} is on no garment`);
  }
  for (const f of FACTORS) {
    if (f.value !== null && !isSourced(f)) fail(`factor ${f.material}:${f.metric} carries a value without status 'sourced' + sourceUrl + year`);
  }
  return true;
}
