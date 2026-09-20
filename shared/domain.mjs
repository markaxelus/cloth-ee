export const CATEGORIES = ['shirt', 'pants', 'hat', 'glasses', 'scarf', 'shoes'];
export const MATERIALS = {
  cotton: { name: 'Cotton', good: 'Comfortable, absorbent and usually breathable.', tradeoff: 'Holds moisture and may dry slowly; farming and processing impacts vary.', care: 'Follow the label; cooler washing and air drying can reduce use-phase energy.' },
  linen: { name: 'Linen', good: 'Often airy and comfortable in warm weather.', tradeoff: 'Creases easily; weave and finishing affect softness and durability.', care: 'Use the garment label; avoid assuming every linen item is machine washable.' },
  wool: { name: 'Wool', good: 'Insulates well and can buffer moisture.', tradeoff: 'Can feel itchy and needs careful washing; impact depends on production.', care: 'Air between wears; use a wool cycle only when the label allows it.' },
  polyester: { name: 'Polyester', good: 'Usually durable and quick drying; common in activewear.', tradeoff: 'Can retain odour and shed plastic microfibres. Fabric construction matters.', care: 'Wash when needed; avoid high heat if the care label forbids it.' },
  other: { name: 'Other materials', good: 'Performance depends on composition and construction.', tradeoff: 'A material name alone does not establish ethical or environmental performance.', care: 'Check the specific care label.' }
};

export function preferredVariant(product, size) {
  return product.variants.find(v => v.available && v.size === size) || product.variants.find(v => v.available) || product.variants[0];
}
export function money(amount, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(amount);
}
export function perWear(price, wears) {
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(wears) || wears < 1) throw new Error('Invalid price or wear count');
  return price / wears;
}
export function shippingEstimate({ massKg, distanceKm, kgCO2ePerTonneKm, returnFraction = 0 }) {
  const values = [massKg, distanceKm, kgCO2ePerTonneKm, returnFraction];
  if (values.some(x => !Number.isFinite(x) || x < 0) || returnFraction > 1) throw new Error('Invalid shipping assumptions');
  return massKg / 1000 * distanceKm * kgCO2ePerTonneKm * (1 + returnFraction);
}
export function newState(products) {
  const p = products[0];
  return { revision: 0, productId: p.id, variantId: preferredVariant(p, 'M').id,
    profile: { heightCm: 175, topSize: 'M', bottomSize: 'M', shoeSize: '42', palette: 'soft' },
    favorites: [], worn: {}, fit: { x: 0, y: 0, scale: 1, rotation: 0 },
    pose: null, poseAt: 0, mode: 'studio', message: '', assistant: null, wears: 30 };
}
function validNumber(n, min, max) { return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max; }
function assert(ok, message) { if (!ok) { const error = new Error(message); error.status = 400; throw error; } }
export function transition(state, action, products, now = Date.now()) {
  assert(action && typeof action === 'object', 'An action is required');
  const s = structuredClone(state);
  const current = () => products.find(p => p.id === s.productId);
  const select = p => {
    assert(p, 'Product not found'); s.productId = p.id;
    s.variantId = preferredVariant(p, p.category === 'pants' ? s.profile.bottomSize : p.category === 'shoes' ? s.profile.shoeSize : s.profile.topSize).id;
  };
  switch (action.type) {
    case 'select': select(products.find(p => p.id === action.productId)); break;
    case 'next': case 'previous': {
      const group = CATEGORIES.includes(action.category) ? products.filter(p => p.category === action.category) : products;
      assert(group.length, 'This category has no products');
      const index = group.findIndex(p => p.id === s.productId);
      select(group[(index + (action.type === 'next' ? 1 : -1) + group.length) % group.length]); break;
    }
    case 'variant': assert(current().variants.some(v => v.id === action.variantId && v.available), 'Variant is unavailable'); s.variantId = action.variantId; break;
    case 'favorite': s.favorites = s.favorites.includes(s.productId) ? s.favorites.filter(id => id !== s.productId) : [...s.favorites, s.productId]; break;
    case 'wear': s.worn[s.productId] = (s.worn[s.productId] || 0) + 1; break;
    case 'wears': assert(validNumber(action.value, 1, 500), 'Wear count must be 1–500'); s.wears = Math.round(action.value); break;
    case 'mode': assert(['studio', 'camera', 'mirror'].includes(action.value), 'Unknown fitting mode'); s.mode = action.value; break;
    case 'profile': {
      const p = action.profile;
      assert(p && validNumber(p.heightCm, 100, 230), 'Height must be 100–230 cm');
      for (const k of ['topSize', 'bottomSize', 'shoeSize']) assert(typeof p[k] === 'string' && p[k].length > 0 && p[k].length <= 16, 'Invalid size');
      assert(['soft', 'earth', 'bold'].includes(p.palette), 'Unknown palette');
      s.profile = { heightCm: p.heightCm, topSize: p.topSize, bottomSize: p.bottomSize, shoeSize: p.shoeSize, palette: p.palette };
      break;
    }
    case 'fit': {
      const f = action.fit;
      assert(f && validNumber(f.x, -0.5, 0.5) && validNumber(f.y, -0.5, 0.5) && validNumber(f.scale, 0.3, 2.5) && validNumber(f.rotation, -90, 90), 'Invalid alignment');
      s.fit = { x: f.x, y: f.y, scale: f.scale, rotation: f.rotation }; break;
    }
    case 'pose': {
      assert(action.pose === null || (Array.isArray(action.pose) && action.pose.length === 33 && action.pose.every(p => p && validNumber(p.x, -2, 3) && validNumber(p.y, -2, 3) && validNumber(p.visibility, 0, 1))), 'Expected 33 normalized pose landmarks');
      s.pose = action.pose; s.poseAt = now; break;
    }
    case 'message': assert(typeof action.value === 'string' && action.value.length <= 2000, 'Invalid message'); s.message = action.value; break;
    default: assert(false, 'Unknown action');
  }
  s.revision++; return s;
}

// Camera coordinates are normalized, origin at top left, never mirrored here.
// Apply one shared mirror transform to video + overlay at render time.
export function garmentPlacement(category, landmarks, aspect = 4 / 3) {
  if (!landmarks || landmarks.length !== 33) return null;
  const ok = ids => ids.every(i => landmarks[i].visibility >= 0.55);
  const mid = (a,b) => ({x:(landmarks[a].x+landmarks[b].x)/2,y:(landmarks[a].y+landmarks[b].y)/2});
  const dist = (a,b) => Math.hypot((landmarks[a].x-landmarks[b].x)*aspect, landmarks[a].y-landmarks[b].y);
  if (category === 'shirt' && ok([11,12,23,24])) {
    const sh = mid(11,12), hip = mid(23,24);
    const left = landmarks[11].x < landmarks[12].x ? landmarks[11] : landmarks[12];
    const right = left === landmarks[11] ? landmarks[12] : landmarks[11];
    return { x: sh.x, y: sh.y + (hip.y-sh.y)*0.43, width: dist(11,12)/aspect*1.65, height: Math.abs(hip.y-sh.y)*1.45, rotation: Math.atan2(right.y-left.y,(right.x-left.x)*aspect)*180/Math.PI };
  }
  if (category === 'pants' && ok([23,24,27,28])) {
    const hip=mid(23,24), ankle=mid(27,28); return {x:hip.x,y:(hip.y+ankle.y)/2,width:dist(23,24)/aspect*1.7,height:Math.abs(ankle.y-hip.y)*1.12,rotation:0};
  }
  if (['hat','glasses'].includes(category) && ok([0,7,8])) {
    const ears=mid(7,8); const w=Math.max(dist(7,8)/aspect*1.55,0.06); return {x:ears.x,y:ears.y+(category==='hat'?-w*aspect*0.5:0),width:w,height:w*aspect*(category==='hat'?0.7:0.4),rotation:0};
  }
  if (category === 'scarf' && ok([11,12])) {const sh=mid(11,12);return {x:sh.x,y:sh.y+0.07,width:dist(11,12)/aspect*0.9,height:0.22,rotation:0};}
  if (category === 'shoes' && ok([27,28,31,32])) {const feet=mid(31,32);return {x:feet.x,y:feet.y,width:Math.max(dist(31,32)/aspect*1.6,0.15),height:0.08,rotation:0};}
  return null;
}
