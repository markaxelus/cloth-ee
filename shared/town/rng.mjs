export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// mulberry32 seeded by FNV-1a of the stringified seed, so 7 and '7' behave alike.
export function makeRng(seed) {
  let a = hash32(String(seed)) | 0;
  return function rng() {
    a = a + 0x6d2b79f5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function rngInt(rng, min, maxInclusive) {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

export function rngPick(rng, array) {
  return array[Math.floor(rng() * array.length)];
}

export function rngWeighted(rng, entries) {
  let total = 0;
  for (const e of entries) if (e.weight > 0) total += e.weight;
  let r = rng() * total;
  for (const e of entries) if (e.weight > 0 && (r -= e.weight) < 0) return e.value;
  return entries[entries.length - 1].value;
}

export function rngShuffle(rng, array) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
