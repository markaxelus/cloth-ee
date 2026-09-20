// 2.5D town board. The ground is baked once into an offscreen canvas; every frame is that image
// plus one depth-sorted pass over buildings, props and residents. The hot path allocates nothing:
// the draw order lives in preallocated typed arrays and the tint string is rebuilt only when its
// bucket changes, so 40 residents hold 60 fps without feeding the collector.

const GPX = 16;                      // ground bake resolution, px per world unit
const ISO_X = 0.78;
const ISO_Y = 0.39;
const DEPTH_PROPS = new Set(['tree', 'bench', 'lamp', 'fountain', 'bin', 'kiosk', 'table', 'newsstand']);
const SIT_KINDS = new Set(['sit', 'read', 'coffee']);
const SKY = ['#2B2450', '#7E6AA8', '#FFC9B5', '#FFF6E6', '#FFE2C2', '#6E5E9B'];  // night→night over a day
const TINT_AT = [0, 0.16, 0.26, 0.5, 0.8, 0.94];
const TINT_A = [0.34, 0.2, 0.15, 0, 0.16, 0.3];

const SKY_RGB = Int16Array.from(SKY.flatMap(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))));
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (i, j, k, t) => Math.round(lerp(SKY_RGB[i * 3 + k], SKY_RGB[j * 3 + k], t));

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintGround(layout, brandById) {
  const size = layout.size, cv = document.createElement('canvas');
  cv.width = cv.height = size * GPX;
  const ctx = cv.getContext('2d');
  ctx.scale(GPX, GPX);
  roundRect(ctx, 0, 0, size, size, 5);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#B9CDA8';
  ctx.fillRect(0, 0, size, size);

  for (const d of layout.districts) {
    const { x, y, w, h } = d.rect;
    ctx.globalAlpha = d.id === 'park' ? 0.95 : 0.72;
    ctx.fillStyle = d.id === 'park' ? '#79A96D' : d.id === 'plaza' ? '#D4C7AE' : d.id === 'homes' ? '#A9C297' : '#C0C4AD';
    ctx.beginPath();
    ctx.moveTo(x - 1, y + h * 0.25);
    ctx.bezierCurveTo(x + w * 0.12, y - 2.5, x + w * 0.7, y - 1.3, x + w + 1.8, y + h * 0.18);
    ctx.bezierCurveTo(x + w + 2.8, y + h * 0.62, x + w * 0.78, y + h + 2.2, x + w * 0.42, y + h + 1.3);
    ctx.bezierCurveTo(x + w * 0.08, y + h + 2.4, x - 2.4, y + h * 0.7, x - 1, y + h * 0.25);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const routePath = route => {
    const points = route.points;
    if (!points?.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i], next = points[i + 1];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
    }
    const last = points.at(-1);
    if (route.closed) {
      const first = points[0];
      ctx.quadraticCurveTo(last.x, last.y, first.x, first.y);
      ctx.closePath();
    } else if (points.length > 1) ctx.lineTo(last.x, last.y);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const path of layout.paths ?? []) {
    routePath(path);
    ctx.strokeStyle = '#E4D7B8';
    ctx.lineWidth = path.id?.startsWith('walk-') ? 0.7 : 1.15;
    ctx.stroke();
  }
  ctx.fillStyle = '#7FB5A7';
  ctx.beginPath();
  ctx.ellipse(14.5, 40.5, 3.2, 2.1, -0.18, 0, 6.2832);
  ctx.fill();
  ctx.strokeStyle = '#D8E7D4';
  ctx.lineWidth = 0.18;
  ctx.stroke();
  ctx.fillStyle = '#93B67E';
  for (const [x, y, rx, ry] of [[31, 15, 4.8, 2.8], [7, 55, 3.2, 2], [56, 8, 3.8, 2.2]]) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0.2, 0, 6.2832); ctx.fill();
  }

  for (const road of layout.roads ?? []) {
    routePath(road); ctx.strokeStyle = '#D8D0BE'; ctx.lineWidth = road.id === 'loop' ? 5.8 : 4.5; ctx.stroke();
    routePath(road); ctx.strokeStyle = '#6E7773'; ctx.lineWidth = road.id === 'loop' ? 4.5 : 3.25; ctx.stroke();
  }
  ctx.setLineDash([1.35, 1.1]);
  ctx.strokeStyle = '#E7DFC4'; ctx.lineWidth = 0.11;
  for (const road of layout.roads ?? []) { routePath(road); ctx.stroke(); }
  ctx.setLineDash([]);

  ctx.fillStyle = '#8CA37E';
  ctx.fillRect(0, 0, size, layout.rim);
  ctx.fillRect(0, size - layout.rim, size, layout.rim);
  ctx.fillRect(0, 0, layout.rim, size);
  ctx.fillRect(size - layout.rim, 0, layout.rim, size);
  for (const t of layout.borderTiles) {
    const b = t.brandId ? brandById.get(t.brandId) : null;
    if (!b) continue;
    ctx.save();
    ctx.translate(t.x + t.w / 2, t.y + t.h / 2);
    if (t.side === 'e') ctx.rotate(Math.PI / 2);
    if (t.side === 'w') ctx.rotate(-Math.PI / 2);
    if (t.side === 's') ctx.rotate(Math.PI);
    ctx.fillStyle = '#FFFCED';
    roundRect(ctx, -2.4, -1.2, 4.8, 2.4, 0.5); ctx.fill();
    ctx.strokeStyle = b.palette.base; ctx.lineWidth = 0.16; ctx.stroke();
    ctx.fillStyle = b.palette.ink;
    ctx.font = '700 1.25px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.patchText, 0, -0.35);
    // Band is 'unknown' for every brand until the investigator runs — grey, never a score.
    ctx.fillStyle = '#FFFFFFB0';
    roundRect(ctx, -1.5, 0.6, 3, 1.1, 0.55);
    ctx.fill();
    ctx.fillStyle = '#7F7590';
    ctx.font = '700 0.8px ui-rounded, system-ui, sans-serif';
    ctx.fillText(b.investigation.band ?? 'unknown', 0, 1.18);
    ctx.restore();
  }
  ctx.restore();
  return cv;
}

export function createRenderer(canvas, town, opts = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const layout = town.layout, residents = town.residents;
  const garmentById = town.garmentById, siteById = new Map((layout.sites ?? []).map(s => [s.id, s]));
  const reduced = !!opts.reduced;
  const onSelect = opts.onSelect ?? (() => {});
  const ground = paintGround(layout, town.brandById);
  const fountain = layout.props.find(p => p.kind === 'fountain') ?? null;
  const trafficPoints = layout.roads?.[0]?.points ?? [];
  const trafficSegments = trafficPoints.map((p, i) => {
    const q = trafficPoints[(i + 1) % trafficPoints.length];
    return { p, q, length: Math.hypot(q.x - p.x, q.y - p.y) };
  });
  const trafficLength = trafficSegments.reduce((sum, segment) => sum + segment.length, 0);

  const statics = [];
  for (const b of layout.buildings) statics.push({ depth: b.rect.x + b.rect.w / 2 + b.rect.y + b.rect.h, kind: 'building', ref: b });
  for (const p of layout.props) if (DEPTH_PROPS.has(p.kind)) statics.push({ depth: p.x + p.y, kind: p.kind, ref: p });
  statics.sort((a, b) => a.depth - b.depth);

  const n = residents.length;
  const order = new Int32Array(n).map((_, i) => i);
  const phase = new Float32Array(n), lastX = new Float32Array(n), lastY = new Float32Array(n);
  for (let i = 0; i < n; i++) { lastX[i] = residents[i].motion.x; lastY[i] = residents[i].motion.y; }

  const cam = { x: layout.size / 2, y: layout.size / 2, scale: 12 };
  let dpr = 1, vw = 1, vh = 1, selected = null, hovered = null, lit = 1, tintKey = -1, tintFill = 'rgba(0,0,0,0)';
  let personaFilter = null, roleFilter = null, beat = 0;

  function fit() {
    cam.x = layout.size / 2;
    cam.y = layout.size / 2;
    cam.scale = Math.min(
      vw / (layout.size * ISO_X * 2 + 8),
      vh / (layout.size * ISO_Y * 2 + 10)
    );
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    vw = Math.max(1, r.width); vh = Math.max(1, r.height);
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    if (cam.scale <= 0.01) fit();
  }

  function tintFor(f) {
    let i = TINT_AT.length - 1;
    while (i > 0 && f < TINT_AT[i]) i--;
    const j = (i + 1) % TINT_AT.length;
    const span = (TINT_AT[j] || 1) - TINT_AT[i];
    const t = span > 0 ? Math.min(1, Math.max(0, (f - TINT_AT[i]) / span)) : 0;
    const a = lerp(TINT_A[i], TINT_A[j], t);
    const key = (Math.round(a * 64) << 12) | (i << 4) | Math.round(t * 15);
    if (key !== tintKey) {
      tintKey = key;
      tintFill = `rgba(${mix(i, j, 0, t)},${mix(i, j, 1, t)},${mix(i, j, 2, t)},${a.toFixed(3)})`;
    }
    lit = Math.min(1, a * 2.6);
  }

  function project(x, y) {
    return {
      x: vw / 2 + ((x - cam.x) - (y - cam.y)) * cam.scale * ISO_X,
      y: vh / 2 + ((x - cam.x) + (y - cam.y)) * cam.scale * ISO_Y
    };
  }

  function unproject(x, y) {
    const ix = (x - vw / 2) / (cam.scale * ISO_X);
    const iy = (y - vh / 2) / (cam.scale * ISO_Y);
    return { x: cam.x + (ix + iy) / 2, y: cam.y + (iy - ix) / 2 };
  }

  function setGroundTransform(offsetY = 0) {
    const s = cam.scale, ox = vw / 2 - (cam.x - cam.y) * s * ISO_X;
    const oy = vh / 2 - (cam.x + cam.y) * s * ISO_Y + offsetY;
    ctx.setTransform(s * ISO_X * dpr, s * ISO_Y * dpr, -s * ISO_X * dpr, s * ISO_Y * dpr, ox * dpr, oy * dpr);
  }

  function setBillboardTransform(x, y) {
    const p = project(x, y), s = cam.scale;
    ctx.setTransform(s * dpr, 0, 0, s * dpr, (p.x - x * s) * dpr, (p.y - y * s) * dpr);
  }

  function drawBuilding(b) {
    const { x, y, w, h } = b.rect, H = b.floors * 0.78;
    const turn = b.rotation ?? ((([...b.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 9) - 4) * 0.008);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(turn);
    ctx.translate(-(x + w / 2), -(y + h / 2));
    const lift = Math.min(0.75, w * 0.12);
    ctx.fillStyle = 'rgba(31,44,38,0.22)';
    ctx.beginPath();
    ctx.moveTo(x + 0.4, y + h); ctx.lineTo(x + w + 0.8, y + h + 0.5);
    ctx.lineTo(x + w + 0.3, y + h + 0.9); ctx.lineTo(x - 0.2, y + h + 0.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = b.palette.wall;
    ctx.fillRect(x, y + h - H, w, H);
    ctx.fillStyle = 'rgba(45,38,54,0.17)';
    ctx.beginPath();
    ctx.moveTo(x + w, y + h - H); ctx.lineTo(x + w + lift, y + h - H - lift * 0.55);
    ctx.lineTo(x + w + lift, y + h - lift * 0.55); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();

    ctx.fillStyle = b.palette.roof;
    if (b.roof === 'gable') {
      ctx.beginPath();
      ctx.moveTo(x - 0.25, y + h - H); ctx.lineTo(x + w / 2, y + h - H - 1.05);
      ctx.lineTo(x + w + 0.35, y + h - H); ctx.lineTo(x + w / 2, y + h - H + 0.45); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.34)'; ctx.lineWidth = 0.09;
      ctx.beginPath(); ctx.moveTo(x + w / 2, y + h - H - 1.05); ctx.lineTo(x + w / 2, y + h - H + 0.45); ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x - 0.22, y + h - H); ctx.lineTo(x + lift, y + h - H - lift * 0.55);
      ctx.lineTo(x + w + lift, y + h - H - lift * 0.55); ctx.lineTo(x + w + 0.22, y + h - H + 0.34);
      ctx.lineTo(x - 0.22, y + h - H + 0.34); ctx.closePath(); ctx.fill();
      if (b.roof === 'mansard') {
        ctx.fillStyle = 'rgba(59,47,85,0.18)';
        ctx.fillRect(x + 0.35, y + h - H + 0.3, w - 0.7, 0.5);
      }
    }
    ctx.fillStyle = b.palette.trim;
    ctx.fillRect(x, y + h - 0.3, w, 0.3);
    const cols = Math.max(2, Math.round(w / 1.7)), rows = Math.max(1, b.floors - 1);
    const cw = w / (cols + 1), ch = H / (rows + 1.3);
    ctx.fillStyle = lit > 0.35 ? '#F9CB73' : '#B9DCE7';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const wx = x + cw * (c + 0.65), wy = y + h - H + ch * (r + 0.55);
      ctx.fillRect(wx, wy, cw * 0.7, ch * 0.62);
      ctx.strokeStyle = '#FFFFFF8A'; ctx.lineWidth = 0.06; ctx.strokeRect(wx, wy, cw * 0.7, ch * 0.62);
    }
    const doorH = Math.min(1.55, H * 0.5);
    ctx.fillStyle = '#554B42';
    ctx.fillRect(x + w / 2 - 0.38, y + h - doorH, 0.76, doorH);
    ctx.fillStyle = '#F5C868'; ctx.beginPath(); ctx.arc(x + w / 2 + 0.2, y + h - doorH * 0.48, 0.05, 0, 6.2832); ctx.fill();
    if (b.kind === 'shop') {
      const awningY = y + h - Math.min(2.1, H * 0.62);
      ctx.fillStyle = '#FFF5DF'; ctx.fillRect(x + 0.15, awningY, w - 0.3, 0.48);
      ctx.fillStyle = b.palette.roof;
      const stripe = (w - 0.3) / 7;
      for (let i = 0; i < 7; i += 2) ctx.fillRect(x + 0.15 + i * stripe, awningY, stripe, 0.48);
      ctx.fillStyle = '#25483E';
      roundRect(ctx, x + 0.35, awningY - 0.72, w - 0.7, 0.56, 0.12); ctx.fill();
      ctx.fillStyle = '#FFFBEF'; ctx.font = '700 0.48px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.label, x + w / 2, awningY - 0.44, w - 1);
    }
    if (b.label && cam.scale > 9) {
      ctx.fillStyle = '#24483E';
      ctx.font = '750 0.8px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      if (b.kind !== 'shop') ctx.fillText(b.label, x + w / 2, y + h - H - 1.2);
    }
    ctx.restore();
  }

  function drawProp(kind, p) {
    ctx.fillStyle = 'rgba(59,47,85,0.10)';
    if (kind !== 'lamp') { ctx.beginPath(); ctx.ellipse(p.x, p.y + 0.12, (p.r ?? 0.6) * 0.8, (p.r ?? 0.6) * 0.34, 0, 0, 6.2832); ctx.fill(); }
    if (kind === 'tree') {
      ctx.fillStyle = '#9A7B5A';
      ctx.fillRect(p.x - 0.13, p.y - 1.1, 0.26, 1.1);
      ctx.fillStyle = '#7FC29C';
      ctx.beginPath(); ctx.arc(p.x, p.y - 1.75, 0.95, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#BDE8D3';
      ctx.beginPath(); ctx.arc(p.x - 0.3, p.y - 2.05, 0.55, 0, 6.2832); ctx.fill();
    } else if (kind === 'bench') {
      ctx.fillStyle = '#C79A6A';
      ctx.fillRect(p.x - 0.95, p.y - 0.62, 1.9, 0.34);
      ctx.fillStyle = '#A97F52';
      ctx.fillRect(p.x - 0.95, p.y - 1.15, 1.9, 0.3);
      ctx.fillRect(p.x - 0.8, p.y - 0.3, 0.2, 0.3);
      ctx.fillRect(p.x + 0.6, p.y - 0.3, 0.2, 0.3);
    } else if (kind === 'lamp') {
      ctx.fillStyle = '#8D82A6';
      ctx.fillRect(p.x - 0.09, p.y - 2.4, 0.18, 2.4);
      ctx.fillStyle = lit > 0.3 ? '#FFE9A8' : '#E4EAF2';
      ctx.beginPath(); ctx.arc(p.x, p.y - 2.55, 0.34, 0, 6.2832); ctx.fill();
      if (lit > 0.3) { ctx.globalAlpha = 0.16 * lit; ctx.beginPath(); ctx.arc(p.x, p.y - 2.3, 1.7, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1; }
    } else if (kind === 'fountain') {
      ctx.fillStyle = '#E7DFF0';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r ?? 2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#BFE3FF';
      ctx.beginPath(); ctx.arc(p.x, p.y, (p.r ?? 2) * 0.72, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#E7DFF0';
      ctx.fillRect(p.x - 0.22, p.y - 1.5, 0.44, 1.5);
      ctx.fillStyle = '#FFFFFFB4';
      const s = reduced ? 0.5 : 0.5 + 0.28 * Math.sin(beat);
      ctx.beginPath(); ctx.arc(p.x, p.y - 1.7, 0.42 + s * 0.2, 0, 6.2832); ctx.fill();
    } else if (kind === 'bin') {
      ctx.fillStyle = '#7F93B5';
      roundRect(ctx, p.x - 0.42, p.y - 1.1, 0.84, 1.1, 0.18); ctx.fill();
      ctx.fillStyle = '#5E7295';
      ctx.fillRect(p.x - 0.52, p.y - 1.28, 1.04, 0.22);
    } else if (kind === 'kiosk') {
      ctx.fillStyle = '#FFF3DD';
      roundRect(ctx, p.x - 0.8, p.y - 1.5, 1.6, 1.5, 0.2); ctx.fill();
      ctx.fillStyle = '#FFC9B5';
      ctx.fillRect(p.x - 0.95, p.y - 1.75, 1.9, 0.34);
    } else if (kind === 'table') {
      ctx.fillStyle = '#FFFDF8';
      ctx.beginPath(); ctx.arc(p.x, p.y - 0.42, 0.55, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#D8CBE6';
      ctx.beginPath(); ctx.arc(p.x - 0.95, p.y - 0.3, 0.26, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.arc(p.x + 0.95, p.y - 0.3, 0.26, 0, 6.2832); ctx.fill();
    } else if (kind === 'newsstand') {
      ctx.fillStyle = '#B9A4DD';
      roundRect(ctx, p.x - 0.5, p.y - 1.2, 1, 1.2, 0.16); ctx.fill();
      ctx.fillStyle = '#FFF9F3';
      ctx.fillRect(p.x - 0.38, p.y - 1.05, 0.76, 0.5);
    }
  }

  function drawVehicle(x, y, angle, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(25,35,31,0.22)';
    ctx.beginPath(); ctx.ellipse(0.12, 0.22, 0.92, 0.36, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#303936';
    for (const wx of [-0.55, 0.55]) {
      ctx.fillRect(wx - 0.18, -0.42, 0.36, 0.16);
      ctx.fillRect(wx - 0.18, 0.27, 0.36, 0.16);
    }
    ctx.fillStyle = color;
    roundRect(ctx, -0.9, -0.35, 1.8, 0.7, 0.28); ctx.fill();
    ctx.fillStyle = '#B9DDE3';
    roundRect(ctx, -0.35, -0.3, 0.72, 0.6, 0.18); ctx.fill();
    ctx.fillStyle = '#FFF0B8';
    ctx.fillRect(0.74, -0.24, 0.11, 0.14);
    ctx.fillRect(0.74, 0.1, 0.11, 0.14);
    ctx.restore();
  }

  function trafficAt(fraction) {
    let distance = ((fraction % 1) + 1) % 1 * trafficLength;
    for (const segment of trafficSegments) {
      if (distance <= segment.length) {
        const t = distance / segment.length;
        return {
          x: lerp(segment.p.x, segment.q.x, t),
          y: lerp(segment.p.y, segment.q.y, t),
          angle: Math.atan2(segment.q.y - segment.p.y, segment.q.x - segment.p.x)
        };
      }
      distance -= segment.length;
    }
    return { x: 0, y: 0, angle: 0 };
  }

  function glyph(kind, x, y) {
    ctx.beginPath();
    if (kind === 'influencer') { for (let i = 0; i < 8; i++) { const a = i * 0.7854, r = i % 2 ? 0.1 : 0.26; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); }
    else if (kind === 'office') { ctx.rect(x - 0.2, y - 0.13, 0.4, 0.28); }
    else if (kind === 'student') { ctx.moveTo(x - 0.22, y + 0.14); ctx.lineTo(x, y - 0.16); ctx.lineTo(x + 0.22, y + 0.14); ctx.closePath(); }
    else if (kind === 'barista') { ctx.moveTo(x - 0.17, y - 0.15); ctx.lineTo(x + 0.17, y - 0.15); ctx.lineTo(x + 0.1, y + 0.16); ctx.lineTo(x - 0.1, y + 0.16); ctx.closePath(); }
    else if (kind === 'shopStaff') { ctx.moveTo(x, y - 0.2); ctx.lineTo(x + 0.2, y); ctx.lineTo(x, y + 0.2); ctx.lineTo(x - 0.2, y); ctx.closePath(); }
    else if (kind === 'courier') { ctx.moveTo(x - 0.2, y - 0.18); ctx.lineTo(x + 0.06, y); ctx.lineTo(x - 0.2, y + 0.18); ctx.lineTo(x - 0.06, y); ctx.closePath(); }
    else if (kind === 'retiree') { ctx.ellipse(x, y, 0.2, 0.13, -0.6, 0, 6.2832); }
    else { ctx.arc(x, y, 0.17, 0, 6.2832); }
    ctx.fill();
  }

  const colourOf = (id, key) => { const g = id ? garmentById.get(id) : null; return g ? g.colors[key] : null; };

  function drawResident(r, i) {
    const m = r.motion, o = r.outfit;
    ctx.save();
    const residentScale = selected === r.id ? 2.05 : hovered === r.id ? 1.9 : 1.65;
    ctx.translate(m.x, m.y);
    ctx.scale(residentScale, residentScale);
    ctx.translate(-m.x, -m.y);
    const dimmed = (personaFilter && !personaFilter.has(r.personaId)) || (roleFilter && !roleFilter.has(r.roleId));
    if (dimmed) ctx.globalAlpha = 0.18;
    const dx = m.x - lastX[i], dy = m.y - lastY[i], moved = Math.hypot(dx, dy);
    lastX[i] = m.x; lastY[i] = m.y;
    if (!reduced) phase[i] += moved * 2.6 + 0.02;
    const walking = moved > 0.0005;
    const swing = walking && !reduced ? Math.sin(phase[i]) : 0;
    const kind = r.activity?.kind ?? null;
    const site = kind && r.activity.siteId ? siteById.get(r.activity.siteId) : null;
    const seated = SIT_KINDS.has(kind) && site && (site.kind === 'bench' || site.kind === 'table' || site.kind === 'fountain');
    const scale = r.body.heightScale;
    const base = m.y, hipY = base - 0.62 * scale - (seated ? -0.18 : 0);
    const torsoTop = hipY - 0.66 * scale, headY = torsoTop - 0.3 * scale;
    const bottomC = colourOf(o.bottom, 'base') ?? '#8C7FA6';
    const topC = colourOf(o.top, 'base') ?? '#CFC7DD';
    const topG = o.top ? garmentById.get(o.top) : null;

    ctx.fillStyle = 'rgba(59,47,85,0.13)';
    ctx.beginPath(); ctx.ellipse(m.x, base + 0.05, 0.34, 0.13, 0, 0, 6.2832); ctx.fill();

    ctx.fillStyle = bottomC;
    if (seated) {
      ctx.fillRect(m.x - 0.2, hipY, 0.62, 0.22);
      ctx.fillRect(m.x + 0.24, hipY, 0.2, 0.5);
    } else {
      ctx.fillRect(m.x - 0.21 + swing * 0.07, hipY - 0.05, 0.19, 0.68 * scale);
      ctx.fillRect(m.x + 0.02 - swing * 0.07, hipY - 0.05, 0.19, 0.68 * scale);
      const shoeC = colourOf(o.shoes, 'base');
      if (shoeC) {
        ctx.fillStyle = shoeC;
        ctx.fillRect(m.x - 0.24 + swing * 0.07, base - 0.13, 0.24, 0.15);
        ctx.fillRect(m.x + 0.01 - swing * 0.07, base - 0.13, 0.24, 0.15);
      }
    }

    ctx.fillStyle = topC;
    roundRect(ctx, m.x - 0.28, torsoTop, 0.56, hipY - torsoTop + 0.06, 0.16);
    ctx.fill();
    const outerC = colourOf(o.outer, 'base');
    if (outerC) {
      ctx.fillStyle = outerC;
      ctx.fillRect(m.x - 0.34, torsoTop + 0.02, 0.19, hipY - torsoTop + 0.02);
      ctx.fillRect(m.x + 0.15, torsoTop + 0.02, 0.19, hipY - torsoTop + 0.02);
      ctx.fillRect(m.x - 0.34, torsoTop + 0.02, 0.68, 0.14);
    }
    if (topG?.patch && topG.patch.placement === 'chest') {
      ctx.fillStyle = topG.colors.accent;
      ctx.fillRect(m.x - 0.07, torsoTop + 0.22, 0.14, 0.09);
    }
    const scarfC = colourOf(o.scarf, 'base');
    if (scarfC) { ctx.fillStyle = scarfC; ctx.fillRect(m.x - 0.22, torsoTop - 0.04, 0.44, 0.13); }

    ctx.fillStyle = topC;
    if (kind === 'photo') {
      ctx.fillRect(m.x + 0.2, headY - 0.18, 0.13, 0.5);
      ctx.fillStyle = '#3B2F55';
      ctx.fillRect(m.x + 0.16, headY - 0.42, 0.24, 0.3);
    } else {
      ctx.fillRect(m.x - 0.36, torsoTop + 0.1, 0.12, 0.44);
      ctx.fillRect(m.x + 0.24, torsoTop + 0.1, 0.12, 0.44);
    }

    ctx.fillStyle = r.body.skin;
    ctx.beginPath(); ctx.arc(m.x, headY, 0.25 * scale, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#3A342F';
    ctx.beginPath(); ctx.arc(m.x - 0.08, headY + 0.01, 0.025, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(m.x + 0.08, headY + 0.01, 0.025, 0, 6.2832); ctx.fill();
    ctx.fillStyle = r.body.hair.color;
    ctx.beginPath();
    ctx.arc(m.x, headY - 0.04, 0.26 * scale, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    if (r.body.hair.style === 'long') ctx.fillRect(m.x - 0.26, headY - 0.05, 0.52, 0.3);
    if (r.body.hair.style === 'bun') { ctx.beginPath(); ctx.arc(m.x, headY - 0.3, 0.12, 0, 6.2832); ctx.fill(); }
    const hatC = colourOf(o.hat, 'base');
    if (hatC) {
      ctx.fillStyle = hatC;
      ctx.fillRect(m.x - 0.3, headY - 0.14, 0.6, 0.1);
      ctx.fillRect(m.x - 0.21, headY - 0.34, 0.42, 0.22);
    }
    if (o.glasses) { ctx.fillStyle = colourOf(o.glasses, 'accent') ?? '#3B2F55'; ctx.fillRect(m.x - 0.2, headY - 0.03, 0.4, 0.07); }

    if (r.roleId === 'courier' && walking && !reduced) {
      ctx.strokeStyle = 'rgba(59,47,85,0.28)';
      ctx.lineWidth = 0.06;
      const ux = moved ? -dx / moved : -1, uy = moved ? -dy / moved : 0;
      for (let k = 1; k <= 3; k++) {
        ctx.beginPath();
        ctx.moveTo(m.x + ux * (0.3 + k * 0.22) - uy * 0.14, torsoTop + 0.2 + uy * (0.3 + k * 0.22) + ux * 0.14);
        ctx.lineTo(m.x + ux * (0.62 + k * 0.22) - uy * 0.14, torsoTop + 0.2 + uy * (0.62 + k * 0.22) + ux * 0.14);
        ctx.stroke();
      }
    }

    ctx.fillStyle = selected === r.id ? '#F2A25B' : hovered === r.id ? '#397662' : '#FFFEF0';
    ctx.strokeStyle = selected === r.id ? '#FFF3D8' : '#31594C';
    ctx.lineWidth = 0.06;
    ctx.beginPath(); ctx.arc(m.x, headY - 0.64, 0.3, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.fillStyle = selected === r.id ? '#4B3020' : '#31594C';
    glyph(r.roleId, m.x, headY - 0.62);

    if (selected === r.id) {
      ctx.strokeStyle = '#F2A25B';
      ctx.lineWidth = 0.12;
      ctx.beginPath(); ctx.ellipse(m.x, base + 0.05, 0.62, 0.26, 0, 0, 6.2832); ctx.stroke();
    }
    if (selected === r.id || hovered === r.id) {
      const labelW = Math.max(2.9, Math.min(4.8, r.name.length * 0.43));
      ctx.fillStyle = selected === r.id ? '#173F35F2' : '#FFFEF2F2';
      roundRect(ctx, m.x - labelW / 2, headY - 1.92, labelW, 0.95, 0.34); ctx.fill();
      ctx.fillStyle = selected === r.id ? '#FFFFFF' : '#24483E';
      ctx.font = '750 0.63px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.name, m.x, headY - 1.58);
      ctx.fillStyle = selected === r.id ? '#BFE8D6' : '#668076';
      ctx.font = '600 0.38px ui-rounded, system-ui, sans-serif';
      ctx.fillText((r.activity?.kind ?? 'walking').replace('-', ' '), m.x, headY - 1.25);
    }
    if (dimmed) ctx.globalAlpha = 1;
    ctx.restore();
  }

  function draw(clock) {
    const f = clock?.dayFraction ?? 0.5;
    beat += 0.05;
    tintFor(f);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    const s = cam.scale;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    setGroundTransform(18);
    ctx.fillStyle = 'rgba(38,45,52,0.2)';
    roundRect(ctx, 0, 0, layout.size, layout.size, 5);
    ctx.fill();
    setGroundTransform();
    ctx.drawImage(ground, 0, 0, layout.size, layout.size);

    if (trafficLength) {
      const trafficT = (clock?.seconds ?? 0) / 90;
      for (const [offset, color] of [[0, '#D46F5F'], [0.34, '#E3B554'], [0.68, '#4B8A87']]) {
        const car = trafficAt(trafficT + offset);
        drawVehicle(car.x, car.y, car.angle, color);
      }
    }

    let gathering = 0;
    for (let i = 0; i < n; i++) if (residents[i].activity?.kind === 'gather') gathering++;
    if (fountain && gathering >= 2) {
      ctx.strokeStyle = 'rgba(185,164,221,0.75)';
      ctx.lineWidth = 0.16;
      ctx.setLineDash([0.7, 0.5]);
      ctx.beginPath(); ctx.arc(fountain.x, fountain.y, (fountain.r ?? 2) + 1.4, 0, 6.2832); ctx.stroke();
      ctx.setLineDash([]);
    }

    for (let a = 1; a < n; a++) {
      const v = order[a], depth = residents[v].motion.x + residents[v].motion.y;
      let b = a - 1;
      while (b >= 0 && residents[order[b]].motion.x + residents[order[b]].motion.y > depth) { order[b + 1] = order[b]; b--; }
      order[b + 1] = v;
    }

    let si = 0, ri = 0;
    while (si < statics.length || ri < n) {
      const sy = si < statics.length ? statics[si].depth : Infinity;
      const idx = ri < n ? order[ri] : -1;
      const ry = idx >= 0 ? residents[idx].motion.x + residents[idx].motion.y : Infinity;
      if (sy <= ry) {
        const it = statics[si++];
        const anchor = it.kind === 'building'
          ? { x: it.ref.rect.x + it.ref.rect.w / 2, y: it.ref.rect.y + it.ref.rect.h }
          : it.ref;
        setBillboardTransform(anchor.x, anchor.y);
        if (it.kind === 'building') drawBuilding(it.ref); else drawProp(it.kind, it.ref);
      } else {
        const m = residents[idx].motion;
        setBillboardTransform(m.x, m.y);
        drawResident(residents[idx], idx);
        ri++;
      }
    }

    setGroundTransform();
    ctx.fillStyle = tintFill;
    roundRect(ctx, 0, 0, layout.size, layout.size, 5);
    ctx.fill();
  }

  function pickAt(px, py) {
    let best = null, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const m = residents[i].motion, p = project(m.x, m.y);
      const d = Math.hypot(p.x - px, p.y - cam.scale * 0.85 - py);
      if (d < bd) { bd = d; best = residents[i].id; }
    }
    return best;
  }

  let down = null, dragged = false;
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => {
    const [x, y] = pos(e);
    down = { x, y, cx: cam.x, cy: cam.y, moved: 0 };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', e => {
    const [x, y] = pos(e);
    if (!down) {
      hovered = pickAt(x, y);
      canvas.style.cursor = hovered ? 'pointer' : 'grab';
      return;
    }
    down.moved = Math.max(down.moved, Math.hypot(x - down.x, y - down.y));
    const delta = unproject(x, y);
    const origin = unproject(down.x, down.y);
    cam.x = down.cx - (delta.x - origin.x);
    cam.y = down.cy - (delta.y - origin.y);
  });
  canvas.addEventListener('pointerleave', () => { if (!down) hovered = null; });
  const up = e => {
    if (!down) return;
    dragged = down.moved >= 5;
    down = null;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('click', e => {
    if (dragged) { dragged = false; return; }
    const [x, y] = pos(e);
    onSelect(pickAt(x, y));
  });
  canvas.addEventListener('pointercancel', () => { down = null; canvas.classList.remove('dragging'); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * 0.0016), ...pos(e));
  }, { passive: false });

  function zoomAt(factor, px = vw / 2, py = vh / 2) {
    const before = unproject(px, py);
    cam.scale = Math.min(48, Math.max(5, cam.scale * factor));
    const after = unproject(px, py);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement ?? canvas);
  resize();
  fit();

  return {
    draw, resize, fit, zoomAt, cam,
    setSelected(id) { selected = id ?? null; hovered = null; },
    focusOn(id) { const r = residents.find(v => v.id === id); if (r) { cam.x = r.motion.x; cam.y = r.motion.y; cam.scale = Math.max(cam.scale, 22); } },
    setFilter(personas, roles) { personaFilter = personas?.size ? personas : null; roleFilter = roles?.size ? roles : null; },
    destroy() { ro.disconnect(); }
  };
}
