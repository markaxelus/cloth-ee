// Owns every DOM node outside the canvas: controls, chips, meters, ticker, feed and the story
// panel. It never touches the simulation — main.mjs feeds it and it hands back intent.

const FEED_CAP = 40;
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const clock24 = seconds => {
  const h = ((seconds % 180) / 180) * 24;
  return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor(h % 1 * 60)).padStart(2, '0')}`;
};
const PHASES = [[0.2, 'early morning'], [0.35, 'morning'], [0.55, 'midday'], [0.72, 'afternoon'], [0.88, 'evening'], [1.01, 'night']];
const fmt = n => n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(1) : n.toFixed(2);

export function createUi(town, handlers = {}) {
  const personaById = new Map((town.personas ?? []).map(p => [p.id, p]));
  const roleById = new Map((town.roles ?? []).map(r => [r.id, r]));
  const brandById = new Map((town.brands ?? []).map(b => [b.id, b]));
  const nameOf = id => (town.residents ?? []).find(r => r.id === id)?.name ?? 'someone';
  const personas = new Set(), roles = new Set();
  const seenResidents = new Set();
  const session = { top1: 0, top3: 0, total: 0 };
  const liveGrades = new Map();   // latest live grade per resident, so a re-scan replaces its own score
  let lastTrends = {}, live = false;
  let impact = { trends: {}, cascades: [], queue: [] };
  let story = null;   // { resident, truth, reads } — redrawn every UI tick so the trace moves with the trend

  const count = (key, id) => (town.residents ?? []).filter(r => r[key] === id).length;
  function chips(mount, source, key, set) {
    mount.replaceChildren();
    for (const item of source) {
      const b = el('button', 'chip');
      b.appendChild(el('i'));
      b.appendChild(el('span', null, item.label));
      b.appendChild(el('span', 'n', String(count(key, item.id))));
      b.addEventListener('click', () => {
        set.has(item.id) ? set.delete(item.id) : set.add(item.id);
        b.classList.toggle('is-on', set.has(item.id));
        handlers.onFilter?.(personas, roles);
      });
      mount.appendChild(b);
    }
  }
  chips($('persona-chips'), town.personas ?? [], 'personaId', personas);
  chips($('role-chips'), town.roles ?? [], 'roleId', roles);
  const clearSet = (set, mount) => () => {
    set.clear();
    for (const b of mount.children) b.classList.remove('is-on');
    handlers.onFilter?.(personas, roles);
  };
  $('reset-personas').addEventListener('click', clearSet(personas, $('persona-chips')));
  $('reset-roles').addEventListener('click', clearSet(roles, $('role-chips')));

  const speedButtons = [...$('speed').querySelectorAll('.speed')];
  for (const b of speedButtons) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
  function setSpeed(v) {
    for (const b of speedButtons) {
      const on = Number(b.dataset.speed) === v;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    handlers.onSpeed?.(v);
  }

  const experimentBrand = $('experiment-brand');
  const unpublishedBrands = (town.brands ?? []).filter(b =>
    (town.garments ?? []).some(g => g.brandId === b.id && !g.passport.published));
  for (const b of unpublishedBrands) {
    const option = el('option', null, b.label);
    option.value = b.id;
    experimentBrand.appendChild(option);
  }
  if (unpublishedBrands.some(b => b.id === 'pellmell')) experimentBrand.value = 'pellmell';
  $('run-experiment').addEventListener('click', () => {
    handlers.onExperiment?.({ brandId: experimentBrand.value, days: 14 });
  });

  function experimentRunning() {
    $('run-experiment').disabled = true;
    $('experiment-status').textContent = 'Running two identical towns…';
    $('experiment-result').hidden = true;
  }

  function experimentFailed(message) {
    $('run-experiment').disabled = false;
    $('experiment-status').textContent = `The comparison could not run: ${message}`;
  }

  function showExperiment({ baseline, intervention, brandId, days }) {
    const brandName = brandById.get(brandId)?.label ?? brandId;
    const diff = (after, before) => (after ?? 0) - (before ?? 0);
    const signed = n => `${n > 0 ? '+' : ''}${Math.round(n * 10) / 10}`;
    const beforeBrand = baseline.byBrand?.[brandId]?.bought ?? 0;
    const afterBrand = intervention.byBrand?.[brandId]?.bought ?? 0;
    const metrics = [
      ['Brand purchases', diff(afterBrand, beforeBrand)],
      ['All purchases', diff(intervention.cumulative?.bought, baseline.cumulative?.bought)],
      ['Binned items', diff(intervention.cumulative?.byRoute?.bin, baseline.cumulative?.byRoute?.bin)],
      ['Trend waste', diff(intervention.influence?.wasteKg, baseline.influence?.wasteKg), ' kg']
    ];
    const result = $('experiment-result');
    result.replaceChildren();
    const lead = el('p', 'result-lead');
    lead.append(`${brandName} published its passport. Over ${days} simulated days:`);
    result.appendChild(lead);
    const grid = el('div', 'result-grid');
    for (const [label, value, unit = ''] of metrics) {
      const cell = el('div', 'result-metric');
      cell.appendChild(el('strong', value < 0 ? 'down' : value > 0 ? 'up' : 'flat', `${signed(value)}${unit}`));
      cell.appendChild(el('span', null, label));
      grid.appendChild(cell);
    }
    result.appendChild(grid);
    result.appendChild(el('p', 'result-note',
      'This is a scenario result from synthetic residents—not a forecast of real people.'));
    result.hidden = false;
    $('run-experiment').disabled = false;
    $('experiment-status').textContent = 'Controlled comparison complete.';
  }

  const feed = $('feed');
  $('ambient-toggle').addEventListener('change', e => feed.classList.toggle('no-ambient', !e.target.checked));
  $('story-close').addEventListener('click', () => handlers.onClear?.());

  const scanButton = $('scan-omni'), talk = $('scan-talk');
  const setScanEnabled = on => { scanButton.disabled = talk.disabled = !on; };
  scanButton.addEventListener('click', () => handlers.onScan?.());
  let recorder = null, holding = false;
  async function startTalk() {
    if (talk.disabled || recorder) return;
    if (!navigator.mediaDevices?.getUserMedia) { scanFailed('Microphone requires localhost or HTTPS.'); return; }
    holding = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
      if (!holding) { stream.getTracks().forEach(t => t.stop()); return; }   // released during the permission prompt
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const type = recorder.mimeType.split(';')[0];   // the server takes the bare container type
        recorder = null;
        const reader = new FileReader();
        reader.onload = () => handlers.onScan?.(`data:${type};base64,${reader.result.split(',')[1]}`);
        reader.readAsDataURL(new Blob(chunks, { type }));
      };
      recorder.start();
      talk.classList.add('is-recording');
      talk.textContent = 'Release to send';
    } catch (err) { scanFailed(`Microphone unavailable: ${err.message}`); }
  }
  function stopTalk() {
    holding = false;
    if (recorder?.state !== 'recording') return;
    recorder.stop();
    talk.classList.remove('is-recording');
    talk.textContent = 'Hold to ask';
  }
  talk.addEventListener('pointerdown', startTalk);
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) talk.addEventListener(type, stopTalk);

  function setClock(c) {
    $('clock-day').textContent = `Day ${c.day + 1}`;
    $('clock-phase').textContent = `${clock24(c.seconds)} · ${PHASES.find(([e]) => c.dayFraction < e)[1]}`;
    $('clock-hand').style.transform = `translate(-50%,-100%) rotate(${(c.dayFraction * 360).toFixed(1)}deg)`;
  }

  function pushEvents(list) {
    for (const e of list) {
      const li = el('li', e.ambient ? `ambient ${e.type}` : e.type);
      li.appendChild(el('span', 'dot'));
      li.appendChild(el('span', 't', e.text));
      const t = el('time', null, clock24(e.seconds));
      t.dateTime = `P${e.day}D`;
      li.appendChild(t);
      feed.prepend(li);
    }
    while (feed.childElementCount > FEED_CAP) feed.lastElementChild.remove();
  }

  function setTotals(totals, queue = []) {
    const worn = totals.worn ?? {};
    const units = { co2e: 'kg', water: 'L', waste: 'kg' };
    let missing = 0;
    for (const k of ['co2e', 'water', 'waste']) {
      const node = $(`meter-${k}`);
      node.replaceChildren();
      if (worn[k] === null || worn[k] === undefined) { node.textContent = '—'; missing++; }
      else { node.textContent = fmt(worn[k]); node.appendChild(el('small', null, units[k])); }
    }
    $('worn-block').hidden = missing === 3;   // three dashes say nothing until the factor table is sourced
    $('meter-note').textContent = missing
      ? `factor table not yet sourced · ${(worn.unsourced ?? []).length} factors missing`
      : 'material-based, cradle-to-gate';

    const inf = totals.influence ?? {}, cascades = inf.cascades ?? [];
    const sum = key => cascades.reduce((t, c) => t + c[key], 0);
    $('toll-buys').textContent = sum('adopters');
    $('toll-dumped').textContent = sum('prematureDiscards');
    $('toll-waste').replaceChildren(fmt(inf.wasteKg ?? 0), el('small', null, 'kg'));
    $('toll-note').textContent = inf.posts
      ? `${inf.posts} posts set these off · ${Math.round((inf.disclosedShare ?? 0) * 100)}% of copy-buys had any published evidence to check`
      : 'nobody has posted yet';

    const trends = totals.trends ?? {};
    impact = { trends, cascades, queue };
    const top = Object.entries(trends).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const ticker = $('ticker');
    ticker.replaceChildren();
    if (!top.length) ticker.appendChild(el('p', 'note', 'no brand is trending yet'));
    const peak = top.length ? Math.max(top[0][1], 1) : 1;
    for (const [id, v] of top) {
      const b = brandById.get(id), was = lastTrends[id] ?? 0, depth = queue.find(q => q.brandId === id)?.budget;
      const row = el('div', 'trend');
      const sw = el('span', 'swatch');
      sw.style.background = b?.palette.base ?? '#DDD6E8';
      row.appendChild(sw);
      const name = el('span', 'name', b?.label ?? id);
      if (depth) name.appendChild(el('small', null, `OMNI depth ${depth.maxPages} pages`));
      row.appendChild(name);
      const bar = el('span', 'bar'), fill = el('i');
      fill.style.width = `${Math.min(100, v / peak * 100).toFixed(0)}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      const d = v - was;
      row.appendChild(el('span', `dir ${d > 0.02 ? 'up' : d < -0.02 ? 'down' : 'flat'}`, d > 0.02 ? '▲' : d < -0.02 ? '▼' : '–'));
      ticker.appendChild(row);
    }
    lastTrends = { ...trends };
    if (story) wearingRows();
  }

  // One card per garment on the body. A garment a post put there gets the whole chain — whose
  // post, who else bought in, what was dumped for it, what can be checked — the rest get one line.
  function wearingRows() {
    const { resident, truth, reads } = story;
    const life = g => Math.round(g.durability.baseWears * (personaById.get(resident.personaId)?.wearOutMultiplier ?? 1));
    const rows = [];
    for (const [slot, id] of Object.entries(resident.outfit ?? {})) {
      const g = id && town.garmentById.get(id);
      if (!g) continue;
      const w = resident.wardrobe?.find(x => x.garmentId === id && x.retiredDay === null) ?? null;
      const post = w?.attributedTo ?? null;
      const card = el('div', post ? 'match trace' : 'match');
      const head = el('div', 'match-head');
      head.appendChild(el('span', null, slot));
      const read = truth?.outfit?.[slot] === id ? reads?.find(c => c.slot === slot) : null;   // stale once they change clothes
      if (read) {
        const ids = read.matches.map(m => m.garmentId);
        const v = ids[0] === id ? ['hit', 'OMNI read ✓'] : ids.includes(id) ? ['near', 'OMNI top-3'] : ['miss', 'OMNI missed'];
        head.appendChild(el('span', `verdict ${v[0]}`, v[1]));
      }
      card.appendChild(head);
      card.appendChild(el('p', 'garment', `${g.name} · ${brandById.get(g.brandId)?.label ?? g.brandId}`));
      const worn = w ? ` · worn ${w.wears} of ~${life(g)}` : '';
      if (!post) card.appendChild(el('p', 'why', `${w && w.acquiredDay >= 0 ? `Bought day ${w.acquiredDay + 1}, own choice` : 'No trend behind it'}${worn}`));
      else {
        const c = impact.cascades.find(x => x.postId === post.postId && x.brandId === post.brandId);
        const out = resident.wardrobe.find(x => x.slot === slot && x.dropped && x.attributedTo?.postId === post.postId);
        const og = out && town.garmentById.get(out.garmentId);
        const depth = impact.queue.find(q => q.brandId === g.brandId);
        const steps = el('ol', 'chain');
        steps.appendChild(el('li', null, `Bought day ${w.acquiredDay + 1} after ${nameOf(post.residentId)}’s post${w.dupeOf ? ` — a cheap copy of the ${town.garmentById.get(w.dupeOf)?.name.toLowerCase() ?? 'original'}` : ''}${worn}`));
        if (og) steps.appendChild(el('li', 'cost', `Pushed out their ${og.name.toLowerCase()} with ${Math.max(0, life(og) - out.wears)} wears left in it`));
        if (c) steps.appendChild(el('li', c.prematureDiscards ? 'cost' : null, `${c.adopters} people bought in off that one post${c.prematureDiscards ? ` · ${c.prematureDiscards} garments dumped early · ${fmt(c.wasteKg)} kg wasted` : ''}`));
        steps.appendChild(el('li', g.passport.published ? null : 'cost', g.passport.published ? 'The brand publishes a passport they could have checked' : 'The brand publishes nothing any of them could check'));
        if (depth) steps.appendChild(el('li', null, `OMNI investigation ${depth.investigation.status} · depth ${depth.budget.maxPages} pages${depth.trend ? ', raised by the trend' : ''}`));
        card.appendChild(steps);
      }
      rows.push([post ? 0 : 1, card]);
    }
    $('wearing').replaceChildren(...rows.sort((a, b) => a[0] - b[0]).map(r => r[1]));
  }

  function previewResident({ resident }) {
    $('story-empty').hidden = true;
    $('story').hidden = false;
    $('story').classList.add('is-loading');
    $('story-title').textContent = 'Resident selected';
    $('story-name').textContent = resident.name;
    $('story-persona').textContent = personaById.get(resident.personaId)?.label ?? resident.personaId;
    $('story-role').textContent = roleById.get(resident.roleId)?.label ?? resident.roleId;
    $('story-activity').textContent = resident.activity?.kind ?? resident.motion?.activity ?? 'walking';
    $('story-omni-state').textContent = 'Building observable-only OMNI brief…';
  }

  function showResident({ resident, brief, truth, grade, portrait }) {
    $('story').classList.remove('is-loading');
    $('story-empty').hidden = true;
    $('story').hidden = false;
    $('story-title').textContent = 'Who is that?';
    $('story-name').textContent = resident.name;
    $('story-persona').textContent = personaById.get(resident.personaId)?.label ?? resident.personaId;
    $('story-role').textContent = roleById.get(resident.roleId)?.label ?? resident.roleId;
    const act = brief.observation?.context?.activity ?? resident.motion.activity;
    const place = brief.observation?.context?.placeKind;
    $('story-activity').textContent = place ? `${act ?? 'walking'} · ${place}` : (act ?? 'walking');

    const mount = $('portrait-mount');
    mount.replaceChildren(portrait);
    $('portrait-note').textContent = `${portrait.width} px · ${brief.observation?.view ?? 'front'}`;

    story = { resident, truth, reads: brief.catalogCandidates };
    wearingRows();
    $('story-omni-state').textContent = live ? 'Read by the local matcher · scan to ask the live model' : 'Read by the local matcher';
    $('scan-say').hidden = true;
    setScanEnabled(live);

    if (grade && !seenResidents.has(resident.id)) {
      seenResidents.add(resident.id);
      session.top1 += grade.top1; session.top3 += grade.top3; session.total += grade.total;
    }
    $('accuracy').textContent = session.total
      ? `OMNI read from pixels · ${seenResidents.size} people · top-1 ${session.top1}/${session.total} (${Math.round(session.top1 / session.total * 100)}%) · top-3 ${session.top3}/${session.total} (${Math.round(session.top3 / session.total * 100)}%)`
      : 'OMNI read from pixels: —';
  }

  function scanning() {
    $('story').classList.add('is-loading');
    $('story-omni-state').textContent = 'OMNI is looking at the capture…';
    setScanEnabled(false);
  }

  function scanFailed(message) {
    $('story').classList.remove('is-loading');
    $('story-omni-state').textContent = `OMNI scan failed · ${message}`;
    setScanEnabled(live);
  }

  function showScan({ resident, result, truth, grade }) {
    $('story').classList.remove('is-loading');
    story = { resident, truth, reads: grade.candidates };
    wearingRows();
    $('story-omni-state').textContent = `OMNI live · ${result.model} · ${(result.latencyMs / 1000).toFixed(1)} s${result.tokens ? ` · ${result.tokens} tokens` : ''}`;
    const say = $('scan-say');
    say.textContent = result.transcript ? `“${result.transcript}” — ${result.say}` : result.say;
    say.hidden = !result.say;
    if (result.say && 'speechSynthesis' in window) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(result.say));
    }
    liveGrades.set(resident.id, grade);
    const sum = { top1: 0, top3: 0, total: 0 };
    for (const g of liveGrades.values()) { sum.top1 += g.top1; sum.top3 += g.top3; sum.total += g.total; }
    const line = $('accuracy-live');
    line.hidden = false;
    line.textContent = `LIVE model from pixels · ${liveGrades.size} scanned · top-1 ${sum.top1}/${sum.total} (${Math.round(sum.top1 / sum.total * 100)}%) · top-3 ${sum.top3}/${sum.total} (${Math.round(sum.top3 / sum.total * 100)}%)`;
    setScanEnabled(live);
  }

  function clear() {
    $('story').classList.remove('is-loading');
    story = null;
    $('story').hidden = true;
    $('story-empty').hidden = false;
    $('story-title').textContent = 'Nobody selected';
  }

  return {
    setSpeed, setClock, pushEvents, setTotals, previewResident, showResident, clear,
    scanning, scanFailed, showScan, experimentRunning, experimentFailed, showExperiment,
    setLive(on) { live = on; },
    setStatus(text) { $('town-status').textContent = text; }
  };
}
