import { hash32, rngInt, rngPick, rngShuffle, rngWeighted } from './rng.mjs';
import {
  BRANDS, GARMENTS, PERSONAS, SLOTS, REQUIRED_SLOTS,
  garment, garmentsBySlot, persona, role, disclosureCompleteness
} from './data.mjs';

export const RESIDENT_COUNT = 40;

const NAMES = [
  'Mira', 'Otto', 'Sana', 'Piet', 'Ines', 'Kofi', 'Lena', 'Bram', 'Nadia', 'Yusuf',
  'Clara', 'Hugo', 'Tamsin', 'Idris', 'Rosa', 'Felix', 'Nell', 'Anya', 'Milo', 'Greta',
  'Jonah', 'Saskia', 'Emre', 'Delia', 'Theo', 'Ivy', 'Rune', 'Camille', 'Osric', 'Farah',
  'Leo', 'Maud', 'Dario', 'Petra', 'Kwame', 'Elsie', 'Arno', 'Noor', 'Viggo', 'Cleo',
  'Hana', 'Barnaby', 'Suki', 'Ramona', 'Ezra', 'Marit', 'Tobias', 'Juno', 'Selma', 'Aurelio',
  'Britt', 'Niamh', 'Halden', 'Pia', 'Casimir', 'Odette', 'Wren', 'Tarek', 'Lucia', 'Soren',
  'Fenna', 'Gil', 'Marisol', 'Edvin'
];
const SKINS = ['#F6DFCB', '#EDC7A6', '#DCA980', '#C08A5C', '#9C6740', '#734727', '#523520', '#E3B490'];
const HAIR_COLORS = ['#2B1B12', '#4A2C1A', '#7A4A22', '#B87333', '#D9B37C', '#6E6E74', '#2F2A3B', '#8C3B2E'];
const HAIR_STYLES = ['bun', 'crop', 'curls', 'long', 'cap'];
const BUILDS = ['slim', 'average', 'broad'];

const ROLE_PLAN = [['influencer', 4], ['office', 10], ['student', 6], ['barista', 2],
  ['shopStaff', 5], ['courier', 4], ['retiree', 5], ['creative', 4]];

// Nudges only. Every persona keeps a non-trivial weight under every role, because the
// mismatches (a Conscious courier, a Minimalist influencer) are the cases worth watching.
const PERSONA_NUDGE = {
  influencer: { trend: 2.4, bargain: 0.8, loyalist: 1.1, conscious: 0.6, minimalist: 0.5 },
  office: { loyalist: 1.9, conscious: 1.2, minimalist: 1.1, trend: 0.9, bargain: 0.8 },
  student: { bargain: 2.2, trend: 1.8, minimalist: 0.7, conscious: 0.6, loyalist: 0.4 },
  barista: { minimalist: 1.6, bargain: 1.3, conscious: 1.2, trend: 0.8, loyalist: 0.8 },
  shopStaff: { loyalist: 2.0, trend: 1.3, minimalist: 0.9, conscious: 0.9, bargain: 0.8 },
  courier: { bargain: 2.1, trend: 1.6, minimalist: 0.9, conscious: 0.7, loyalist: 0.5 },
  retiree: { minimalist: 2.1, loyalist: 1.9, conscious: 1.1, bargain: 0.9, trend: 0.2 },
  creative: { conscious: 1.8, trend: 1.4, minimalist: 1.2, loyalist: 0.8, bargain: 0.7 }
};
const TREND_SENSE = { trend: 1.0, bargain: 0.35, loyalist: 0.25, conscious: 0.2, minimalist: 0.1 };

const BRAND_TAGS = new Map(BRANDS.map(b => [b.id, new Set()]));
for (const g of GARMENTS) for (const t of g.styleTags) BRAND_TAGS.get(g.brandId).add(t);

const clamp01 = n => (n < 0 ? 0 : n > 1 ? 1 : n);

export function styleAffinity(resident, g) {
  const p = persona(resident.personaId);
  const tag = g.styleTags.filter(t => p.styleTags.includes(t)).length / g.styleTags.length;
  const colour = hash32(`${resident.id}:${g.colorName}`) % 1000 / 1000;
  const loyal = resident.favouriteBrandId === g.brandId ? 0.18 : 0;
  const seen = resident.social?.awareness?.[g.brandId] ?? 0;
  return clamp01(0.62 * tag + 0.2 * colour + loyal + Math.min(0.12, seen * 0.04));
}

// -1..1. `brandIds` is the shop staff's own house: its tags join the prefer set and the
// garment itself gets a bonus, which is how A2's "wears the house they sell" is resolved.
export function dressCodeScore(g, r, brandIds = []) {
  const prefer = new Set(r.dress.prefer);
  for (const b of brandIds) for (const t of BRAND_TAGS.get(b) ?? []) prefer.add(t);
  const hit = g.styleTags.filter(t => prefer.has(t)).length / g.styleTags.length;
  const bad = g.styleTags.filter(t => r.dress.avoid.includes(t)).length;
  return Math.max(-1, Math.min(1, hit + (brandIds.includes(g.brandId) ? 0.35 : 0) - 0.5 * bad));
}

const OPTIONAL_FLOOR = 0.34;

export function dressFor(resident, context) {
  const r = role(resident.roleId), coded = context === 'work';
  const out = {};
  for (const slot of SLOTS) {
    let best = null, bestScore = -Infinity;
    for (const w of resident.wardrobe) {
      if (w.slot !== slot || w.retiredDay !== null) continue;
      const g = garment(w.garmentId);
      const s = styleAffinity(resident, g)
        + (coded ? r.dress.strength * dressCodeScore(g, r, resident.workplace.brandIds) : 0);
      if (s > bestScore) { bestScore = s; best = w.garmentId; }
    }
    out[slot] = best && (REQUIRED_SLOTS.includes(slot) || bestScore >= OPTIONAL_FLOOR) ? best : null;
  }
  return out;
}

// The only supported way to change what is on the body: re-derives from the wardrobe, so a
// garment bought this tick gets worn and `outfit` cannot drift from `outfits[context]`.
export function setContext(resident, context) {
  resident.context = context;
  resident.outfits[context] = dressFor(resident, context);
  resident.outfit = { ...resident.outfits[context] };
  return resident.outfit;
}

export function needFor(resident, slot, day = null) {
  const p = persona(resident.personaId);
  const bias = resident.needBias?.[slot] ?? 0;
  const worn = resident.outfit?.[slot];
  if (!worn) return clamp01(1 + bias);
  const w = resident.wardrobe.find(x => x.garmentId === worn && x.retiredDay === null), g = garment(worn);
  let n = clamp01((w?.wears ?? 0) / (g.durability.baseWears * p.wearOutMultiplier));
  if (!REQUIRED_SLOTS.includes(slot) && day !== null && w) {
    n += p.boredom * Math.min(1, Math.max(0, day - w.acquiredDay) / 14);
  }
  return clamp01(n + bias);
}

export function trendSensitivity(resident, posterId = null) {
  const base = TREND_SENSE[resident.personaId] ?? 0.25;
  return posterId && resident.social.follows.includes(posterId) ? base * 1.5 : base;
}

// ctx.price lets the sim pass a stock/surcharge-adjusted price (B1); the staff discount is
// applied on top of whatever price it passes.
export function priceFor(resident, g, ctx = {}) {
  const base = ctx.price ?? g.price;
  return resident.workplace.brandIds.includes(g.brandId) ? base * 0.7 : base;
}

export function utility(resident, g, ctx = {}) {
  const p = persona(resident.personaId), r = role(resident.roleId);
  const day = ctx.day ?? null;
  const poster = ctx.posterId ?? ctx.town?.trendPosters?.[g.brandId] ?? null;
  const trendBonus = (ctx.town?.trends?.[g.brandId] ?? 0) * trendSensitivity(resident, poster);
  const eco = g.passport.published ? disclosureCompleteness(g) : 0;
  return p.weights.style * styleAffinity(resident, g)
    + p.weights.eco * eco
    - p.weights.price * (priceFor(resident, g, ctx) / (p.budget.ceiling * r.spendBias))
    + needFor(resident, g.slot, day)
    + trendBonus
    + (resident.social.awareness[g.brandId] ?? 0) * 0.15
    - 0.55;
}

export function dressResident(rng, resident, day) {
  const p = persona(resident.personaId), r = role(resident.roleId);
  const cap = p.budget.ceiling * r.spendBias;
  resident.wardrobe = [];
  const size = rngInt(rng, 4, 8);
  const plan = [...REQUIRED_SLOTS, 'top', 'bottom',
    ...rngShuffle(rng, ['outer', 'hat', 'scarf', 'glasses', 'shoes', 'top'])].slice(0, size);
  const owned = new Set();
  const buy = slot => {
    const free = garmentsBySlot(slot).filter(g => !owned.has(g.id));
    let pool = free.filter(g => g.price <= cap);
    // A required slot must be filled even by the poorest resident, so it may overspend once;
    // an extra item never does, or a Bargain Hunter starts out in clothes they could not buy.
    if (!pool.length && REQUIRED_SLOTS.includes(slot) && !resident.wardrobe.some(w => w.slot === slot)) {
      pool = free.slice().sort((a, b) => a.price - b.price).slice(0, 1);
    }
    if (!pool.length) return false;
    const g = rngWeighted(rng, pool.map(x => ({
      value: x,
      weight: (0.12 + styleAffinity(resident, x)
        + 0.4 * Math.max(0, dressCodeScore(x, r, resident.workplace.brandIds))) ** 2
    })));
    const acquiredDay = day - rngInt(rng, 6, 300);
    const ceilingWears = Math.floor(g.durability.baseWears * p.wearOutMultiplier * 0.55);
    owned.add(g.id);
    resident.wardrobe.push({
      garmentId: g.id, slot, acquiredDay, retiredDay: null,
      wears: Math.max(1, Math.min(day - acquiredDay, Math.round(ceilingWears * rng())))
    });
    return true;
  };
  for (const slot of plan) buy(slot);
  // Top-up: a slot the budget priced out is made good elsewhere, so the wardrobe still
  // reaches `size` whenever the catalog affords it at all.
  for (const slot of rngShuffle(rng, SLOTS)) {
    while (resident.wardrobe.length < size && buy(slot));
    if (resident.wardrobe.length >= size) break;
  }
  resident.outfits = { work: dressFor(resident, 'work'), casual: dressFor(resident, 'casual') };
  setContext(resident, resident.context);
  return resident;
}

function workplaceFor(r, shop) {
  const work = r.schedule.filter(b => b.venue === 'work');
  // Roles with no work block (influencer, courier, retiree) still have a day out of the
  // house; the sim uses shiftFrom/shiftTo as that span, not as employment.
  const span = work.length ? work : r.schedule.filter(b => b.activity !== 'home');
  const buildingId = shop ? shop.buildingId : r.workplaceKind;
  return {
    buildingId,
    siteId: shop ? `site-browse-${shop.id}` : buildingId ? `site-${buildingId}` : null,
    brandIds: shop ? [...shop.brandIds] : [],
    shiftFrom: span[0].from, shiftTo: span[span.length - 1].to
  };
}

function linkSocially(rng, residents, homes) {
  const byHome = new Map(homes.map(h => [h, []]));
  const byWork = new Map();
  for (const r of residents) {
    byHome.get(r.homeId).push(r.id);
    const b = r.workplace.buildingId;
    if (b) (byWork.get(b) ?? byWork.set(b, []).get(b)).push(r.id);
  }
  for (const r of residents) {
    const k = homes.indexOf(r.homeId), n = homes.length;
    r.social.neighbours = [byHome.get(homes[(k - 1 + n) % n]), byHome.get(homes[(k + 1) % n])]
      .flat().filter(id => id !== r.id);
    r.social.colleagues = (byWork.get(r.workplace.buildingId) ?? []).filter(id => id !== r.id);
  }
  // A high-reach role broadcasts rather than follows, so its own weight to be picked is lower.
  for (const inf of residents.filter(r => role(r.roleId).followable)) {
    const pool = residents.filter(r => r.id !== inf.id)
      .map(r => ({ value: r, weight: 1 - 0.6 * role(r.roleId).socialReach }));
    const target = rngInt(rng, 6, 14);
    for (let i = 0; i < target && pool.length; i++) {
      const pick = rngWeighted(rng, pool);
      pool.splice(pool.findIndex(e => e.value === pick), 1);
      pick.social.follows.push(inf.id);
    }
  }
}

export function generateResidents(rng, layout) {
  const nodeById = new Map(layout.nodes.map(n => [n.id, n]));
  const buildingById = new Map(layout.buildings.map(b => [b.id, b]));
  const names = rngShuffle(rng, NAMES);
  const roleIds = rngShuffle(rng, ROLE_PLAN.flatMap(([id, n]) => Array(n).fill(id)));
  const residents = [];
  let staffNo = 0;
  for (let i = 0; i < RESIDENT_COUNT; i++) {
    const roleId = roleIds[i], r = role(roleId);
    const personaId = rngWeighted(rng, PERSONAS.map(p => ({ value: p.id, weight: PERSONA_NUDGE[roleId][p.id] })));
    const p = persona(personaId);
    const homeId = layout.homes[i % layout.homes.length];
    const door = nodeById.get(buildingById.get(homeId).doorNodeId);
    const shop = roleId === 'shopStaff' ? layout.shops[staffNo++ % layout.shops.length] : null;
    const resident = {
      id: `r${String(i + 1).padStart(2, '0')}`,
      name: names[i], personaId, roleId,
      body: {
        heightScale: Math.round((0.94 + rng() * 0.12) * 1000) / 1000,
        build: rngPick(rng, BUILDS), skin: rngPick(rng, SKINS),
        hair: { style: rngPick(rng, HAIR_STYLES), color: rngPick(rng, HAIR_COLORS) }
      },
      homeId,
      workplace: workplaceFor(r, shop),
      wallet: Math.round(p.incomePerDay * (1 + rng() * 2)),
      outfit: {}, outfits: { work: {}, casual: {} }, context: 'casual',
      wardrobe: [], history: [],
      favouriteBrandId: personaId === 'loyalist' ? rngPick(rng, BRANDS).id : null,
      social: { follows: [], colleagues: [], neighbours: [], awareness: {} },
      activity: { kind: null, siteId: null, until: 0, partnerId: null },
      wishlist: {}, needBias: {},
      motion: {
        nodeId: door.id, x: door.x, y: door.y, heading: 0, speed: r.walkSpeed,
        path: [], pathIndex: 0, destinationId: null, activity: 'idle', waitUntil: 0
      },
      stats: { bought: 0, binned: 0, resold: 0, donated: 0, spend: 0 }
    };
    residents.push(resident);
  }
  linkSocially(rng, residents, layout.homes);
  for (const resident of residents) dressResident(rng, resident, 0);
  return residents;
}
