import { hash32, makeRng, rngWeighted } from './rng.mjs';
import { BRANDS, GARMENTS, REQUIRED_SLOTS, SLOTS, brand, footprintOf, garment, persona, role } from './data.mjs';
import { needFor, priceFor, setContext, trendSensitivity, utility } from './residents.mjs';
import { applyInteraction, applySocial, chooseInteraction, createWorld, pairUp } from './interactions.mjs';
import { buildRouter } from './layout.mjs';

export const DAY_SECONDS = 180;
export const WALK_SPEED = 3.2;

const TICK = 1 / 15;
const PAIR_PERIOD = 2;
const EVENT_CAP = 400;
const TREND_DECAY = 0.35;
const TREND_FLOOR = 0.01;
const CASCADE_MIN = 0.8;        // trend at which a purchase counts as trend-driven
const DUPE_TREND = 0.9;
const DUPE_SHARE = 0.6;
const TREND_CAP = 2;            // a trend is a spike, not a licence to swamp every other term
const SURCHARGE_FROM = 1.2, SURCHARGE_MAX = 0.25;
const SECOND_WAVE = 0.25;
const RESALE_CEILING = 130;     // spendBias-adjusted ceiling below which the kiosk comes first
const PATCH_WEIGHT = { small: 0.55, medium: 0.75, large: 0.9 };
// Roles whose day has no 'work' venue still earn: the courier delivers all day, the retiree
// has a pension, the influencer's posts pay on top of this.
const BASELINE_INCOME = { retiree: 0.9, courier: 0.8, influencer: 0.25 };

// Luma-weighted RGB, the same cheap distance omni.mjs uses to match a colour by eye.
function lookDistance(a, b) {
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = rgb(a.colors.base), [br, bg, bb] = rgb(b.colors.base);
  return Math.sqrt(0.3 * (ar - br) ** 2 + 0.59 * (ag - bg) ** 2 + 0.11 * (ab - bb) ** 2) / 255
    + (a.silhouette === b.silhouette ? 0 : 0.5);
}

export function createSimulation({ town, seed = town.seed, speed = 1 }) {
  const rng = makeRng(`${seed}:sim`);
  const { layout } = town;
  const router = town.router ?? buildRouter(layout);
  const world = createWorld(layout);
  const residents = town.residents;
  const catalog = town.garments ?? GARMENTS;
  const catalogById = new Map(catalog.map(g => [g.id, g]));
  const gOf = id => catalogById.get(id) ?? garment(id);
  const residentById = new Map(residents.map(r => [r.id, r]));
  const doorOf = new Map(layout.buildings.map(b => [b.id, b.doorNodeId]));
  const homeDoor = new Map(residents.map(r => [r.id, doorOf.get(r.homeId)]));
  const kiosk = world.byAfford('resell')[0] ?? null;

  town.trends ??= {}; town.trendPosters ??= {}; town.resale ??= [];
  town.dupes = {}; town.stock = {};
  const stockCap = new Map();
  for (const g of catalog) {
    const n = 6 + Math.floor(rng() * 7);
    town.stock[g.id] = n; stockCap.set(g.id, n);
  }

  const clock = { seconds: 0, day: 0, dayFraction: 0 };
  const events = [];
  const listeners = new Set();
  const intents = new Map();
  const away = new Set();
  const shopDay = new Map();
  const edges = new Map(residents.map(r => [r.id, new Float64Array(role(r.roleId).schedule.length + 1)]));
  const cascades = new Map();        // `${postId}:${brandId}` -> record; one post can carry several
  const cascadeByBrand = new Map();  // brandId -> the post currently driving it
  const brandBought = {};
  const postsByRole = {};
  const cum = { bought: 0, discarded: 0, spend: 0, byRoute: { resell: 0, donate: 0, bin: 0 } };
  const reach = { posts: 0, postReach: 0, chats: 0, chatReach: 0, cascadeBuys: 0, disclosedBuys: 0 };
  let nextId = 1, drained = 0, pairClock = 0, carry = 0;

  const ctx = { rng, day: 0, seconds: 0, town, world, residents, venue: null, workSeconds: 0 };

  function emit(e) {
    e.id = nextId++;
    events.push(e);
    if (events.length > EVENT_CAP) events.shift();
    for (const fn of listeners) fn(e);
    return e;
  }
  const mkEvent = (r, type, extra) => ({
    id: 0, type, day: clock.day, seconds: clock.seconds, residentId: r.id, residentName: r.name,
    personaId: r.personaId, roleId: r.roleId, garmentId: null, brandId: null, slot: null,
    price: null, route: null, ambient: false, text: '', ...extra
  });

  function rejitter(r, day) {
    const ro = role(r.roleId), sch = ro.schedule, e = edges.get(r.id);
    const amp = (1 - ro.punctuality) * 0.06;
    e[0] = 0; e[sch.length] = 1;
    // Clamped against the NEXT unjittered edge, so a sloppy role can drift but never invert.
    for (let i = 1; i < sch.length; i++) {
      const j = (hash32(`${r.id}:${day}:${i}`) / 4294967296 - 0.5) * 2 * amp;
      const lo = e[i - 1] + 0.01, hi = Math.max(lo, (sch[i + 1]?.from ?? 1) - 0.01);
      e[i] = Math.min(Math.max(sch[i].from + j, lo), hi);
    }
  }
  for (const r of residents) rejitter(r, 0);

  const wornEntries = (r, fn) => {
    for (const slot of SLOTS) {
      const id = r.outfit[slot];
      if (!id) continue;
      const w = r.wardrobe.find(x => x.garmentId === id && x.retiredDay === null);
      if (w) fn(w, gOf(id), slot);
    }
  };

  function startTrip(r, nodeId, intent) {
    const m = r.motion;
    intents.set(r.id, intent);
    if (m.nodeId === nodeId) { m.path.length = 0; arrive(r); return; }
    m.path = router.path(m.nodeId, nodeId);
    m.pathIndex = 1;
    m.destinationId = nodeId;
    m.activity = intent.kind === 'shop' || intent.kind === 'resale' ? 'shopping' : 'walking';
    if (nodeId !== homeDoor.get(r.id)) away.add(r.id);
  }

  function advance(r) {
    const m = r.motion;
    let budget = WALK_SPEED * m.speed * TICK;
    while (budget > 0 && m.pathIndex < m.path.length) {
      const n = router.node(m.path[m.pathIndex]);
      const dx = n.x - m.x, dy = n.y - m.y, d = Math.hypot(dx, dy);
      if (d <= budget) { m.x = n.x; m.y = n.y; m.nodeId = n.id; m.pathIndex++; budget -= d; }
      else { m.heading = Math.atan2(dy, dx); m.x += dx / d * budget; m.y += dy / d * budget; budget = 0; }
    }
    if (m.pathIndex >= m.path.length) { m.path.length = 0; m.destinationId = null; arrive(r); }
  }

  function arrive(r) {
    const intent = intents.get(r.id);
    intents.delete(r.id);
    if (!intent) { r.motion.activity = 'idle'; return; }
    if (intent.kind === 'home') { homeArrival(r); return; }
    if (intent.kind === 'shop') { shopVisit(r, intent.shop); return; }
    if (intent.kind === 'resale') { resaleVisit(r); return; }
    const c = intent.choice;
    r.activity.kind = c.kind;
    r.activity.siteId = c.site.id;
    r.activity.until = intent.until ?? clock.seconds + c.seconds;
    if (r.activity.until <= clock.seconds) r.activity.until = clock.seconds + 1;
    r.motion.activity = c.kind === 'work' ? 'working' : 'interacting';
    if (c.kind === 'work' && r.workplace.buildingId) {
      emit(mkEvent(r, 'shift-start', { ambient: true, text: `${r.name} started a shift at ${c.site.label ?? 'work'}` }));
    }
  }

  function finish(r) {
    const a = r.activity, site = world.siteById.get(a.siteId);
    for (const e of applyInteraction(r, { kind: a.kind, site }, ctx)) {
      if (e.type === 'post') onPost(r, e);
      if (e.type === 'discard') onDiscard(e);
      emit(e);
    }
    if (a.kind === 'work' && r.workplace.buildingId) {
      emit(mkEvent(r, 'shift-end', { ambient: true, text: `${r.name} finished at ${site?.label ?? 'work'}` }));
    }
    world.release(a.siteId, r.id);
    a.kind = null; a.siteId = null; a.until = 0; a.partnerId = null;
    r.motion.activity = 'idle';
    r.motion.waitUntil = clock.seconds;
  }

  function homeArrival(r) {
    const m = r.motion;
    m.activity = 'idle';
    if (away.delete(r.id)) {
      let top = null;
      wornEntries(r, (w, g) => { w.wears += 1; top ??= g; });
      if (top) emit(mkEvent(r, 'wear', { ambient: true, garmentId: top.id, brandId: top.brandId, slot: top.slot, text: `${r.name} wore a ${top.name.toLowerCase()} all day` }));
    }
  }

  function decide(r) {
    const m = r.motion, ro = role(r.roleId), sch = ro.schedule, e = edges.get(r.id);
    let i = 0;
    while (i < sch.length - 1 && clock.dayFraction >= e[i + 1]) i++;
    const block = sch[i];
    const endsAt = (clock.day + e[i + 1]) * DAY_SECONDS;
    if (block.activity === 'home') {
      const door = homeDoor.get(r.id);
      if (m.nodeId === door) { m.waitUntil = Math.max(clock.seconds + TICK, endsAt); homeArrival(r); }
      else { startTrip(r, door, { kind: 'home' }); emit(mkEvent(r, 'commute', { ambient: true, text: `${r.name} headed home` })); }
      return;
    }
    if (block.venue === 'work' && r.workplace.siteId) {
      const site = world.siteById.get(r.workplace.siteId);
      if (site && world.claim(site.id, r.id)) {
        startTrip(r, site.nodeId, { kind: 'interaction', choice: { kind: 'work', site }, until: endsAt });
        emit(mkEvent(r, 'commute', { ambient: true, text: `${r.name} set off for ${site.label ?? 'work'}` }));
        return;
      }
    }
    if (shopUrge(r)) return;
    ctx.venue = block.venue ?? null;
    ctx.workSeconds = Math.max(TICK, endsAt - clock.seconds);
    const choice = chooseInteraction(r, world, ctx);
    if (!choice) { m.waitUntil = clock.seconds + 2; return; }
    startTrip(r, choice.site.nodeId, { kind: 'interaction', choice });
  }

  function shopUrge(r) {
    if (shopDay.get(r.id) === clock.day) return false;
    const p = persona(r.personaId), ro = role(r.roleId);
    let need = 0, spare = 0, wish = 0;
    // An empty optional slot reads as need 1, which would send everyone shopping every hour.
    // Only a worn-out or missing REQUIRED slot counts at full weight.
    for (const slot of SLOTS) {
      const n = needFor(r, slot, clock.day);
      if (REQUIRED_SLOTS.includes(slot)) { if (n > need) need = n; }
      else if (n > spare) spare = n;
    }
    need = Math.max(need, 0.35 * spare);
    for (const b in r.wishlist) if (r.wishlist[b] > wish) wish = r.wishlist[b];
    let pull = 0;
    for (const b in town.trends) pull += Math.min(1, town.trends[b]) * trendSensitivity(r, town.trendPosters[b]);
    const chance = Math.min(0.85, p.shopInterest * (0.15 + 0.85 * need) + 0.1 * wish + 0.25 * pull);
    if (rng() >= chance) return false;
    shopDay.set(r.id, clock.day);
    const cheap = p.budget.ceiling * ro.spendBias <= RESALE_CEILING;
    if (kiosk && town.resale.length && cheap && rng() < 0.6) {
      startTrip(r, kiosk.nodeId, { kind: 'resale' });
      return true;
    }
    const shop = rngWeighted(rng, layout.shops.map(s => ({
      value: s, weight: 0.4 + s.brandIds.reduce((t, b) => t + (town.trends[b] ?? 0) + (r.wishlist[b] ?? 0), 0)
    })));
    startTrip(r, shop.doorNodeId, { kind: 'shop', shop });
    return true;
  }

  const owns = (r, id) => r.wardrobe.some(w => w.garmentId === id && w.retiredDay === null);

  // B1: a trending brand gets a demand surcharge of up to +25%, which fades as the trend does.
  function priceOf(g) {
    const t = town.trends[g.brandId] ?? 0;
    const sur = t > SURCHARGE_FROM ? Math.min(SURCHARGE_MAX, (t - SURCHARGE_FROM) / (TREND_CAP - SURCHARGE_FROM) * SURCHARGE_MAX) : 0;
    return Math.round(g.price * (1 + sur));
  }

  function shopVisit(r, shop) {
    emit(mkEvent(r, 'enter-shop', { ambient: true, text: `${r.name} went into ${shop.label}` }));
    let best = null, bestCost = 0, bestScore = 0;
    for (const g of catalog) {
      if (!shop.brandIds.includes(g.brandId) || town.stock[g.id] <= 0 || owns(r, g.id)) continue;
      const price = priceOf(g), cost = priceFor(r, g, { price });
      if (cost > r.wallet) continue;
      const s = utility(r, g, { day: clock.day, town, price });
      if (s > bestScore) { bestScore = s; best = g; bestCost = cost; }
    }
    if (best) buy(r, best, bestCost, 'shop', shop.label);
    emit(mkEvent(r, 'leave-shop', { ambient: true, text: `${r.name} left ${shop.label}` }));
    doneShopping(r);
  }

  const doneShopping = r => { r.motion.activity = 'idle'; r.motion.waitUntil = clock.seconds + 3; };

  // B5: the kiosk is stocked by everything anyone resold, at 40% of list.
  function resaleVisit(r) {
    let best = null, bestScore = 0;
    for (const listing of town.resale) {
      const g = gOf(listing.garmentId);
      if (!g || listing.price > r.wallet || owns(r, g.id)) continue;
      const s = utility(r, g, { day: clock.day, town, price: listing.price });
      if (s > bestScore) { bestScore = s; best = listing; }
    }
    if (best) {
      town.resale.splice(town.resale.indexOf(best), 1);
      const g = gOf(best.garmentId), p = persona(r.personaId);
      const used = Math.round(g.durability.baseWears * p.wearOutMultiplier * (best.condition === 'worn' ? 0.7 : 0.3));
      buy(r, g, best.price, 'resale', 'the Resale Kiosk', used);
    }
    doneShopping(r);
  }

  function buy(r, g, cost, route, where, startWears = 0) {
    const slot = g.slot, prev = r.outfit[slot] ?? null;
    const dupe = town.dupes[g.id] ?? null;
    const posterId = town.trendPosters[g.brandId] ?? null;
    const trending = (town.trends[g.brandId] ?? 0) >= CASCADE_MIN && posterId && posterId !== r.id;
    const rec = dupe ? cascades.get(dupe.key) : trending ? cascadeByBrand.get(g.brandId) : null;
    const attributedTo = rec && rec.posterId !== r.id
      ? { type: 'post', residentId: rec.posterId, day: clock.day, postId: rec.postId, brandId: rec.brandId } : null;
    r.wallet -= cost; r.stats.spend += cost; r.stats.bought += 1;
    cum.spend += cost; cum.bought += 1;
    brandBought[g.brandId] = (brandBought[g.brandId] ?? 0) + 1;
    if (route === 'shop') town.stock[g.id] -= 1;
    r.wardrobe.push({ garmentId: g.id, slot, acquiredDay: clock.day, wears: startWears, retiredDay: null, attributedTo, dupeOf: dupe?.dupeOf ?? null });
    r.history.push({ day: clock.day, type: 'buy', garmentId: g.id, price: cost, route });
    r.needBias[slot] = 0;
    r.wishlist[g.brandId] = 0;
    setContext(r, r.context);
    emit(mkEvent(r, 'buy', {
      garmentId: g.id, brandId: g.brandId, slot, price: cost, route,
      attributedTo, dupeOf: dupe?.dupeOf ?? null,
      text: `${r.name} bought a ${g.name.toLowerCase()} at ${where}`
    }));
    if (attributedTo) {
      rec.adopters += 1;
      rec.buys.push({ residentId: r.id, garmentId: g.id, slot });
      reach.cascadeBuys += 1;
      if (dupe) rec.dupeAdopters += 1;
      if (g.passport.published) { rec.disclosed += 1; reach.disclosedBuys += 1; }
      // B3: the trend purchase pushes a garment off the body before it wore out. The discard
      // that follows carries the post that caused it.
      if (prev && r.outfit[slot] !== prev) {
        const w = r.wardrobe.find(x => x.garmentId === prev && x.retiredDay === null);
        const pg = w && gOf(prev);
        if (w && w.wears < pg.durability.baseWears * persona(r.personaId).wearOutMultiplier) {
          w.dropped = true; w.attributedTo = attributedTo;
        }
      }
    }
  }

  function onPost(r, e) {
    reach.posts += 1; reach.postReach += e.reach;
    postsByRole[r.roleId] = (postsByRole[r.roleId] ?? 0) + 1;
    // A post carries every brand on the body, so it opens one cascade per brand: a crux
    // adoption must not be filed under the pellmell shirt in the same photo.
    for (const b of e.brandIds) {
      town.trends[b] = Math.min(TREND_CAP, town.trends[b]);
      const rec = { postId: e.postId, key: `${e.postId}:${b}`, day: clock.day, brandId: b, posterId: r.id,
        adopters: 0, dupeAdopters: 0, prematureDiscards: 0, wastedWears: 0, wasteKg: 0, disclosed: 0,
        impulse: role(r.roleId).socialReach, buys: [], wavedOut: false };
      cascades.set(rec.key, rec);
      cascadeByBrand.set(b, rec);
    }
    spawnDupe(r, cascades.get(`${e.postId}:${e.brandIds[0]}`));
  }

  // B2: the cheapest house copies the look. Same slot, nearest colour + silhouette.
  function spawnDupe(poster, fallback) {
    let src = null;
    for (const slot of SLOTS) {
      const g = poster.outfit[slot] && gOf(poster.outfit[slot]);
      if (!g || g.brandId === 'pellmell') continue;
      if (!src || (town.trends[g.brandId] ?? 0) > (town.trends[src.brandId] ?? 0)) src = g;
    }
    if (!src || (town.trends[src.brandId] ?? 0) < DUPE_TREND) return;
    if (Object.values(town.dupes).some(d => d.dupeOf === src.id)) return;
    const rec = cascades.get(`${fallback.postId}:${src.brandId}`) ?? fallback;
    let best = null, bd = Infinity;
    for (const g of catalog) {
      if (g.brandId !== 'pellmell' || g.slot !== src.slot) continue;
      const d = lookDistance(src, g);
      if (d < bd || (d === bd && best && g.id < best.id)) { bd = d; best = g; }
    }
    if (!best) return;
    town.dupes[best.id] = { dupeOf: src.id, brandId: src.brandId, key: rec.key, postId: rec.postId, posterId: rec.posterId, day: clock.day, distance: Math.round(bd * 100) / 100 };
    town.trends.pellmell = Math.min(TREND_CAP, (town.trends.pellmell ?? 0) + DUPE_SHARE * (town.trends[src.brandId] ?? 0));
    town.trendPosters.pellmell = rec.posterId;
    cascadeByBrand.set('pellmell', rec);
    emit(mkEvent(residentById.get(rec.posterId), 'dupe', {
      garmentId: best.id, brandId: 'pellmell', slot: best.slot,
      text: `Pell Mell put out a ${best.name.toLowerCase()} that looks like the ${src.name.toLowerCase()}`
    }));
  }

  function onDiscard(e) {
    cum.discarded += 1;
    if (e.route) cum.byRoute[e.route] += 1;
    const rec = e.attributedTo && cascades.get(`${e.attributedTo.postId}:${e.attributedTo.brandId}`);
    if (rec && e.premature) {
      rec.prematureDiscards += 1;
      rec.wastedWears += e.wearsRemaining;
      rec.wasteKg = Math.round((rec.wasteKg + e.massKg) * 1000) / 1000;
    }
  }

  function rollover(day) {
    for (const b of Object.keys(town.trends)) {
      const v = town.trends[b] * (1 - TREND_DECAY);
      if (v < TREND_FLOOR) { delete town.trends[b]; delete town.trendPosters[b]; cascadeByBrand.delete(b); }
      else town.trends[b] = v;
    }
    for (const rec of cascades.values()) rec.impulse *= 1 - TREND_DECAY;
    for (const g of catalog) {
      const cap = stockCap.get(g.id);
      if (town.stock[g.id] < cap) town.stock[g.id] = Math.min(cap, town.stock[g.id] + 2);
    }
    for (const r of residents) {
      rejitter(r, day);
      const p = persona(r.personaId), ro = role(r.roleId);
      if (BASELINE_INCOME[r.roleId]) r.wallet += p.incomePerDay * BASELINE_INCOME[r.roleId];
      r.wallet = Math.min(r.wallet, p.budget.ceiling * ro.spendBias * 3);
    }
    secondWave();
  }

  // B4: the trend dies, and the people who bought into it stop wanting the thing.
  function secondWave() {
    for (const rec of cascades.values()) {
      if (rec.wavedOut || !rec.buys.length || rec.impulse >= SECOND_WAVE) continue;
      rec.wavedOut = true;
      for (const b of rec.buys) {
        const r = residentById.get(b.residentId);
        if (r.personaId !== 'trend') continue;
        const w = r.wardrobe.find(x => x.garmentId === b.garmentId && x.retiredDay === null);
        if (!w) continue;
        w.dropped = true;
        r.needBias[b.slot] = Math.min(1, (r.needBias[b.slot] ?? 0) + 0.35);
      }
    }
  }

  function socialise() {
    for (const [a, b, site] of pairUp(residents, world, ctx)) {
      a.activity.partnerId = b.id; b.activity.partnerId = a.id;
      reach.chats += 1; reach.chatReach += 1;   // one act, one other person — the asymmetry
      for (const e of applySocial(a, b, site, ctx)) emit(e);
    }
  }

  function update(r) {
    const a = r.activity, m = r.motion;
    if (a.kind) { if (clock.seconds >= a.until) finish(r); return; }
    if (m.path.length) { advance(r); return; }
    if (clock.seconds >= m.waitUntil) decide(r);
  }

  function tick() {
    clock.seconds += TICK;
    const day = Math.floor(clock.seconds / DAY_SECONDS + 1e-9);
    if (day !== clock.day) { clock.day = day; rollover(day); }
    clock.dayFraction = clock.seconds / DAY_SECONDS - day;
    ctx.day = day; ctx.seconds = clock.seconds;
    for (let i = 0; i < residents.length; i++) update(residents[i]);
    pairClock += TICK;
    if (pairClock >= PAIR_PERIOD) { pairClock -= PAIR_PERIOD; socialise(); }
  }

  function totals() {
    const worn = { co2e: 0, water: 0, waste: 0, unsourced: [] };
    const blocked = { co2e: false, water: false, waste: false };
    const seen = new Set(), byBrand = {}, byPersona = {}, byRole = {};
    for (const r of residents) {
      const p = byPersona[r.personaId] ??= { residents: 0, bought: 0, binned: 0, spend: 0 };
      const ro = byRole[r.roleId] ??= { residents: 0, bought: 0, binned: 0, spend: 0, posts: postsByRole[r.roleId] ?? 0 };
      for (const acc of [p, ro]) {
        acc.residents += 1; acc.bought += r.stats.bought;
        acc.binned += r.stats.binned; acc.spend = Math.round((acc.spend + r.stats.spend) * 100) / 100;
      }
      wornEntries(r, (w, g) => {
        (byBrand[g.brandId] ??= { wornNow: 0, bought: 0 }).wornNow += 1;
        const fp = footprintOf(g);
        for (const k of ['co2e', 'water', 'waste']) { if (fp[k] === null) blocked[k] = true; else worn[k] += fp[k]; }
        for (const u of fp.unsourced) if (!seen.has(u)) { seen.add(u); worn.unsourced.push(u); }
      });
    }
    for (const k of ['co2e', 'water', 'waste']) if (blocked[k]) worn[k] = null;
    for (const id in brandBought) (byBrand[id] ??= { wornNow: 0, bought: 0 }).bought = brandBought[id];
    const list = [...cascades.values()].filter(c => c.adopters > 0)
      .map(({ buys, wavedOut, disclosed, impulse, key, ...c }) => ({ ...c, disclosedShare: c.adopters ? disclosed / c.adopters : 0 }));
    return {
      worn,
      cumulative: { ...cum, spend: Math.round(cum.spend * 100) / 100, byRoute: { ...cum.byRoute } },
      byPersona, byRole, byBrand,
      trends: { ...town.trends },
      influence: {
        posts: reach.posts,
        cascades: list,
        reachPerPost: reach.posts ? reach.postReach / reach.posts : 0,
        reachPerChat: reach.chats ? reach.chatReach / reach.chats : 0,
        disclosedShare: reach.cascadeBuys ? reach.disclosedBuys / reach.cascadeBuys : 0,
        wasteKg: Math.round(list.reduce((t, c) => t + c.wasteKg, 0) * 1000) / 1000
      }
    };
  }

  const sim = {
    town, residents, clock, speed, world, router, events,
    step(dt) {
      if (!(dt > 0)) return;
      carry += dt * sim.speed;
      let guard = 0;
      while (carry >= TICK && guard++ < 900) { carry -= TICK; tick(); }
    },
    runDays(n) {
      const steps = Math.round(n * DAY_SECONDS / TICK);
      for (let i = 0; i < steps; i++) tick();
      return { days: n, seconds: clock.seconds, ...totals() };
    },
    drain() {
      const out = events.filter(e => e.id > drained);
      drained = nextId - 1;
      return out;
    },
    totals,
    researchQueue: () => researchQueue(town, residents, homeDoor),
    onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
  return sim;
}

// B6: what OMNI should look at first, from publicly visible facts only — how much the town is
// talking about a brand, how many people wear it, and how readable its patches are in the open.
export function researchQueue(town, residents, homeDoor = null) {
  const brands = town.brands ?? BRANDS;
  const rows = brands.map(b => ({ brandId: b.id, label: b.label, wearers: 0, prominence: 0 }));
  const byId = new Map(rows.map(r => [r.brandId, r]));
  for (const r of residents) {
    const outside = homeDoor ? r.motion.nodeId !== homeDoor.get(r.id) : r.motion.activity !== 'idle';
    for (const slot of SLOTS) {
      const id = r.outfit[slot];
      if (!id) continue;
      const g = garment(id), row = byId.get(g.brandId);
      if (!row) continue;
      row.wearers += 1;
      if (outside) row.prominence += PATCH_WEIGHT[g.patch?.size] ?? 0.5;
    }
  }
  for (const row of rows) {
    const trend = town.trends?.[row.brandId] ?? 0;
    row.trend = Math.round(trend * 1000) / 1000;
    row.prominence = Math.round(row.prominence * 100) / 100;
    row.scrutiny = Math.round((trend + row.wearers + row.prominence) * 100) / 100;
    row.investigation = { ...brand(row.brandId).investigation };
    row.why = `trend ${row.trend}, ${row.wearers} wearing it, patch prominence ${row.prominence} in public`;
    // Depth follows the trend alone: wearers + prominence run to dozens and would pin every brand at the cap.
    const heat = Math.min(1, trend / TREND_CAP);
    row.budget = { maxPages: 8 + Math.round(8 * heat), maxBrowserSeconds: 60 + Math.round(60 * heat), maxModelCalls: 2 };
  }
  return rows.sort((a, b) => b.scrutiny - a.scrutiny || (a.brandId < b.brandId ? -1 : 1));
}
