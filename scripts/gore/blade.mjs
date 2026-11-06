/**
 * Кровь на оружии. Оружие помнит до трёх жидкостей и сколько каждой (слои): цвета не смешиваются, а лежат рядом —
 * свежая у острия и по кромке, старая стекла ниже, к рукояти. Узор подтёков у каждой картинки свой и постоянный
 * (зерно — по картинке), уровень решает, сколько его видно. Где кровь — по виду оружия: клинок — длинные подтёки,
 * дробящее — сгустки на навершии, древковое — подтёки по древку.
 *
 * Пятна хранятся у клиента по токену и виду оружия: видно в замахе, копится между атаками, после боя — чисто.
 */

import { clamp, lerp } from "../util.mjs";
import { FLUIDS, rgba } from "./fluids.mjs";
import { seededRnd } from "./decals.mjs";

/** Вид оружия → где на нём кровь */
const STYLE = {
  maul: "blunt", greatclub: "blunt", warhammer: "blunt", morningstar: "blunt", flail: "blunt", club: "blunt",
  glaive: "pole", halberd: "pole", javelin: "pole", spear: "pole", trident: "pole"
};
export const styleOf = kind => STYLE[kind] ?? "blade";

/**
 * Картинки, на которых кровь теряется (узкий клинок меча, большая светлая голова секиры): первая ступень — сразу
 * как вторая у прочих, полный уровень — гуще полного (до 1,4)
 */
const BLOOD_GAIN = { "sword-1": [[0, 0], [0.25, 0.5], [0.5, 0.8], [0.8, 1], [1, 1.4]], "greataxe-1": [[0, 0], [0.25, 0.5], [0.5, 0.8], [0.8, 1], [1, 1.4]] };
function gained(src, level) {
  const curve = BLOOD_GAIN[src];
  if (!curve) return level;
  for (let i = 1; i < curve.length; i++) if (level <= curve[i][0]) { const [a, va] = curve[i - 1], [b, vb] = curve[i]; return lerp(va, vb, (level - a) / (b - a)); }
  return curve.at(-1)[1];
}

/* ---------- Пятна по токенам ---------- */

/** tokenId → kind → {layers: [{id, amt}], gore, fluid, last, face, two} */
const stains = new Map();

export function stainOf(tokenId, kind) {
  return stains.get(tokenId)?.get(kind) ?? null;
}
function stainFor(tokenId, kind) {
  let m = stains.get(tokenId);
  if (!m) stains.set(tokenId, m = new Map());
  let s = m.get(kind);
  if (!s) m.set(kind, s = { layers: [], gore: 0, fluid: null, last: 0, face: 0, two: false, kind });
  return s;
}
/** Все пятна (для стряхивания по простою): [tokenId, stain] */
export function* allStains() {
  for (const [id, m] of stains) for (const s of m.values()) if (s.gore > 0.005) yield [id, s];
}
export function clearStains(tokenId) {
  if (tokenId) stains.delete(tokenId); else stains.clear();
}

/** Испачкать: свежий слой — последним, не больше трёх; всего не больше 1 — лишнее уходит со старого */
export function stain(tokenId, kind, id, amt, { face, two } = {}) {
  const s = stainFor(tokenId, kind), top = s.layers.at(-1);
  if (top?.id === id) top.amt += amt; else s.layers.push({ id, amt });
  if (s.layers.length > 3) s.layers.shift();
  let extra = s.layers.reduce((n, x) => n + x.amt, 0) - 1;
  while (extra > 1e-6 && s.layers.length) { const o = s.layers[0], cut = Math.min(o.amt, extra); o.amt -= cut; extra -= cut; if (o.amt < 0.005) s.layers.shift(); }
  if (face !== undefined) s.face = face;
  if (two !== undefined) s.two = two;
  s.last = Date.now();
  sync(s);
  return s;
}
/** Стряхнуть: оставить keep от всего; первым уходит свежий слой — старый присох */
export function shed(s, keep) {
  let cut = s.gore * (1 - keep);
  for (let i = s.layers.length - 1; i >= 0 && cut > 1e-6; i--) { const x = s.layers[i], c = Math.min(x.amt, cut * (i === s.layers.length - 1 ? 1 : 0.7)); x.amt -= c; cut -= c; }
  s.layers = s.layers.filter(x => x.amt > 0.005);
  sync(s);
}
function sync(s) { s.gore = s.layers.reduce((n, x) => n + x.amt, 0); s.fluid = s.layers.at(-1)?.id ?? null; }

/** Чем полетит капля с оружия: жидкость по её доле; r — случайность */
export function pickFluid(s, r = Math.random) {
  const total = s?.gore ?? 0;
  let q = r() * total;
  for (const x of s?.layers ?? []) { q -= x.amt; if (q <= 0) return FLUIDS[x.id] ?? FLUIDS.blood; }
  return FLUIDS[s?.fluid] ?? FLUIDS.blood;
}

/* ---------- Картинка окровавленного оружия ---------- */

const DRIPS = new Map();
/** Узор: где на картинке металл по строкам, и из этого — брызги и подтёки (навершие — строки шире древка) */
function dripsOf(img, src, style) {
  const key = src + style;
  if (DRIPS.has(key)) return DRIPS.get(key);
  const w = img.width, h = img.height, c = document.createElement("canvas"); c.width = w; c.height = h;
  const l = c.getContext("2d", { willReadFrequently: true }); l.drawImage(img, 0, 0);
  const a = l.getImageData(0, 0, w, h).data;
  const span = y => { let x0 = -1, x1 = -1; for (let x = 0; x < w; x++) if (a[(Math.round(y) * w + x) * 4 + 3] > 60) { if (x0 < 0) x0 = x; x1 = x; } return x0 < 0 ? null : [x0, x1]; };
  const R = seededRnd(src), rows = Array.from({ length: h }, (_, y) => span(y)), top = Math.max(0, rows.findIndex(Boolean));
  const widthAt = y => rows[y] ? rows[y][1] - rows[y][0] : 0;
  const shaft = [...Array(h).keys()].slice(h * 0.55, h * 0.9).map(widthAt).sort((p, q) => p - q)[Math.floor(h * 0.35 * 0.5)] || w / 6;
  let headEnd = top; for (let y = top; y < h * 0.55; y++) if (widthAt(y) > shaft * 1.4) headEnd = y;
  const pick = (lo, hi) => lo + R() * (hi - lo), unit = style === "pole" ? Math.max(w / 30, shaft * 0.4) : w / 30;
  const spots = [], drips = [];
  const done = () => { const spec = { spots, drips }; DRIPS.set(key, spec); return spec; };
  if (style !== "blade") {
    const head = Math.max(h * 0.08, headEnd - top), blunt = style === "blunt";
    for (let i = 0; i < (blunt ? 34 : 22); i++) {
      const y = top + R() * head, s = span(y); if (!s) continue;
      spots.push({ x: pick(s[0], s[1]), y, r: unit * (blunt ? pick(0.8, 2.3) : pick(0.5, 1.3)), order: R() });
    }
    for (let i = 0; i < (blunt ? 9 : 12); i++) {
      const y = top + head * pick(blunt ? 0.35 : 0.2, 1), s = span(y); if (!s) continue;
      drips.push({ x: pick(s[0] + (s[1] - s[0]) * 0.1, s[1] - (s[1] - s[0]) * 0.1), y, len: h * (blunt ? pick(0.015, 0.06) : pick(0.08, 0.4)), wd: unit * pick(0.6, 1.2), wob: pick(0.4, 1.2), ph: R() * 6.28, order: R() });
    }
    // Струйки с навершия на древко
    for (let i = 0; i < (blunt ? 3 : 4); i++) {
      const y = headEnd + 2, s = span(y); if (!s) continue;
      drips.push({ x: pick(s[0] + (s[1] - s[0]) * 0.2, s[1] - (s[1] - s[0]) * 0.2), y, len: h * (blunt ? pick(0.05, 0.14) : pick(0.12, 0.35)), wd: Math.max(unit * 0.6, shaft * 0.25), wob: pick(0.3, 0.8), ph: R() * 6.28, order: R() });
    }
    return done();
  }
  // Клинок: брызги гуще у острия; подтёки к рукояти, у каждого своя длина и ширина
  for (let i = 0; i < 26; i++) {
    const y = top + Math.pow(R(), 1.6) * h * 0.55, s = span(y); if (!s) continue;
    spots.push({ x: pick(s[0], s[1]), y, r: unit * pick(0.5, 1.6) * (1 - (y - top) / h * 0.6), order: R() });
  }
  for (let i = 0; i < 16; i++) {
    const y = top + Math.pow(R(), 1.3) * h * 0.45, s = span(y); if (!s) continue;
    drips.push({ x: pick(s[0] + (s[1] - s[0]) * 0.1, s[1] - (s[1] - s[0]) * 0.1), y, len: h * pick(0.06, 0.32), wd: unit * pick(0.55, 1.15), wob: pick(0.6, 1.6), ph: R() * 6.28, order: R() });
  }
  // Запас сверх полного уровня (BLOOD_GAIN): дописан после основного узора, тот не меняется
  for (let i = 0; i < 18; i++) {
    const y = top + Math.pow(R(), 1.3) * h * 0.5, s = span(y); if (!s) continue;
    spots.push({ x: pick(s[0], s[1]), y, r: unit * pick(0.6, 1.8), order: 1 + R() * 0.4 });
  }
  for (let i = 0; i < 12; i++) {
    const y = top + Math.pow(R(), 1.2) * h * 0.45, s = span(y); if (!s) continue;
    drips.push({ x: pick(s[0] + (s[1] - s[0]) * 0.1, s[1] - (s[1] - s[0]) * 0.1), y, len: h * pick(0.1, 0.36), wd: unit * pick(0.7, 1.3), wob: pick(0.6, 1.6), ph: R() * 6.28, order: 1 + R() * 0.4 });
  }
  return done();
}

const TEXTURES = new Map();
/**
 * Текстура окровавленного оружия (кэш). Каждый подтёк и брызга — одного слоя по высоте: свежий у острия,
 * короткими брызгами; старый ниже, длинными потёками
 * @param {PIXI.Texture} texture  картинка оружия
 * @param {string} src            её имя (sword-1)
 */
export function bloodiedTexture(texture, src, kind, s) {
  const img = texture.baseTexture?.resource?.source;
  if (!img || !s?.layers.length) return null;
  const style = styleOf(kind), layers = s.layers;
  const q = Math.round(gained(src, clamp(s.gore)) * 20) / 20, total = layers.reduce((n, x) => n + x.amt, 0) || 1;
  const key = src + q + style + layers.map(x => x.id + Math.round(x.amt / total * 10) / 10).join(",");
  const hit = TEXTURES.get(key);
  if (hit && !hit.baseTexture?.destroyed) { TEXTURES.delete(key); TEXTURES.set(key, hit); return hit; }
  const { spots, drips } = dripsOf(img, src, style);
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const l = c.getContext("2d"); l.drawImage(img, 0, 0);
  l.globalCompositeOperation = "source-atop";
  l.lineCap = "round"; l.lineJoin = "round";
  const paint = layers.map(x => { const fl = FLUIDS[x.id] ?? FLUIDS.blood; return { dark: rgba(fl.blade, Math.min(0.97, 0.8 + 0.15 * q)), wet: rgba(fl.wet, Math.min(0.65, 0.35 + 0.25 * q)) }; });
  const over = Math.max(0, q - 1) / 0.4;
  const seen = [...spots.filter(p => p.order <= q * 1.15).map(p => ({ s: p, d: p.y })), ...drips.filter(d => d.order <= q * 1.1).map(d => ({ dr: d, d: d.y }))].sort((p, r) => p.d - r.d);
  const cum = []; let acc = 0; for (let i = layers.length - 1; i >= 0; i--) { acc += layers[i].amt / total; cum.push([acc, i]); }
  seen.forEach((it, n) => { const k = (n + 0.5) / seen.length; it.layer = (cum.find(([v]) => k <= v + 1e-6) ?? cum.at(-1))[1]; });
  for (const { s: p, layer } of seen.filter(it => it.s)) {
    const { dark, wet } = paint[layer];
    l.fillStyle = dark; l.beginPath(); l.ellipse(p.x, p.y, p.r * 1.2, p.r, p.order * 3, 0, 6.283); l.fill();
    l.fillStyle = wet; l.beginPath(); l.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.35, 0, 6.283); l.fill();
  }
  for (const { dr: d, layer } of seen.filter(it => it.dr)) {
    const { dark, wet } = paint[layer], fresh = layers.length > 1 && layer === layers.length - 1 ? 0.55 : 1;
    const len = d.len * (0.35 + 0.65 * Math.min(1, q * 1.3)) * (1 + 0.3 * over) * fresh, n = 14, pts = [], wd = d.wd * (1 + 0.25 * over);
    for (let i = 0; i <= n; i++) { const k = i / n; pts.push([d.x + Math.sin(d.ph + k * 5) * wd * 0.45 * d.wob, d.y + len * k]); }
    for (let i = 1; i <= n; i++) {
      const k = i / n; l.strokeStyle = dark; l.lineWidth = wd * (1.25 - 0.65 * k);
      l.beginPath(); l.moveTo(...pts[i - 1]); l.lineTo(...pts[i]); l.stroke();
    }
    const [ex, ey] = pts[n];
    l.fillStyle = dark; l.beginPath(); l.ellipse(ex, ey + wd * 0.25, wd * 0.7, wd * 0.9, 0, 0, 6.283); l.fill();
    l.strokeStyle = wet; l.lineWidth = Math.max(1, wd * 0.25);
    l.beginPath(); l.moveTo(pts[0][0] - wd * 0.25, pts[0][1]); for (const [x, y] of pts.slice(1, -2)) l.lineTo(x - wd * 0.25, y); l.stroke();
  }
  const tex = PIXI.Texture.from(c);
  TEXTURES.set(key, tex);
  // Старые картинки — вон (кроме тех, что сейчас на экране — их держит спрайт, текстура уничтожается позже)
  while (TEXTURES.size > 120) { const [k, t] = TEXTURES.entries().next().value; TEXTURES.delete(k); t.destroy(true); }
  return tex;
}
