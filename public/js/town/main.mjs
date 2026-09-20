// Preferred path: import the SAME shared modules the server runs and step the town locally from
// the served seed, so what you watch and what the API describes are one simulation. When those
// modules will not load in this browser the page degrades rather than blanks — the served
// snapshot still renders and the story panel falls back to the server's observation routes.

import { createRenderer } from './render.mjs';
import { createUi } from './ui.mjs';
import { renderPortrait } from './portrait.mjs';

const DEFAULT_SEED = 'cloth-ee-2026';
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const getJson = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${url} → ${r.status}`))));

async function localTown(seed) {
  const [{ buildTown }, { createSimulation }, omni] = await Promise.all([
    import('/shared/town/index.mjs'), import('/shared/town/simulation.mjs'), import('/shared/town/omni.mjs')
  ]);
  const town = buildTown(seed);
  return { town, omni, sim: createSimulation({ town, speed: 1 }) };
}

async function remoteTown(meta) {
  const catalog = await getJson('/api/town/catalog').catch(() => []);
  const garments = (Array.isArray(catalog) ? catalog : catalog.garments ?? [])
    .map(row => row.garment ?? row).filter(g => g && g.colors);
  const roles = meta.roles ?? await getJson('/api/town/roles').catch(() => []);
  return { ...meta, garments, roles, sites: meta.sites ?? meta.layout.sites };
}

function index(town) {
  town.garmentById = new Map((town.garments ?? []).map(g => [g.id, g]));
  town.brandById = new Map((town.brands ?? []).map(b => [b.id, b]));
  return town;
}

const patchesOf = observation => {
  const out = {};
  for (const g of observation?.garments ?? []) out[g.slot] = { text: g.patchText, legibility: g.patchLegibility };
  return out;
};

function gradeOf(brief, truth) {
  if (!truth?.outfit) return null;
  let top1 = 0, top3 = 0, total = 0;
  for (const slot of brief.catalogCandidates ?? []) {
    const ids = slot.matches.map(m => m.garmentId), want = truth.outfit[slot.slot] ?? null;
    total++;
    if (ids[0] === want) top1++;
    if (ids.includes(want)) top3++;
  }
  return { top1, top3, total };
}

// Graded over what the resident actually wears, so a garment the model never reported is a miss.
function gradeScan(found, truth) {
  const candidates = [];
  let top1 = 0, top3 = 0;
  for (const [slot, want] of Object.entries(truth.outfit)) {
    if (!want) continue;
    const row = found.find(c => c.slot === slot) ?? { slot, matches: [] };
    const ids = row.matches.map(m => m.garmentId);
    candidates.push(row);
    if (ids[0] === want) top1++;
    if (ids.includes(want)) top3++;
  }
  return { top1, top3, total: candidates.length, candidates };
}

const EMPTY_BRIEF = {
  observation: { view: 'front', locator: null, garments: [], notes: ['observation route unavailable'], context: null, crowd: null },
  catalogCandidates: [], actions: []
};

async function boot() {
  const meta = await getJson('/api/town').catch(() => null);
  let town = null, sim = null, omni = null, mode = 'local';
  try {
    ({ town, sim, omni } = await localTown(meta?.seed ?? DEFAULT_SEED));
  } catch (err) {
    mode = 'remote';
    console.warn('[town] local simulation unavailable:', err.message);
    if (!meta) {
      document.getElementById('town-status').textContent = 'The town could not be loaded. Start the server and reload.';
      return;
    }
    town = await remoteTown(meta);
  }
  index(town);

  const ui = createUi(town, {
    onSpeed(v) { if (sim) sim.speed = v; else speed = v; },
    onFilter(personas, roles) { renderer.setFilter(personas, roles); },
    onClear() { renderer.setSelected(null); current = null; ui.clear(); },
    onScan: scan,
    onExperiment: compareExperiment
  });
  getJson('/api/health').then(h => ui.setLive(h.omniMode === 'live' && h.omniConfigured)).catch(() => {});
  ui.setStatus(mode === 'local'
    ? `${town.residents.length} residents`
    : `${town.residents.length} residents · served snapshot · live stepping unavailable in this browser`);

  const canvas = document.getElementById('board');
  const renderer = createRenderer(canvas, town, { reduced, onSelect: select });
  document.getElementById('zoom-in').addEventListener('click', () => renderer.zoomAt(1.25));
  document.getElementById('zoom-out').addEventListener('click', () => renderer.zoomAt(0.8));
  document.getElementById('zoom-reset').addEventListener('click', () => renderer.fit());

  const clock = sim ? sim.clock : { seconds: 63, day: 0, dayFraction: 0.35 };   // a snapshot reads better in daylight
  if (!sim && meta?.totals) ui.setTotals(meta.totals);
  let speed = 1, selected = null, current = null, uiAcc = 1;

  async function compareExperiment({ brandId, days }) {
    ui.experimentRunning();
    const run = publish => fetch('/api/town/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: town.seed, days, publish })
    }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Simulation returned ${r.status}`);
      return data;
    });
    try {
      const [baseline, intervention] = await Promise.all([run([]), run([brandId])]);
      ui.showExperiment({ baseline, intervention, brandId, days });
    } catch (err) {
      ui.experimentFailed(err.message);
    }
  }

  // Only the capture canvas and the voice leave the browser. The truth stays here for grading.
  async function scan(audio) {
    if (!current) return;
    const { resident, truth, portrait } = current;
    ui.scanning();
    try {
      const r = await fetch('/api/town/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: portrait.toDataURL('image/png'), audio })
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      if (selected === resident.id) ui.showScan({ resident, result, truth, grade: gradeScan(result.catalogCandidates, truth) });
    } catch (err) {
      if (selected === resident.id) ui.scanFailed(err.message);
    }
  }

  async function briefFor(resident) {
    if (omni) {
      const brief = omni.omniBrief(resident, { town, clock });
      const truth = omni.groundTruthOf(resident, town);
      return { brief, truth, grade: omni.gradeMatch(brief.observation, brief.catalogCandidates, truth) };
    }
    const brief = await getJson(`/api/town/residents/${resident.id}/brief?view=front`).catch(() => EMPTY_BRIEF);
    const truth = { outfit: resident.outfit };
    return { brief, truth, grade: gradeOf(brief, truth) };
  }

  async function select(id) {
    selected = id;
    renderer.setSelected(id);
    current = null;
    if (!id) { ui.clear(); return; }
    const resident = town.residents.find(r => r.id === id);
    if (!resident) return;
    ui.previewResident({ resident });
    const { brief, truth, grade } = await briefFor(resident);
    if (selected !== id) return;
    const portrait = renderPortrait(resident, town, 512, patchesOf(brief.observation));
    ui.showResident({ resident, brief, truth, grade, portrait });
    current = { resident, truth, portrait };
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (sim) sim.step(dt);
    else {
      clock.seconds += dt * speed;
      clock.day = Math.floor(clock.seconds / 180);
      clock.dayFraction = clock.seconds / 180 - clock.day;
    }
    renderer.draw(clock);
    uiAcc += dt;
    if (uiAcc >= 0.4) {
      uiAcc = 0;
      ui.setClock(clock);
      if (sim) { ui.pushEvents(sim.drain()); ui.setTotals(sim.totals(), sim.researchQueue()); }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  ui.setSpeed(1);
}

boot().catch(err => {
  console.error('[town]', err);
  document.getElementById('town-status').textContent = `The town failed to start: ${err.message}`;
});
