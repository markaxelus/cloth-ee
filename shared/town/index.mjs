import { makeRng } from './rng.mjs';
import { buildLayout, buildRouter } from './layout.mjs';
import { BRANDS, GARMENTS, PERSONAS, ROLES } from './data.mjs';
import { generateResidents } from './residents.mjs';

export * from './rng.mjs';
export * from './layout.mjs';
export * from './data.mjs';
export * from './residents.mjs';
export * from './interactions.mjs';
export * from './simulation.mjs';
export * from './omni.mjs';

// One reproducible town. Everything seeded flows from `seed`; the layout is deliberately not
// seeded (buildLayout takes none), so the board is the same board in every run and only the
// people change. `garments` is the frozen catalog — the merchant sandbox replaces this field
// with a mutable clone before handing the town to createSimulation.
export function buildTown(seed = 'cloth-ee-2026') {
  const layout = buildLayout();
  const residents = generateResidents(makeRng(`${seed}:residents`), layout);
  return {
    seed, layout, router: buildRouter(layout),
    brands: BRANDS, garments: GARMENTS, personas: PERSONAS, roles: ROLES,
    residents, shops: layout.shops, sites: layout.sites,
    generatedWith: {
      contract: 'town-1+A+B',
      counts: { residents: residents.length, brands: BRANDS.length, garments: GARMENTS.length,
        personas: PERSONAS.length, roles: ROLES.length, shops: layout.shops.length,
        homes: layout.homes.length, sites: layout.sites.length, nodes: layout.nodes.length }
    }
  };
}
