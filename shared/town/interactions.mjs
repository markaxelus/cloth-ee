import { rngInt, rngWeighted } from './rng.mjs';
import { SLOTS, brand, garment, persona, role } from './data.mjs';
import { needFor, setContext } from './residents.mjs';

export const INTERACTION_KINDS = ['sit', 'coffee', 'browse', 'photo', 'work', 'workout', 'read', 'wait', 'gather', 'dispose', 'resell', 'chat'];

const AMBIENT = new Set(['sit', 'read', 'gather', 'wait']);
const SECONDS = { sit: [12, 30], coffee: [20, 40], browse: [10, 22], photo: [8, 18], read: [15, 35], workout: [30, 60], chat: [6, 16], wait: [4, 12], gather: [10, 26], dispose: [5, 10], resell: [5, 10], work: [45, 90] };
// 'chat' affords nothing on its own: it is standing somewhere people stand, waiting for pairUp.
const CHAT_AFFORDS = ['gather', 'sit', 'coffee', 'wait'];
const VENUE_PULL = 1.5;
const DISCARD_PULL = 1.2;
const AWARE_CAP = 2;
const FOLLOW_AWARE = 0.5;
const VERB = { bin: 'binned', donate: 'donated', resell: 'listed' };

export function createWorld(layout) {
  const sites = layout.sites.map(s => ({ ...s }));
  const siteById = new Map(sites.map(s => [s.id, s]));
  const byKind = new Map();
  for (const s of sites) for (const a of s.affords) (byKind.get(a) ?? byKind.set(a, []).get(a)).push(s);
  for (const list of byKind.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));
  const brandsByBuilding = new Map(layout.shops.map(s => [s.buildingId, s.brandIds]));
  const held = new Map(sites.map(s => [s.id, new Set()]));
  const world = {
    sites, siteById,
    byAfford: kind => byKind.get(kind) ?? [],
    occupancy: id => held.get(id)?.size ?? 0,
    claim(id, residentId) {
      const set = held.get(id), s = siteById.get(id);
      if (!set || set.has(residentId)) return !!set;
      if (set.size >= s.capacity) return false;
      set.add(residentId);
      return true;
    },
    release(id, residentId) { held.get(id)?.delete(residentId); },
    // Ties break on site id so the same tick always picks the same bench.
    nearestSite(afford, x, y, opts = {}) {
      let best = null, bd = Infinity;
      for (const s of world.byAfford(afford)) {
        if (opts.exclude === s.id) continue;
        if (opts.free !== false && world.occupancy(s.id) >= s.capacity) continue;
        const d = (s.x - x) ** 2 + (s.y - y) ** 2;
        if (d < bd || (d === bd && best && s.id < best.id)) { bd = d; best = s; }
      }
      return best;
    },
    brandsAt: siteId => brandsByBuilding.get(siteById.get(siteId)?.buildingId) ?? [],
    reset() { for (const set of held.values()) set.clear(); }
  };
  return world;
}

// `w.dropped` is D's hook for B4: a trend that died marks the garment, and it leaves here as a
// premature discard rather than waiting to wear out.
const wornOut = (w, p) => w.dropped === true || w.wears >= garment(w.garmentId).durability.baseWears * p.wearOutMultiplier;

const duration = (rng, kind, ctx) =>
  kind === 'work' && ctx.workSeconds > 0 ? ctx.workSeconds : rngInt(rng, ...SECONDS[kind]);

function siteFor(world, kind, resident) {
  const { x, y } = resident.motion;
  if (kind === 'work') {
    const s = resident.workplace.siteId ? world.siteById.get(resident.workplace.siteId) : null;
    return s && world.occupancy(s.id) < s.capacity ? s : null;
  }
  if (kind !== 'chat') return world.nearestSite(kind, x, y);
  let best = null, bd = Infinity;
  for (const a of CHAT_AFFORDS) {
    const s = world.nearestSite(a, x, y);
    if (!s) continue;
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bd || (d === bd && best && s.id < best.id)) { bd = d; best = s; }
  }
  return best;
}

// The returned site is ALREADY claimed for this resident — that is what makes capacity real
// across a tick. Release it when the interaction ends, or immediately if you drop the choice.
export function chooseInteraction(resident, world, ctx) {
  const p = persona(resident.personaId);
  const weights = { ...role(resident.roleId).interactions };
  if (INTERACTION_KINDS.includes(ctx.venue)) weights[ctx.venue] = (weights[ctx.venue] ?? 0) + VENUE_PULL;
  // No role carries a dispose/resell weight, so the lifecycle has to pull them in: a resident
  // holding a dead garment heads for the bin or the kiosk, split by their persona's routes.
  if (resident.wardrobe.some(w => w.retiredDay === null && wornOut(w, p))) {
    weights.resell = (weights.resell ?? 0) + DISCARD_PULL * p.disposal.resell;
    weights.dispose = (weights.dispose ?? 0) + DISCARD_PULL * (p.disposal.bin + p.disposal.donate);
  }
  const { x, y } = resident.motion;
  const entries = [];
  for (const kind of INTERACTION_KINDS) {
    if (!(weights[kind] > 0)) continue;
    const site = siteFor(world, kind, resident);
    if (site) entries.push({ value: { kind, site }, weight: weights[kind] / (1 + Math.hypot(site.x - x, site.y - y) / 12) });
  }
  if (!entries.length) {
    const queue = world.nearestSite('wait', x, y);
    if (!queue || !world.claim(queue.id, resident.id)) return null;
    return { kind: 'wait', site: queue, seconds: duration(ctx.rng, 'wait', ctx) };
  }
  const { kind, site } = rngWeighted(ctx.rng, entries);
  if (!world.claim(site.id, resident.id)) return null;
  return { kind, site, seconds: duration(ctx.rng, kind, ctx) };
}

const wornItems = r => SLOTS.map(slot => {
  const id = r.outfit[slot];
  const w = id ? r.wardrobe.find(x => x.garmentId === id && x.retiredDay === null) : null;
  return w ? { slot, w, g: garment(id) } : null;
}).filter(Boolean);

const event = (r, type, ctx, extra) => ({
  type, day: ctx.day, seconds: ctx.seconds, residentId: r.id, residentName: r.name,
  personaId: r.personaId, roleId: r.roleId, garmentId: null, brandId: null, slot: null,
  price: null, route: null, ambient: AMBIENT.has(type), text: '', ...extra
});

const placeOf = site => (site.label ? `at ${site.label}` : `by the ${site.kind}`);

const AMBIENT_TEXT = { read: 'read the paper', sit: 'sat down', gather: 'stood with the crowd', wait: 'waited' };

const weakestSlot = (r, day) => SLOTS.reduce((a, b) => (needFor(r, b, day) > needFor(r, a, day) ? b : a));

function discardAt(resident, site, ctx, push, kind) {
  const p = persona(resident.personaId);
  const routes = kind === 'resell' ? ['resell'] : ['donate', 'bin'];
  const due = resident.wardrobe.filter(w => w.retiredDay === null && wornOut(w, p)).slice(0, 2);
  for (const w of due) {
    const g = garment(w.garmentId);
    const route = routes.length === 1 ? routes[0] : rngWeighted(ctx.rng, routes.map(r => ({ value: r, weight: p.disposal[r] })));
    const remaining = Math.max(0, Math.round(g.durability.baseWears * p.wearOutMultiplier - w.wears));
    w.retiredDay = ctx.day;
    resident.stats[route === 'bin' ? 'binned' : route === 'resell' ? 'resold' : 'donated'] += 1;
    resident.history.push({ day: ctx.day, type: 'discard', garmentId: w.garmentId, route });
    if (route === 'resell') (ctx.town.resale ??= []).push({ garmentId: w.garmentId, price: Math.round(g.price * 0.4), condition: remaining > 0 ? 'good' : 'worn', listedDay: ctx.day });
    push('discard', {
      garmentId: w.garmentId, brandId: g.brandId, slot: w.slot, route, massKg: g.massKg,
      premature: remaining > 0, wearsRemaining: remaining, attributedTo: w.attributedTo ?? null,
      text: `${resident.name} ${VERB[route]} a ${g.name.toLowerCase()} ${placeOf(site)}`
    });
  }
  if (due.length) setContext(resident, resident.context);
}

// Broadcast, not conversation: no proximity, every follower at once, and the impulse decays.
function post(resident, site, ctx, push) {
  const r = role(resident.roleId), items = wornItems(resident);
  if (!r.followable || !items.length) return push('photo', { ambient: true, text: `${resident.name} took a photo ${placeOf(site)}` });
  const town = ctx.town;
  town.trends ??= {}; town.trendPosters ??= {};
  const brandIds = [...new Set(items.map(i => i.g.brandId))];
  for (const b of brandIds) { town.trends[b] = (town.trends[b] ?? 0) + r.socialReach; town.trendPosters[b] = resident.id; }
  const followers = (ctx.residents ?? []).filter(o => o.social.follows.includes(resident.id));
  for (const f of followers) for (const b of brandIds) f.social.awareness[b] = Math.min(AWARE_CAP, (f.social.awareness[b] ?? 0) + r.socialReach * FOLLOW_AWARE);
  resident.wallet += r.socialReach * 22;
  push('post', {
    postId: `post-${resident.id}-${ctx.day}-${Math.round(ctx.seconds)}`,
    brandId: brandIds[0], brandIds, reach: followers.length, garmentId: items[0].g.id,
    text: `${resident.name} posted ${placeOf(site)} wearing ${brand(brandIds[0]).label}`
  });
}

const EFFECTS = {
  coffee(r, site, ctx, push) {
    const cost = rngInt(ctx.rng, 4, 7);
    r.wallet = Math.max(0, r.wallet - cost);
    r.stats.spend += cost;
    push('coffee', { price: cost, text: `${r.name} bought a coffee ${placeOf(site)}` });
  },
  browse(r, site, ctx, push) {
    const brandIds = ctx.world ? ctx.world.brandsAt(site.id) : [];
    for (const b of brandIds) r.wishlist[b] = Math.min(3, (r.wishlist[b] ?? 0) + 0.35);
    const slot = weakestSlot(r, ctx.day);
    r.needBias[slot] = Math.min(0.4, (r.needBias[slot] ?? 0) + 0.08);
    push('browse', { slot, brandId: brandIds[0] ?? null, text: `${r.name} looked into the window ${placeOf(site)}` });
  },
  photo: post,
  workout(r, site, ctx, push) {
    for (const { w, g } of wornItems(r)) if (g.styleTags.includes('sporty') || g.styleTags.includes('technical')) w.wears += 1;
    push('workout', { text: `${r.name} trained ${placeOf(site)}` });
  },
  // No event: a shift is bracketed by simulation's own shift-start/shift-end.
  work(r) {
    r.wallet += persona(r.personaId).incomePerDay / 3;
    for (const { w } of wornItems(r)) w.wears += 1;
  },
  dispose: discardAt,
  resell: discardAt,
  chat(r, site, ctx, push) {
    if (!r.activity?.partnerId) push('chat', { ambient: true, text: `${r.name} waited for company ${placeOf(site)}` });
  }
};

export function applyInteraction(resident, interaction, ctx) {
  const { kind, site } = interaction, out = [];
  const push = (type, extra) => out.push(event(resident, type, ctx, extra));
  if (EFFECTS[kind]) EFFECTS[kind](resident, site, ctx, push, kind);
  else push(kind, { text: `${resident.name} ${AMBIENT_TEXT[kind]} ${placeOf(site)}` });
  return out;
}

export function pairUp(residents, world, ctx) {
  const bySite = new Map();
  for (const r of residents) {
    const id = r.activity?.siteId;
    if (!id || !r.activity.kind || r.activity.partnerId) continue;
    (bySite.get(id) ?? bySite.set(id, []).get(id)).push(r);
  }
  const pairs = [], taken = new Set();
  for (const siteId of [...bySite.keys()].sort()) {
    const here = bySite.get(siteId).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (let i = 0; i < here.length; i++) {
      if (taken.has(here[i].id)) continue;
      for (let j = i + 1; j < here.length; j++) {
        if (taken.has(here[j].id)) continue;
        const ra = role(here[i].roleId).socialReach, rb = role(here[j].roleId).socialReach;
        const chatty = (here[i].activity.kind === 'chat') + (here[j].activity.kind === 'chat');
        if (ctx.rng() < Math.min(0.95, (0.1 + 0.7 * Math.sqrt(ra * rb)) * (1 + 0.5 * chatty))) {
          pairs.push([here[i], here[j], world.siteById.get(siteId)]);
          taken.add(here[i].id); taken.add(here[j].id);
          break;
        }
      }
    }
  }
  return pairs;
}

export function applySocial(a, b, site, ctx) {
  const transfer = (from, to) => {
    const reach = role(from.roleId).socialReach;
    for (const { g } of wornItems(from)) to.social.awareness[g.brandId] = Math.min(AWARE_CAP, (to.social.awareness[g.brandId] ?? 0) + reach);
  };
  transfer(a, b);
  transfer(b, a);
  return [event(a, 'chat', ctx, { partnerId: b.id, text: `${a.name} and ${b.name} talked ${placeOf(site)}` })];
}
