import {
  buildTown, validateSeedData, observableOf, matchCatalog, groundTruthOf, gradeMatch
} from '../shared/town/index.mjs';

// plan-town.md §6.7: the honest self-grade. If the local matcher cannot pick the right garment
// out of its own catalog from an observation, no hybrid search downstream will do better.
const GATE = 0.80;
const seed = process.argv[2] || 'cloth-ee-2026';
const view = process.argv[3] || 'front';

validateSeedData();
const town = buildTown(seed);
const bySlot = new Map();
const tally = { total: 0, top1: 0, top3: 0 };
const misses = [];

for (const resident of town.residents) {
  const observation = observableOf(resident, { view, town });
  const truth = groundTruthOf(resident, town);
  const grade = gradeMatch(observation, matchCatalog(observation), truth);
  for (const row of grade.rows) {
    const acc = bySlot.get(row.slot) ?? bySlot.set(row.slot, { total: 0, top1: 0, top3: 0 }).get(row.slot);
    acc.total++; acc.top1 += row.top1 ? 1 : 0; acc.top3 += row.top3 ? 1 : 0;
    if (!row.top3) misses.push(`${resident.id} ${row.slot}: expected ${row.expected}, got ${row.got}`);
  }
  tally.total += grade.total; tally.top1 += grade.top1; tally.top3 += grade.top3;
}

const pct = (n, d) => (d ? (n / d).toFixed(4) : '—');
console.log(`town-accuracy  seed=${seed}  view=${view}  residents=${town.residents.length}`);
console.log('slot       observed   top-1    top-3');
for (const [slot, a] of [...bySlot].sort()) {
  console.log(`${slot.padEnd(10)} ${String(a.total).padStart(8)} ${pct(a.top1, a.total).padStart(8)} ${pct(a.top3, a.total).padStart(8)}`);
}
console.log(`${'OVERALL'.padEnd(10)} ${String(tally.total).padStart(8)} ${pct(tally.top1, tally.total).padStart(8)} ${pct(tally.top3, tally.total).padStart(8)}`);
if (misses.length) console.log(`\n${misses.length} garments outside top-3:\n  ${misses.slice(0, 12).join('\n  ')}`);

const overall = tally.total ? tally.top3 / tally.total : 0;
if (overall < GATE) {
  console.error(`\nFAIL: overall top-3 ${overall.toFixed(4)} is under the ${GATE.toFixed(2)} gate. Give garments bigger patches or more distinct colours.`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS: overall top-3 ${overall.toFixed(4)} >= ${GATE.toFixed(2)}`);
}
