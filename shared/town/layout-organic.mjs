import { hash32 } from './rng.mjs';

const SIZE = 64;
const RIM = 3;
const BRAND_IDS = ['verdant', 'halcyon', 'pellmell', 'northbeck', 'solane', 'crux'];
const ROOFS = ['gable', 'mansard', 'flat'];
const PALETTES = [
  { wall: '#FFC9B5', roof: '#C98A76', trim: '#FFF9F3' },
  { wall: '#BDE8D3', roof: '#6FA98C', trim: '#FFF9F3' },
  { wall: '#FFE9A8', roof: '#C9A44C', trim: '#FFF9F3' },
  { wall: '#BFE3FF', roof: '#6E9CC4', trim: '#FFF9F3' },
  { wall: '#B9A4DD', roof: '#6F5C97', trim: '#FFF9F3' },
  { wall: '#FFD7E4', roof: '#C98098', trim: '#FFF9F3' }
];
const SHOP_SPECS = [
  ['shop-verdant', 'Verdant Row', ['verdant']],
  ['shop-halcyon', 'Halcyon House', ['halcyon']],
  ['shop-pellmell', 'Pell Mell', ['pellmell']],
  ['shop-northbeck', 'Northbeck Supply', ['northbeck']],
  ['shop-solane', 'Solane & Crux', ['solane', 'crux']]
];

export function buildOrganicLayout() {
  const nodes = [], nodeById = new Map(), edges = [], edgeSeen = new Set();
  const addNode = (id, x, y, kind = 'path') => {
    if (!nodeById.has(id)) {
      const node = { id, x, y, kind };
      nodes.push(node);
      nodeById.set(id, node);
    }
    return id;
  };
  const addEdge = (a, b) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (a !== b && !edgeSeen.has(key)) {
      edgeSeen.add(key);
      edges.push([a, b]);
    }
  };
  const addRoute = (id, points, { closed = false, kind = 'road' } = {}) => {
    const ids = points.map(([x, y], i) => addNode(`${id}-${i}`, x, y, kind));
    for (let i = 1; i < ids.length; i++) addEdge(ids[i - 1], ids[i]);
    if (closed) addEdge(ids.at(-1), ids[0]);
    return { id, points: points.map(([x, y]) => ({ x, y })), closed };
  };

  const loop = addRoute('loop', [
    [9, 14], [18, 8], [32, 7], [46, 11], [55, 21], [57, 35],
    [51, 48], [40, 56], [25, 58], [12, 51], [6, 39], [6, 25]
  ], { closed: true });
  const northLane = addRoute('north-lane', [[18, 8], [15, 15], [18, 23], [27, 26]]);
  const marketLane = addRoute('market-lane', [[46, 11], [43, 18], [48, 25], [45, 33], [53, 37]]);
  const civicLane = addRoute('civic-lane', [[12, 51], [17, 43], [26, 40], [33, 34]]);
  const southLane = addRoute('south-lane', [[40, 56], [39, 48], [35, 42], [34, 34]]);
  const pondWalk = addRoute('pond-walk', [[6, 39], [13, 35], [20, 34], [27, 26]], { kind: 'path' });
  const meadowWalk = addRoute('meadow-walk', [[25, 58], [25, 49], [29, 43], [35, 42]], { kind: 'path' });

  for (const [a, b] of [
    ['loop-1', 'north-lane-0'], ['loop-3', 'market-lane-0'], ['loop-6', 'market-lane-4'],
    ['loop-9', 'civic-lane-0'], ['loop-7', 'south-lane-0'], ['loop-10', 'pond-walk-0'],
    ['north-lane-3', 'pond-walk-3'], ['civic-lane-2', 'meadow-walk-2'],
    ['south-lane-2', 'meadow-walk-3'], ['civic-lane-3', 'south-lane-3']
  ]) addEdge(a, b);

  const nearest = (x, y, pool = nodes) => {
    let best = pool[0], distance = Infinity;
    for (const node of pool) {
      const d = (node.x - x) ** 2 + (node.y - y) ** 2;
      if (d < distance) { best = node; distance = d; }
    }
    return best.id;
  };

  const buildings = [], shops = [], connectors = [];
  const place = (id, kind, districtId, rect, label, door, rotation = 0) => {
    const h = hash32(id);
    const anchorId = nearest(door.x, door.y);
    const doorNodeId = addNode(`door-${id}`, door.x, door.y, 'door');
    addEdge(doorNodeId, anchorId);
    const anchor = nodeById.get(anchorId);
    connectors.push({ id: `walk-${id}`, points: [{ x: door.x, y: door.y }, { x: anchor.x, y: anchor.y }] });
    buildings.push({
      id, kind, districtId, rect, rotation,
      floors: kind === 'home' ? 2 + h % 2 : 2 + h % 3,
      palette: kind === 'civic'
        ? { wall: '#E6E0F5', roof: '#3B2F55', trim: '#FFF9F3' }
        : PALETTES[(h >>> 3) % PALETTES.length],
      roof: ROOFS[(h >>> 7) % ROOFS.length], label, doorNodeId
    });
    return buildings.at(-1);
  };

  const homes = [
    ['home-1', 10, 8, 4.2, 3.4, -0.12], ['home-2', 15.5, 5.5, 4.5, 3.5, 0.08],
    ['home-3', 21.5, 8, 4.2, 3.3, -0.04], ['home-4', 10, 17, 4, 3.5, 0.12],
    ['home-5', 15.5, 19.5, 4.3, 3.4, -0.08], ['home-6', 21, 21.5, 4.3, 3.4, 0.06],
    ['home-7', 49, 42, 4.2, 3.5, -0.1], ['home-8', 53.5, 46.5, 4.1, 3.4, 0.08],
    ['home-9', 44.5, 49, 4.3, 3.5, 0.04], ['home-10', 34.5, 53, 4.4, 3.5, -0.08],
    ['home-11', 27.5, 53.5, 4.2, 3.4, 0.1], ['home-12', 20.5, 50, 4.2, 3.5, -0.06]
  ];
  for (const [id, x, y, w, h, rotation] of homes) {
    place(id, 'home', x < 30 ? 'north-hamlet' : 'south-hamlet', { x, y, w, h }, null,
      { x: x + w / 2, y: y + h }, rotation);
  }

  const shopPlaces = [
    [44.5, 15, 4.6, 4, -0.08], [50, 17.5, 4.7, 4, 0.08], [45.5, 23.5, 4.5, 4, 0.11],
    [51, 28, 4.8, 4, -0.07], [45, 31, 4.8, 4, 0.05]
  ];
  SHOP_SPECS.forEach(([id, label, brandIds], i) => {
    const [x, y, w, h, rotation] = shopPlaces[i];
    const buildingId = `building-${id}`;
    const b = place(buildingId, 'shop', 'market', { x, y, w, h }, label,
      { x: x + w * 0.22, y: y + h }, rotation);
    shops.push({ id, buildingId, label, brandIds, doorNodeId: b.doorNodeId });
  });

  const civic = [
    ['campus-1', 'work', 'Town Library', 8.5, 31, 6.5, 4.2, -0.08],
    ['gym-1', 'work', 'Fold Athletic', 13.5, 37.5, 6.2, 4.1, 0.08],
    ['office-1', 'work', 'Ridgeway Offices', 29, 45.5, 7, 5, -0.04],
    ['cafe-1', 'social', 'The Kettle', 35.5, 27, 5.6, 4.2, 0.1],
    ['studio-1', 'work', 'Maker Studio', 38.5, 38, 6, 4.4, -0.08],
    ['civic-1', 'civic', 'Textile Bin & Resale', 23, 35.5, 6.5, 4.6, 0.05]
  ];
  for (const [id, kind, label, x, y, w, h, rotation] of civic) {
    place(id, kind, id === 'civic-1' ? 'commons' : 'village', { x, y, w, h }, label,
      { x: x + w / 2, y: y + h }, rotation);
  }

  const props = [];
  const prop = (kind, x, y, r) => props.push({ id: `${kind}-${props.length}`, kind, x, y, ...(r === undefined ? {} : { r }) });
  prop('fountain', 32.5, 22.5, 2);
  prop('bin', 25.3, 41.2);
  prop('kiosk', 28, 41);
  for (const [x, y] of [[29.5, 22], [35.5, 23], [30, 25], [35, 25], [11, 35], [16, 36], [24, 47]]) prop('bench', x, y);
  for (const [x, y] of [[38, 25], [40, 27], [41.8, 29]]) prop('table', x, y);
  for (const [x, y] of [[9, 29], [12, 30]]) prop('newsstand', x, y);
  for (const route of [loop, northLane, marketLane, civicLane, southLane]) {
    for (let i = 0; i < route.points.length; i += 2) {
      const p = route.points[i];
      prop('lamp', p.x + 1.8, p.y - 1.5);
    }
  }
  const treePoints = [
    [5, 8], [8, 7], [27, 12], [31, 14], [35, 13], [39, 9], [57, 10], [59, 15],
    [4, 18], [27, 18], [31, 18], [38, 18], [7, 46], [10, 43], [14, 46], [18, 44],
    [4, 55], [9, 57], [15, 55], [56, 55], [59, 49], [57, 40], [33, 31], [29, 30],
    [20, 29], [17, 32], [22, 32], [32, 60], [47, 57], [53, 58], [60, 30], [59, 34]
  ];
  for (const [x, y] of treePoints) prop('tree', x, y, 1.1);

  const spot = (id, x, y, kind, anchorId = nearest(x, y)) => {
    addNode(id, x, y, kind);
    addEdge(id, anchorId);
    return id;
  };
  const sites = [];
  const site = (id, kind, x, y, capacity, affords, nodeId, buildingId = null, label = null) =>
    sites.push({ id, kind, x, y, capacity, affords, nodeId, buildingId, label });

  for (const [id, kind, capacity, affords, nodeKind] of [
    ['office-1', 'work', 10, ['work'], 'work'],
    ['campus-1', 'work', 6, ['work', 'read'], 'work'],
    ['studio-1', 'work', 4, ['work'], 'work'],
    ['gym-1', 'gym', 5, ['workout'], 'social'],
    ['cafe-1', 'coffee', 4, ['coffee'], 'social']
  ]) {
    const b = buildings.find(v => v.id === id);
    const x = b.rect.x + b.rect.w / 2, y = b.rect.y + b.rect.h / 2;
    site(`site-${id}`, kind, x, y, capacity, affords,
      spot(`${nodeKind}-${id}`, x, y, nodeKind, b.doorNodeId), id, b.label);
  }

  const propSites = {
    bench: ['bench', 2, ['sit'], null, null],
    fountain: ['fountain', 6, ['gather', 'photo', 'sit'], null, 'Commons Fountain'],
    table: ['table', 2, ['coffee', 'sit'], 'cafe-1', 'The Kettle'],
    newsstand: ['newsstand', 1, ['read'], null, null],
    bin: ['bin', 2, ['dispose'], 'civic-1', 'Textile Bin'],
    kiosk: ['kiosk', 3, ['resell'], 'civic-1', 'Resale Kiosk']
  };
  for (const p of props) {
    const spec = propSites[p.kind];
    if (!spec) continue;
    const [kind, capacity, affords, buildingId, label] = spec;
    site(`site-${p.id}`, kind, p.x, p.y, capacity, affords, spot(`spot-${p.id}`, p.x, p.y, 'spot'), buildingId, label);
  }
  for (const s of shops) {
    const d = nodeById.get(s.doorNodeId);
    site(`site-browse-${s.id}`, 'browse', d.x, d.y + 0.8, 3, ['browse'],
      spot(`spot-${s.id}`, d.x, d.y + 0.8, 'spot', s.doorNodeId), s.buildingId, s.label);
  }
  site('site-transit-1', 'transit', 8, 21, 4, ['wait'],
    spot('transit-1', 8, 21, 'transit'), null, 'Ridgeway Bus Stop');

  const borderTiles = [];
  const tile = (side, x, y, w, h) => borderTiles.push({ index: borderTiles.length, side, x, y, w, h, brandId: null });
  for (let i = 0; i < 8; i++) tile('n', i * 8, 0, 8, RIM);
  for (let i = 0; i < 8; i++) tile('e', SIZE - RIM, i * 8, RIM, 8);
  for (let i = 0; i < 8; i++) tile('s', SIZE - (i + 1) * 8, SIZE - RIM, 8, RIM);
  for (let i = 0; i < 8; i++) tile('w', 0, SIZE - (i + 1) * 8, RIM, 8);
  BRAND_IDS.forEach((id, i) => { borderTiles[2 + i * 5].brandId = id; });

  return {
    size: SIZE, rim: RIM,
    roads: [loop, northLane, marketLane, civicLane, southLane],
    paths: [pondWalk, meadowWalk, ...connectors],
    districts: [
      { id: 'north-hamlet', label: 'North Hamlet', rect: { x: 6, y: 4, w: 22, h: 22 } },
      { id: 'market', label: 'Market Grove', rect: { x: 42, y: 12, w: 16, h: 25 } },
      { id: 'commons', label: 'The Commons', rect: { x: 25, y: 17, w: 15, h: 13 } },
      { id: 'west-park', label: 'West Park', rect: { x: 4, y: 27, w: 20, h: 21 } },
      { id: 'south-hamlet', label: 'South Hamlet', rect: { x: 18, y: 45, w: 40, h: 14 } }
    ],
    buildings, shops, props, sites, nodes, edges, borderTiles,
    homes: homes.map(([id]) => id)
  };
}
