// The 512 px front-facing capture: this canvas IS the image the future scan pipeline sends, so
// nothing is annotated onto it that a camera could not see. Patch text is drawn as real text at
// real size from the SAME masked string `readPatch()` produced — what looks readable here is
// exactly what the observation calls readable.

const PATCH_BOX = { small: 0.44, medium: 0.6, large: 0.8 };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pattern(ctx, kind, x, y, w, h, accent) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.5;
  const step = Math.max(6, w / 7);
  ctx.lineWidth = Math.max(1, w * 0.016);
  if (kind === 'leafline') {
    for (let px = x + step / 2; px < x + w; px += step) {
      ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke();
      for (let py = y + step * 0.6; py < y + h; py += step * 1.2) {
        ctx.beginPath(); ctx.ellipse(px + step * 0.18, py, step * 0.16, step * 0.07, -0.6, 0, 6.2832); ctx.fill();
      }
    }
  } else if (kind === 'herringbone') {
    for (let py = y; py < y + h; py += step * 0.7) for (let px = x; px < x + w; px += step * 0.7) {
      ctx.beginPath(); ctx.moveTo(px, py + step * 0.5); ctx.lineTo(px + step * 0.35, py); ctx.lineTo(px + step * 0.7, py + step * 0.5); ctx.stroke();
    }
  } else if (kind === 'confetti') {
    let k = 0;
    for (let py = y; py < y + h; py += step * 0.62) for (let px = x; px < x + w; px += step * 0.62) {
      const j = (k++ * 2654435761 % 1000) / 1000;
      ctx.beginPath(); ctx.arc(px + j * step * 0.4, py + (1 - j) * step * 0.4, step * 0.1, 0, 6.2832); ctx.fill();
    }
  } else if (kind === 'twill') {
    for (let o = -h; o < w; o += step * 0.55) {
      ctx.beginPath(); ctx.moveTo(x + o, y + h); ctx.lineTo(x + o + h, y); ctx.stroke();
    }
  } else if (kind === 'wave') {
    for (let py = y + step * 0.4; py < y + h; py += step * 0.7) {
      ctx.beginPath();
      for (let px = x; px <= x + w; px += 3) ctx.lineTo(px, py + Math.sin(px / step * 2) * step * 0.16);
      ctx.stroke();
    }
  } else if (kind === 'chevron') {
    for (let py = y; py < y + h; py += step * 0.8) for (let px = x; px < x + w; px += step) {
      ctx.beginPath(); ctx.moveTo(px, py + step * 0.4); ctx.lineTo(px + step * 0.5, py); ctx.lineTo(px + step, py + step * 0.4); ctx.stroke();
    }
  }
  ctx.restore();
}

// legibility drives size, ink and focus together, the way a real crop degrades.
function patchText(ctx, text, legibility, cx, cy, boxW, ink) {
  if (!text) return;
  const chars = Math.max(text.length, 1);
  const size = Math.min(22, Math.max(8, boxW / (chars * 0.62)));
  ctx.save();
  ctx.font = `700 ${size.toFixed(1)}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.4 + 0.6 * legibility;
  if (legibility < 0.62 && 'filter' in ctx) ctx.filter = `blur(${((0.62 - legibility) * 2.4).toFixed(2)}px)`;
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

export function renderPortrait(resident, town, size = 512, patches = null) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const byId = town.garmentById ?? new Map((town.garments ?? []).map(g => [g.id, g]));
  const g = slot => (resident.outfit?.[slot] ? byId.get(resident.outfit[slot]) : null) ?? null;
  const seen = slot => patches?.[slot] ?? null;

  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, '#F3EFEA');
  bg.addColorStop(1, '#E6E0DA');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const top = size * 0.035, bodyH = size - top - size * 0.03, cx = size / 2;
  const headH = bodyH * 0.2, headW = headH * 0.82;
  const shoulderY = top + headH + bodyH * 0.025;
  const hipY = top + bodyH * 0.56, kneeY = top + bodyH * 0.78, ankleY = top + bodyH * 0.955;
  const torsoW = bodyH * 0.33, legW = torsoW * 0.36;

  ctx.fillStyle = 'rgba(59,47,85,0.13)';
  ctx.beginPath();
  ctx.ellipse(cx, ankleY + size * 0.045, torsoW * 0.75, size * 0.022, 0, 0, 6.2832);
  ctx.fill();

  const bottom = g('bottom');
  if (bottom) {
    ctx.fillStyle = bottom.colors.base;
    const skirt = bottom.silhouette === 'skirt', shortLeg = bottom.silhouette === 'shorts';
    const hem = skirt || shortLeg ? kneeY - (skirt ? 0 : bodyH * 0.06) : ankleY;
    if (skirt) {
      ctx.beginPath();
      ctx.moveTo(cx - torsoW * 0.42, hipY - bodyH * 0.06);
      ctx.lineTo(cx + torsoW * 0.42, hipY - bodyH * 0.06);
      ctx.lineTo(cx + torsoW * 0.62, hem);
      ctx.lineTo(cx - torsoW * 0.62, hem);
      ctx.closePath();
      ctx.fill();
      pattern(ctx, bottom.pattern, cx - torsoW * 0.62, hipY - bodyH * 0.06, torsoW * 1.24, hem - hipY + bodyH * 0.06, bottom.colors.accent);
    } else {
      roundRect(ctx, cx - torsoW * 0.44, hipY - bodyH * 0.06, legW, hem - hipY + bodyH * 0.06, legW * 0.22); ctx.fill();
      roundRect(ctx, cx + torsoW * 0.44 - legW, hipY - bodyH * 0.06, legW, hem - hipY + bodyH * 0.06, legW * 0.22); ctx.fill();
      pattern(ctx, bottom.pattern, cx - torsoW * 0.44, hipY, legW, hem - hipY, bottom.colors.accent);
      pattern(ctx, bottom.pattern, cx + torsoW * 0.44 - legW, hipY, legW, hem - hipY, bottom.colors.accent);
    }
    if (skirt || shortLeg) {
      ctx.fillStyle = resident.body.skin;
      ctx.fillRect(cx - torsoW * 0.4, hem, legW * 0.8, ankleY - hem);
      ctx.fillRect(cx + torsoW * 0.4 - legW * 0.8, hem, legW * 0.8, ankleY - hem);
    }
    const hp = seen('bottom');
    if (hp?.text) patchText(ctx, hp.text, hp.patchLegibility ?? hp.legibility ?? 1, cx, hipY + bodyH * 0.02, torsoW * 0.5, bottom.colors.accent);
  }

  const shoes = g('shoes');
  if (shoes) {
    ctx.fillStyle = shoes.colors.base;
    const boot = shoes.silhouette === 'boots', h = boot ? bodyH * 0.1 : bodyH * 0.05;
    roundRect(ctx, cx - torsoW * 0.47, ankleY - h, legW * 1.1, h + size * 0.03, size * 0.014); ctx.fill();
    roundRect(ctx, cx + torsoW * 0.47 - legW * 1.1, ankleY - h, legW * 1.1, h + size * 0.03, size * 0.014); ctx.fill();
    const sp = seen('shoes');
    if (sp?.text) patchText(ctx, sp.text, sp.patchLegibility ?? sp.legibility ?? 1, cx - torsoW * 0.47 + legW * 0.55, ankleY + size * 0.008, legW, shoes.colors.accent);
  }

  ctx.fillStyle = resident.body.skin;
  ctx.fillRect(cx - headW * 0.17, shoulderY - bodyH * 0.035, headW * 0.34, bodyH * 0.05);

  const topG = g('top');
  if (topG) {
    ctx.fillStyle = topG.colors.base;
    roundRect(ctx, cx - torsoW / 2, shoulderY, torsoW, hipY - shoulderY, torsoW * 0.14);
    ctx.fill();
    pattern(ctx, topG.pattern, cx - torsoW / 2, shoulderY, torsoW, hipY - shoulderY, topG.colors.accent);
    ctx.fillStyle = topG.colors.accent;
    if (topG.silhouette === 'buttonShirt') {
      ctx.fillRect(cx - torsoW * 0.02, shoulderY + bodyH * 0.01, torsoW * 0.04, hipY - shoulderY - bodyH * 0.02);
      ctx.beginPath(); ctx.moveTo(cx, shoulderY); ctx.lineTo(cx - torsoW * 0.2, shoulderY + bodyH * 0.035); ctx.lineTo(cx, shoulderY + bodyH * 0.02); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, shoulderY); ctx.lineTo(cx + torsoW * 0.2, shoulderY + bodyH * 0.035); ctx.lineTo(cx, shoulderY + bodyH * 0.02); ctx.closePath(); ctx.fill();
    } else if (topG.silhouette === 'knit') {
      ctx.globalAlpha = 0.6;
      ctx.fillRect(cx - torsoW / 2, hipY - bodyH * 0.035, torsoW, bodyH * 0.035);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = topG.colors.base;
    roundRect(ctx, cx - torsoW * 0.72, shoulderY + bodyH * 0.01, torsoW * 0.22, bodyH * 0.24, torsoW * 0.1); ctx.fill();
    roundRect(ctx, cx + torsoW * 0.5, shoulderY + bodyH * 0.01, torsoW * 0.22, bodyH * 0.24, torsoW * 0.1); ctx.fill();
  }
  ctx.fillStyle = resident.body.skin;
  ctx.beginPath(); ctx.arc(cx - torsoW * 0.61, shoulderY + bodyH * 0.27, torsoW * 0.1, 0, 6.2832); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + torsoW * 0.61, shoulderY + bodyH * 0.27, torsoW * 0.1, 0, 6.2832); ctx.fill();

  const outer = g('outer');
  if (outer) {
    ctx.fillStyle = outer.colors.base;
    const oh = (outer.silhouette === 'coat' ? hipY + bodyH * 0.16 : hipY + bodyH * 0.03) - shoulderY;
    roundRect(ctx, cx - torsoW * 0.76, shoulderY - bodyH * 0.006, torsoW * 0.5, oh, torsoW * 0.1); ctx.fill();
    roundRect(ctx, cx + torsoW * 0.26, shoulderY - bodyH * 0.006, torsoW * 0.5, oh, torsoW * 0.1); ctx.fill();
    pattern(ctx, outer.pattern, cx - torsoW * 0.76, shoulderY, torsoW * 0.5, oh, outer.colors.accent);
    pattern(ctx, outer.pattern, cx + torsoW * 0.26, shoulderY, torsoW * 0.5, oh, outer.colors.accent);
    ctx.fillStyle = outer.colors.accent;
    ctx.fillRect(cx - torsoW * 0.76, shoulderY - bodyH * 0.006, torsoW * 0.5, bodyH * 0.02);
    ctx.fillRect(cx + torsoW * 0.26, shoulderY - bodyH * 0.006, torsoW * 0.5, bodyH * 0.02);
    const op = seen('outer');
    if (op?.text) patchText(ctx, op.text, op.patchLegibility ?? op.legibility ?? 1, cx - torsoW * 0.51, shoulderY + bodyH * 0.09, torsoW * 0.44 * (PATCH_BOX[outer.patch?.size] ?? 0.6) / 0.6, outer.colors.accent);
  }

  if (topG?.patch?.placement === 'chest') {
    const tp = seen('top');
    const boxW = torsoW * (PATCH_BOX[topG.patch.size] ?? 0.6) * (outer ? 0.6 : 1);
    if (tp?.text) patchText(ctx, tp.text, tp.patchLegibility ?? tp.legibility ?? 1, cx, shoulderY + bodyH * 0.09, boxW, topG.colors.accent);
  }

  const scarf = g('scarf');
  if (scarf) {
    ctx.fillStyle = scarf.colors.base;
    roundRect(ctx, cx - torsoW * 0.3, shoulderY - bodyH * 0.03, torsoW * 0.6, bodyH * 0.055, bodyH * 0.02); ctx.fill();
    roundRect(ctx, cx + torsoW * 0.06, shoulderY + bodyH * 0.01, torsoW * 0.16, bodyH * 0.14, torsoW * 0.05); ctx.fill();
    pattern(ctx, scarf.pattern, cx - torsoW * 0.3, shoulderY - bodyH * 0.03, torsoW * 0.6, bodyH * 0.055, scarf.colors.accent);
    const sp = seen('scarf');
    if (sp?.text) patchText(ctx, sp.text, sp.patchLegibility ?? sp.legibility ?? 1, cx + torsoW * 0.14, shoulderY + bodyH * 0.1, torsoW * 0.3, scarf.colors.accent);
  }

  const headY = top + headH * 0.5;
  ctx.fillStyle = resident.body.skin;
  ctx.beginPath();
  ctx.ellipse(cx, headY, headW / 2, headH / 2, 0, 0, 6.2832);
  ctx.fill();
  ctx.fillStyle = 'rgba(59,47,85,0.72)';
  ctx.beginPath(); ctx.ellipse(cx - headW * 0.19, headY + headH * 0.03, headW * 0.045, headH * 0.035, 0, 0, 6.2832); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + headW * 0.19, headY + headH * 0.03, headW * 0.045, headH * 0.035, 0, 0, 6.2832); ctx.fill();
  ctx.fillStyle = 'rgba(59,47,85,0.3)';
  ctx.fillRect(cx - headW * 0.1, headY + headH * 0.24, headW * 0.2, headH * 0.03);

  const hair = resident.body.hair;
  ctx.fillStyle = hair.color;
  ctx.beginPath();
  ctx.ellipse(cx, headY - headH * 0.08, headW * 0.54, headH * 0.46, 0, Math.PI, 0);
  ctx.fill();
  if (hair.style === 'long') {
    ctx.fillRect(cx - headW * 0.54, headY - headH * 0.1, headW * 0.16, headH * 0.95);
    ctx.fillRect(cx + headW * 0.38, headY - headH * 0.1, headW * 0.16, headH * 0.95);
  } else if (hair.style === 'bun') {
    ctx.beginPath(); ctx.arc(cx, headY - headH * 0.56, headH * 0.17, 0, 6.2832); ctx.fill();
  } else if (hair.style === 'curls') {
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(cx + i * headW * 0.22, headY - headH * 0.42, headH * 0.14, 0, 6.2832); ctx.fill(); }
  }

  const hat = g('hat');
  if (hat) {
    ctx.fillStyle = hat.colors.base;
    const brimW = headW * (hat.silhouette === 'bucket' ? 1.45 : 1.2);
    roundRect(ctx, cx - brimW / 2, headY - headH * 0.34, brimW, headH * 0.16, headH * 0.07); ctx.fill();
    roundRect(ctx, cx - headW * 0.46, headY - headH * 0.78, headW * 0.92, headH * 0.5, headH * 0.16); ctx.fill();
    pattern(ctx, hat.pattern, cx - headW * 0.46, headY - headH * 0.78, headW * 0.92, headH * 0.5, hat.colors.accent);
    const hp = seen('hat');
    if (hp?.text) patchText(ctx, hp.text, hp.patchLegibility ?? hp.legibility ?? 1, cx, headY - headH * 0.26, brimW * 0.8, hat.colors.accent);
  }

  const glasses = g('glasses');
  if (glasses) {
    ctx.strokeStyle = glasses.colors.accent;
    ctx.lineWidth = Math.max(2, headW * 0.035);
    ctx.fillStyle = glasses.colors.base;
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(cx - headW * 0.19, headY + headH * 0.03, headW * 0.15, headH * 0.11, 0, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + headW * 0.19, headY + headH * 0.03, headW * 0.15, headH * 0.11, 0, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.ellipse(cx - headW * 0.19, headY + headH * 0.03, headW * 0.15, headH * 0.11, 0, 0, 6.2832); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx + headW * 0.19, headY + headH * 0.03, headW * 0.15, headH * 0.11, 0, 0, 6.2832); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - headW * 0.04, headY + headH * 0.03); ctx.lineTo(cx + headW * 0.04, headY + headH * 0.03); ctx.stroke();
  }

  const vig = ctx.createRadialGradient(cx, size * 0.45, size * 0.28, cx, size * 0.5, size * 0.78);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(59,47,85,0.16)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, size, size);
  return cv;
}

export const portraitDataUrl = (resident, town, size = 512, patches = null) =>
  renderPortrait(resident, town, size, patches).toDataURL('image/png');
