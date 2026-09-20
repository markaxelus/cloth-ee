import { hash32 } from './rng.mjs';
import { BRANDS, GARMENTS, PERSONAS, SLOTS, garment } from './data.mjs';

// The ONLY module whose output may be handed to a model. Everything here is derived from what
// a camera pointed at one resident right now could see. No id, name, persona, role, wallet,
// price, material, skin or hair crosses this boundary — assertNoGroundTruth enforces it.

const COVERAGE = { top: 'torso and upper arms', bottom: 'waist to ankle', outer: 'over the torso, open at the front', shoes: 'feet', hat: 'head', scarf: 'neck', glasses: 'eyes' };
const SIL = {
  buttonShirt: ['button shirt', 'shirtish'], tee: ['t-shirt', 'shirtish'], knit: ['knit sweater', 'shirtish'],
  jacket: ['jacket', 'outerwear'], coat: ['long coat', 'outerwear'],
  trousers: ['trousers', 'legwear'], jeans: ['jeans', 'legwear'], skirt: ['skirt', 'legwear'], shorts: ['shorts', 'legwear'],
  sneakers: ['sneakers', 'footwear'], boots: ['boots', 'footwear'], flats: ['flat shoes', 'footwear'],
  beanie: ['beanie', 'headwear'], cap: ['cap', 'headwear'], bucket: ['bucket hat', 'headwear'],
  scarf: ['scarf', 'scarf'], glasses: ['glasses', 'glasses']
};
const BY_WORDS = new Map(Object.entries(SIL).map(([id, [words, family]]) => [words, { id, family }]));
// The closed vocabulary a vision model answers in. Words for shapes, never catalog identifiers.
export const SILHOUETTE_WORDS = [...BY_WORDS.keys()];

const PATCH_BASE = { small: 0.55, medium: 0.75, large: 0.9 };
// How much of a patch the camera sees from each view, by where the patch sits on the garment.
const FACING = {
  chest: { front: 1, side: 0.5, back: 0 }, hem: { front: 1, side: 0.7, back: 0.55 },
  brim: { front: 1, side: 0.6, back: 0.2 }, tag: { front: 0.25, side: 0.5, back: 0.9 },
  sleeve: { front: 0.6, side: 1, back: 0.6 }, temple: { front: 0.2, side: 1, back: 0.15 }
};
// [what the context field says, how the locator says it]
const ACT = {
  photo: ['standing, phone raised', 'photographing'], sit: ['sitting on a bench', 'sitting'],
  read: ['sitting, reading', 'reading'], gather: ['standing in a small group', 'standing'],
  coffee: ['queuing at a counter', 'queuing'], browse: ['looking into a shop window', 'window-shopping'],
  work: ['standing at a desk', 'working'], workout: ['stretching', 'stretching'],
  wait: ['waiting at the stop', 'waiting'], chat: ['talking with someone', 'talking'],
  dispose: ['dropping something into a bin', 'at the bin'], resell: ['handing something over at a counter', 'at the kiosk'],
  walking: ['walking briskly', 'walking']
};
const CLAUSE = new Map(Object.values(ACT));
const PLACE = { plaza: 'in the plaza', 'high-street': 'on the high street', park: 'in the park', cafe: 'at the café', 'office-front': 'outside the offices', homes: 'on a residential street', civic: 'by the civic block' };
const HOURS = [[0.2, 'early morning'], [0.35, 'morning'], [0.55, 'midday'], [0.72, 'afternoon'], [0.88, 'evening'], [1.01, 'night']];
const NEARBY = 7;
// Two garments "look alike" at 0.80 weighted-RGB agreement within the same silhouette family.
// Calibrated against the catalog: it admits the 5 closest cross-brand pairs and nothing looser
// (the next pair down, coral vs sage, sits at 0.739 and is plainly a different garment).
const LOOKALIKE = 0.8;
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const clamp01 = n => (n < 0 ? 0 : n > 1 ? 1 : n);

export function readPatch(resident, g, view = 'front') {
  const patch = g.patch;
  if (!patch || !patch.text) return { text: null, legibility: 0 };
  const key = `${resident.id}:${g.id}:${view}`;
  const facing = (FACING[patch.placement] ?? FACING.chest)[view] ?? 0;
  const legibility = round(clamp01(PATCH_BASE[patch.size] * facing * (0.8 + hash32(key) % 1000 / 1000 * 0.35)), 2);
  if (legibility < 0.2) return { text: null, legibility };
  // Same hash stream, same masking: a re-scan is byte-identical, so the result is cacheable.
  // Length and character positions are preserved — that is what a partly-read patch looks like.
  let text = '';
  for (let i = 0; i < patch.text.length; i++) text += hash32(`${key}#${i}`) % 1000 / 1000 < legibility ? patch.text[i] : ' ';
  return { text: text.trim() ? text : null, legibility };
}

export function locatorFor(resident, context = null) {
  const piece = slot => {
    const id = resident.outfit?.[slot];
    if (!id) return null;
    const g = garment(id);
    return `${g.colorName} ${SIL[g.silhouette][0]}`;
  };
  const worn = [piece('top') ?? piece('outer'), piece('bottom') ?? piece('shoes')].filter(Boolean);
  const doing = CLAUSE.get(context?.activity) ? ` ${CLAUSE.get(context.activity)}` : '';
  const where = context?.placeKind && PLACE[context.placeKind] ? ` ${PLACE[context.placeKind]}` : '';
  const article = worn.length && 'aeiou'.includes(worn[0][0]) ? 'an' : 'a';
  return `person${doing}${where}${worn.length ? ` in ${article} ${worn.join(' and ')}` : ''}`;
}

const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function placeKindOf(resident, layout) {
  if (!layout) return null;
  const site = resident.activity?.siteId ? layout.sites?.find(s => s.id === resident.activity.siteId) : null;
  if (site?.buildingId === 'cafe-1') return 'cafe';
  const { x, y } = resident.motion;
  let best = null, bd = Infinity;
  for (const d of layout.districts) {
    const c = (d.rect.x + d.rect.w / 2 - x) ** 2 + (d.rect.y + d.rect.h / 2 - y) ** 2;
    if (inRect(d.rect, x, y)) return d.id === 'midtown' ? 'office-front' : d.id;
    if (c < bd) { bd = c; best = d.id; }
  }
  return best === 'midtown' ? 'office-front' : best;
}

function contextOf(resident, { layout, clock, peers }) {
  const kind = resident.activity?.kind
    ?? ((resident.motion?.path?.length ?? 0) > (resident.motion?.pathIndex ?? 0) ? 'walking' : null);
  const activity = ACT[kind]?.[0] ?? null;
  const f = clock?.dayFraction;
  return {
    placeKind: placeKindOf(resident, layout),
    timeOfDay: typeof f === 'number' ? HOURS.find(([edge]) => f < edge)[1] : null,
    activity,
    nearbyPeople: peers ? nearbyOf(resident, peers).length : 0
  };
}

function nearbyOf(resident, peers) {
  const { x, y } = resident.motion;
  return peers.filter(o => o.id !== resident.id && o.motion && Math.hypot(o.motion.x - x, o.motion.y - y) <= NEARBY);
}

// Two degraded reads of the same printed text agree wherever both are legible. Nothing here
// touches brandId or town.trends — a bystander's patch is read exactly as the camera reads ours.
function maskedEqual(a, b) {
  if (a.length !== b.length) return false;
  let both = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === ' ' || b[i] === ' ') continue;
    if (a[i] !== b[i]) return false;
    both++;
  }
  return both >= 2;
}

const looksAlike = (observed, g) =>
  colorScore(observed.colorHex, g.colors.base) >= LOOKALIKE && BY_WORDS.get(observed.silhouette)?.family === SIL[g.silhouette][1];

function crowdOf(resident, garments, peers) {
  const mine = garments.filter(g => g.patchText);
  let sameBrandTextNearby = 0, similarLookNearby = 0;
  for (const o of nearbyOf(resident, peers)) {
    let text = false, look = false;
    for (const slot of SLOTS) {
      const id = o.outfit?.[slot];
      if (!id) continue;
      const g = garment(id);
      if (!text && mine.length) {
        const t = readPatch(o, g, 'front').text;
        if (t && mine.some(m => maskedEqual(m.patchText, t))) text = true;
      }
      if (!look && garments.some(m => m.slot === slot && looksAlike(m, g))) look = true;
    }
    if (text) sameBrandTextNearby++;
    if (look) similarLookNearby++;
  }
  return { sameBrandTextNearby, similarLookNearby };
}

export function observableOf(resident, opts = {}) {
  const view = opts.view ?? 'front';
  const town = opts.town ?? null;
  const layout = opts.layout ?? town?.layout ?? null;
  const peers = opts.residents ?? town?.residents ?? null;
  const garments = [];
  for (const slot of SLOTS) {
    const id = resident.outfit?.[slot];
    if (!id) continue;
    const g = garment(id), { text, legibility } = readPatch(resident, g, view);
    garments.push({
      slot, silhouette: SIL[g.silhouette][0], colorName: g.colorName, colorHex: g.colors.base,
      pattern: g.patternWords, surfaceCue: g.surfaceCue, coverage: COVERAGE[slot],
      patchText: text, patchLegibility: legibility, materialGuess: null
    });
  }
  const context = contextOf(resident, { layout, clock: opts.clock ?? null, peers });
  const notes = [];
  if (view !== 'front') notes.push(`${view} view: part of the body is turned away from the camera`);
  const dark = garments.filter(g => g.patchText === null).map(g => g.slot);
  if (dark.length) notes.push(`brand text on the ${dark.join(', ')} is not legible from this view`);
  if (resident.outfit?.outer) notes.push('an outer layer covers part of the top');
  return { view, locator: locatorFor(resident, context), garments, notes, context, crowd: peers ? crowdOf(resident, garments, peers) : null };
}

// Weighted RGB distance (2R, 4G, 3B) normalised by its own maximum of 3*255. Cheap, ordered
// like CIE distance for these palettes, and it has no dependency.
function colorScore(a, b) {
  const px = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = px(a), [r2, g2, b2] = px(b);
  return clamp01(1 - Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2) / 765);
}
const silScore = (words, id) => {
  const m = BY_WORDS.get(words);
  return !m ? 0 : m.id === id ? 1 : m.family === SIL[id][1] ? 0.5 : 0;
};
const STOP = new Set(['and', 'the', 'with']);
const tokens = s => new Set(String(s).toLowerCase().match(/[a-z]+/g)?.filter(t => t.length > 2 && !STOP.has(t)) ?? []);
function tokenOverlap(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(A.size, B.size);
}
const normText = s => String(s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ');
// The observed string is a masked copy of the printed one, so position-wise agreement over the
// characters that survived is the honest measure; the length gap penalises a different word.
function patchSimilarity(observed, candidate) {
  if (!observed || !candidate) return 0;
  const a = normText(observed), b = normText(candidate), n = Math.max(a.length, b.length);
  let seen = 0, hit = 0;
  for (let i = 0; i < n; i++) {
    const ca = a[i] ?? '';
    if (ca === ' ' || ca === '') continue;
    seen++;
    if (ca === (b[i] ?? '')) hit++;
  }
  return seen ? hit / seen * (1 - Math.abs(a.length - b.length) / n) : 0;
}

export function matchCatalog(observation, opts = {}) {
  const catalog = opts.catalog ?? GARMENTS, limit = opts.limit ?? 3;
  return observation.garments.map(o => {
    const scored = [];
    for (const g of catalog) {
      if (g.slot !== o.slot) continue;
      const c = colorScore(o.colorHex, g.colors.base), s = silScore(o.silhouette, g.silhouette);
      const p = tokenOverlap(o.pattern, g.patternWords), t = patchSimilarity(o.patchText, g.patch?.text);
      const matchedOn = [];
      if (c >= 0.9) matchedOn.push('colour');
      if (s === 1) matchedOn.push('silhouette');
      if (p >= 0.6) matchedOn.push('pattern');
      if (t >= 0.6) matchedOn.push('patch text');
      scored.push({ garmentId: g.id, brandId: g.brandId, label: g.name, score: round(0.40 * c + 0.25 * s + 0.20 * p + 0.15 * t), matchedOn });
    }
    scored.sort((a, b) => b.score - a.score || (a.garmentId < b.garmentId ? -1 : 1));
    return { slot: o.slot, matches: scored.slice(0, limit) };
  });
}

export function brandCandidates(observation) {
  const read = observation.garments.filter(g => g.patchText);
  const out = [];
  for (const b of BRANDS) {
    let best = null;
    for (const g of read) for (const a of [b.patchText, ...b.aliases]) {
      const score = patchSimilarity(g.patchText, a);
      if (!best || score > best.score || (score === best.score && g.patchLegibility > best.legibility)) best = { score, legibility: g.patchLegibility };
    }
    if (!best || best.score < 0.4) continue;
    const i = b.investigation;
    out.push({
      brandId: b.id, label: b.label, score: round(best.score), legibility: best.legibility, matchedOn: 'patch-text',
      investigation: { status: i.status, band: i.band, investigatedAt: i.investigatedAt, evidenceAgeDays: null }
    });
  }
  // Equal similarity is common: three brands on one body can all read perfectly. The clearest-read
  // patch goes first, because that is the one worth spending an investigation budget on.
  return out.sort((a, b) => b.score - a.score || b.legibility - a.legibility || (a.brandId < b.brandId ? -1 : 1));
}

const LEDGER_KNOWN = ['visible silhouettes', 'visible colours', 'visible patterns', 'readable brand text'];
const LEDGER_UNKNOWN = ['fibre composition', 'country of origin', 'factory', 'wages', 'carbon', 'water', 'textile waste', 'brand claim risk'];

export function omniBrief(resident, ctx = {}) {
  const view = ctx.view ?? 'front';
  const observation = observableOf(resident, { view, town: ctx.town, clock: ctx.clock, residents: ctx.residents });
  const brands = brandCandidates(observation);
  const catalogCandidates = matchCatalog(observation);
  const top = catalogCandidates.find(c => c.matches.length)?.matches[0] ?? null;
  const topGarment = top ? GARMENTS.find(g => g.id === top.garmentId) : null;
  const crowd = observation.crowd;
  const loudest = observation.garments.filter(g => g.patchText)
    .sort((a, b) => b.patchLegibility - a.patchLegibility)[0] ?? null;
  const pending = brands[0] && brands[0].investigation.status === 'pending';
  const actions = [
    { id: 'research_brand', available: !!pending, args: pending ? { brandId: brands[0].brandId } : null, needs: ['browserbase', 'omni'],
      reason: brands.length ? `top candidate has investigation.status = ${brands[0].investigation.status}` : 'no brand text was legible on this person' },
    { id: 'research_trend', available: !!(crowd && crowd.sameBrandTextNearby >= 2 && loudest), args: loudest ? { patchText: loudest.patchText, nearbyCount: crowd?.sameBrandTextNearby ?? 0 } : null, needs: ['browserbase', 'omni'],
      reason: crowd && crowd.sameBrandTextNearby >= 2 ? 'the same brand text is visible on several people here' : 'the same brand text is not visible on anyone else nearby' },
    { id: 'match_garment', available: observation.garments.length > 0, args: observation.garments.length ? { slot: observation.garments[0].slot } : null, needs: [],
      reason: 'local matcher only; hybrid search not connected' },
    { id: 'read_passport', available: !!topGarment?.passport.published, args: topGarment ? { garmentId: topGarment.id } : null, needs: [],
      reason: topGarment ? (topGarment.passport.published ? 'top match publishes a product passport' : 'top match has no published passport') : 'nothing matched' },
    { id: 'ask_resident', available: false, args: null, needs: ['omni'], reason: 'conversation pipeline not connected' },
    { id: 'compare_alternatives', available: !!top, args: top ? { slot: catalogCandidates.find(c => c.matches.length).slot, maxPrice: null } : null, needs: [],
      reason: 'price is not observable, so alternatives are unbounded until a budget is given' },
    { id: 'add_to_cart', available: !!topGarment?.shopifyVariantId, args: topGarment ? { garmentId: topGarment.id } : null, needs: ['shopify'],
      reason: topGarment?.shopifyVariantId ? 'top match has a variant' : 'garment has no shopifyVariantId' }
  ];
  return {
    observation, brandCandidates: brands, catalogCandidates,
    ledger: {
      known: LEDGER_KNOWN.slice(), unknown: LEDGER_UNKNOWN.slice(),
      why: {
        'brand claim risk': brands.length ? 'no investigation on record for any candidate brand' : 'no brand text was legible, so there is no candidate to investigate',
        'fibre composition': 'the scan never supplies composition; the model must guess it',
        carbon: 'footprint factor table is unsourced'
      }
    },
    actions,
    budget: { maxPages: 12, maxBrowserSeconds: 90, maxModelCalls: 2 },
    // Keyed on appearance only: a re-scan of the same person in the same clothes is a cache hit
    // even if the street around them has changed.
    cacheKey: `${view}:${hash32(JSON.stringify(observation.garments)).toString(16)}`
  };
}

export function groundTruthOf(resident, town = null) {
  const outfit = {}, items = [];
  for (const slot of SLOTS) {
    const id = resident.outfit?.[slot];
    if (!id) continue;
    const g = garment(id);
    outfit[slot] = id;
    items.push({ slot, garmentId: id, brandId: g.brandId, name: g.name, price: g.price });
  }
  const aware = resident.social?.awareness ?? {};
  return {
    residentId: resident.id, name: resident.name, personaId: resident.personaId, roleId: resident.roleId,
    activity: resident.activity?.kind ?? null, outfit, garments: items,
    trendExposure: round(items.reduce((s, i) => s + (aware[i.brandId] ?? 0) + (town?.trends?.[i.brandId] ?? 0), 0))
  };
}

export function gradeMatch(observation, matches, truth) {
  const rows = observation.garments.map(o => {
    const ids = (matches.find(m => m.slot === o.slot)?.matches ?? []).map(x => x.garmentId);
    const expected = truth.outfit[o.slot] ?? null;
    return { slot: o.slot, expected, got: ids[0] ?? null, top1: ids[0] === expected, top3: ids.includes(expected) };
  });
  return { rows, total: rows.length, top1: rows.filter(r => r.top1).length, top3: rows.filter(r => r.top3).length };
}

const PRIVATE_KEYS = new Set(['personaId', 'roleId', 'wardrobe', 'wallet', 'history', 'homeId', 'body', 'motion',
  'stats', 'residentId', 'residentName', 'needBias', 'social', 'wishlist', 'workplace', 'favouriteBrandId',
  'brandIds', 'skin', 'hair', 'follows', 'awareness', 'colleagues', 'neighbours', 'outfits', 'trendExposure', 'posterId', 'name']);
const RESIDENT_ID = /^r\d{2}$/;
const CACHE = new WeakMap();

function forbidden(town) {
  if (town && CACHE.has(town)) return CACHE.get(town);
  const residentStrings = new Set(PERSONAS.flatMap(p => [p.id, p.label]));
  for (const r of town?.residents ?? []) {
    residentStrings.add(r.id); residentStrings.add(r.name);
    residentStrings.add(r.body.skin); residentStrings.add(r.body.hair.color);
  }
  const catalogStrings = new Set(GARMENTS.flatMap(g => [g.id, g.name]).concat(BRANDS.flatMap(b => [b.id, b.label])));
  const sets = { residentStrings, catalogStrings };
  if (town) CACHE.set(town, sets);
  return sets;
}

// Strict everywhere except the top-level branches in `allow`: those are the app's own retrieval
// results (brand/garment ids are the ANSWER, not the input), and still may not carry anything
// private to the resident.
export function assertNoGroundTruth(payload, town = null, opts = {}) {
  const allow = new Set(opts.allow ?? ['brandCandidates', 'catalogCandidates', 'actions']);
  const { residentStrings, catalogStrings } = forbidden(town);
  const fail = m => { throw new Error(`Ground-truth leak: ${m}`); };
  const visit = (v, path, lenient) => {
    if (Array.isArray(v)) { for (const x of v) visit(x, path, lenient); return; }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (PRIVATE_KEYS.has(k)) fail(`private key "${k}" at ${path || '<root>'}`);
        visit(val, path ? `${path}.${k}` : k, lenient || (!path && allow.has(k)));
      }
      return;
    }
    if (typeof v !== 'string') return;
    if (path.endsWith('patchText')) return;   // text printed on a garment is what the camera reads
    if (residentStrings.has(v) || RESIDENT_ID.test(v)) fail(`resident-private value ${JSON.stringify(v)} at ${path}`);
    if (!lenient && catalogStrings.has(v)) fail(`catalog identifier ${JSON.stringify(v)} at ${path}`);
  };
  visit(payload, '', false);
  return true;
}
