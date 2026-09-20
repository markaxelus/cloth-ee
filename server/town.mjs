import {
  buildTown, createSimulation, BRANDS, GARMENTS, FACTORS,
  footprintOf, disclosureCompleteness, observableOf, omniBrief, assertNoGroundTruth,
  matchCatalog
} from '../shared/town/index.mjs';
import { scanOmni } from './omni.mjs';

const DEFAULT_SEED = 'cloth-ee-2026';
const VIEWS = ['front', 'side', 'back'];
const MAX_DAYS = 30;
const RESIDENT_PATH = /^\/api\/town\/residents\/([A-Za-z0-9-]{1,12})(?:\/(observation|brief))?$/;

// The render-side record: it carries the name, the persona, the role and the body colours the
// canvas needs. NOTHING on this object may be put in a prompt. The model-facing pair is
// /observation and /brief, and both are run through assertNoGroundTruth before they are sent.
const publicResident = r => ({
  id: r.id, name: r.name, personaId: r.personaId, roleId: r.roleId, body: r.body,
  outfit: { ...r.outfit }, context: r.context,
  activity: { ...r.activity }, motion: { ...r.motion, path: r.motion.path.slice() },
  stats: { ...r.stats }, wardrobeSize: r.wardrobe.length,
  wears: r.wardrobe.reduce((s, w) => s + w.wears, 0)
});

const FACTOR_NOTE = 'Every factor ships unsourced (value null). A value appears only once status is "sourced" with a sourceUrl and a year.';

export function townRoutes({ env = process.env, fetcher = fetch } = {}) {
  const seed = env.TOWN_SEED || DEFAULT_SEED;
  let served = null;
  // The served town is built once and never stepped: it is the deterministic day-0 board the
  // browser boots from and then simulates client-side. Headless runs get their own fresh town.
  const town = () => (served ??= (() => { const t = buildTown(seed); return { t, sim: createSimulation({ town: t }) }; })());

  async function simulate(req, res, { json, problem, body, rate }) {
    rate(`town-sim:${req.socket.remoteAddress}`, 30, 60000);
    const b = await body(req);
    const days = Number(b.days ?? 14);
    if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) throw problem(`days must be a number between 1 and ${MAX_DAYS}`);
    const runSeed = typeof b.seed === 'string' && b.seed ? b.seed.slice(0, 64) : seed;
    const publish = Array.isArray(b.publish) ? b.publish : [];
    for (const id of publish) if (!BRANDS.some(x => x.id === id)) throw problem(`Unknown brand in publish: ${JSON.stringify(id)}`);
    // GARMENTS is deep-frozen, so the sandbox mutates a clone. The served town keeps the
    // catalog it was built with whatever this run does.
    const garments = structuredClone(GARMENTS);
    if (publish.length) for (const g of garments) if (publish.includes(g.brandId)) g.passport.published = true;
    const fresh = buildTown(runSeed);
    fresh.garments = garments;
    const summary = createSimulation({ town: fresh, seed: runSeed }).runDays(Math.round(days));
    json(res, 200, { seed: runSeed, publish, ...summary });
  }

  // The live scan takes pixels and a voice, not a resident id: this route cannot leak ground
  // truth because it never sees any. The browser, which does hold the truth, grades the result.
  async function scan(req, res, { json, problem, body, rate }) {
    rate(`town-scan:${req.socket.remoteAddress}`, 12, 60000);
    const b = await body(req);
    if (typeof b.text !== 'undefined' && (typeof b.text !== 'string' || b.text.length > 500)) throw problem('Question exceeds 500 characters');
    const { garments, ...answer } = await scanOmni({ text: b.text, image: b.image, audio: b.audio }, env, fetcher);
    const observation = { view: 'model', garments };
    json(res, 200, { ...answer, observation, catalogCandidates: matchCatalog(observation) });
  }

  async function handle(req, res, pathname, url, helpers) {
    if (pathname !== '/api/town' && !pathname.startsWith('/api/town/')) return false;
    const { json, problem } = helpers;
    if (req.method === 'POST' && pathname === '/api/town/simulate') { await simulate(req, res, helpers); return true; }
    if (req.method === 'POST' && pathname === '/api/town/scan') { await scan(req, res, helpers); return true; }
    if (req.method !== 'GET') throw problem('Method is not supported', 405);
    const { t, sim } = town();

    if (pathname === '/api/town') {
      json(res, 200, {
        seed: t.seed, generatedWith: t.generatedWith, layout: t.layout, shops: t.shops, sites: t.sites,
        brands: t.brands, personas: t.personas, roles: t.roles,
        residents: t.residents.map(publicResident), totals: sim.totals()
      });
      return true;
    }
    if (pathname === '/api/town/residents') { json(res, 200, t.residents.map(publicResident)); return true; }
    if (pathname === '/api/town/roles') { json(res, 200, t.roles); return true; }
    if (pathname === '/api/town/brands') { json(res, 200, t.brands); return true; }
    if (pathname === '/api/town/factors') { json(res, 200, { note: FACTOR_NOTE, factors: FACTORS }); return true; }
    if (pathname === '/api/town/catalog') {
      json(res, 200, GARMENTS.map(g => ({ ...g, footprint: footprintOf(g), disclosure: disclosureCompleteness(g) })));
      return true;
    }
    if (pathname === '/api/town/research-queue') { json(res, 200, researchPayload(t, sim)); return true; }

    const m = RESIDENT_PATH.exec(pathname);
    if (!m) return false;
    const resident = t.residents.find(r => r.id === m[1]);
    if (!resident) throw problem('Resident not found', 404);
    const view = url.searchParams.get('view') ?? 'front';
    if (!VIEWS.includes(view)) throw problem(`view must be one of ${VIEWS.join(', ')}`);

    if (m[2] === 'observation') {
      const payload = observableOf(resident, { view, town: t, clock: sim.clock });
      assertNoGroundTruth(payload, t);
      json(res, 200, payload);
    } else if (m[2] === 'brief') {
      const payload = omniBrief(resident, { town: t, clock: sim.clock, view });
      assertNoGroundTruth(payload, t);
      json(res, 200, payload);
    } else {
      // Ground truth, on purpose: the renderer and the grader need it. Never send it to a model.
      json(res, 200, { groundTruth: true, note: 'render-side record — never send this to a model', resident });
    }
    return true;
  }

  return { handle, seed, town: () => town().t, simulation: () => town().sim };
}

// B6. Ranked from publicly visible facts only (trend chatter, how many people wear it, how
// readable its patches are outdoors) — never from a wardrobe or a wallet. Each row is already
// an executable request: `action` is the call the investigator pipeline makes, `budget` is what
// it may spend, and `why` is the sentence a reviewer reads to sanity-check the ranking.
function researchPayload(t, sim) {
  const queue = sim.researchQueue().map((row, i) => ({
    rank: i + 1, ...row,
    action: { id: 'research_brand', args: { brandId: row.brandId }, needs: ['browserbase', 'omni'] }
  }));
  const payload = {
    seed: t.seed, day: sim.clock.day,
    basis: 'scrutiny = current trend + people currently wearing it + patch prominence in public; budget scales with the trend alone',
    note: 'Derived, not persisted. Ranked over the served day-0 town; a live client re-ranks as its own simulation runs.',
    queue
  };
  assertNoGroundTruth(payload, t, { allow: ['queue'] });
  return payload;
}
