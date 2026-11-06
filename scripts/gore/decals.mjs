/**
 * Следы боя на земле: пятна и мазки крови, кровавые следы ног, горстки пыли, лужи под павшими.
 *
 * Земля сцены поделена на куски по 1024 px — у каждого свой холст Canvas2D и спрайт в слое под токенами (на своей
 * высоте). Рисуется только в нужные куски, текстура куска обновляется раз в кадр. Следы живут, пока открыта
 * сцена: смена сцены или перезагрузка страницы их убирает. Кто рисует — передаёт случайность r (зерно атаки),
 * чтобы у всех клиентов следы легли одинаково.
 *
 * Все величины — пиксели макета (клетка 100), на сцену — множителем u.
 */

import { fx } from "../fx/layer.mjs";
import { clamp, ease } from "../util.mjs";
import { FLUIDS, rgba, mixRgb } from "./fluids.mjs";

/** Свет сверху-слева, как у теней оружия: блики к свету, ободки — от него */
export const LIGHT = 0.7;
const CHUNK = 1024;

/** Генератор по строке — для узоров, которые должны совпасть у всех (лужа, клинок) */
export function seededRnd(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

class Decals {
  /** @type {Map<string, {canvas, ctx, sprite, x, y, dirty}>} */
  #chunks = new Map();
  /** Лужи, которые растекаются: спрайт со своей текстурой; дорастут — впечатываются в землю */
  #growing = [];
  /** Все лужи сцены (для кровавых следов): {x, y, r, fl, elevation}, px макета */
  pools = [];
  /** Сколько кровавых следов ног оставлено (для проверок) */
  printCount = 0;

  get u() { return fx.u; }

  /** Нарисовать в землю: fn(ctx) рисует в пикселях макета; x, y, reach — где и насколько (px макета) */
  paint(x, y, reach, elevation, fn) {
    if (!fx.active) return;
    const u = this.u, x0 = (x - reach) * u, y0 = (y - reach) * u, x1 = (x + reach) * u, y1 = (y + reach) * u;
    for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
      for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
        const ch = this.#chunk(cx, cy, elevation);
        ch.ctx.save();
        ch.ctx.setTransform(u, 0, 0, u, -ch.x, -ch.y);
        fn(ch.ctx);
        ch.ctx.restore();
        ch.dirty = true;
      }
    }
  }

  #chunk(cx, cy, elevation) {
    const e = Math.round((elevation || 0) * 100) / 100, key = `${cx}:${cy}:${e}`;
    let ch = this.#chunks.get(key);
    const ground = fx.ground(e);
    if (ch && !ch.sprite.destroyed) {
      if (ch.sprite.parent !== ground) ground.addChildAt(ch.sprite, 0);
      return ch;
    }
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = CHUNK;
    const sprite = new PIXI.Sprite(PIXI.Texture.from(canvas));
    sprite.eventMode = "none";
    sprite.position.set(cx * CHUNK, cy * CHUNK);
    ground.addChildAt(sprite, 0);
    ch = { canvas, ctx: canvas.getContext("2d"), sprite, x: cx * CHUNK, y: cy * CHUNK, dirty: false, elevation: e };
    this.#chunks.set(key, ch);
    return ch;
  }

  /** Сколько кусков земли расписано и сколько луж растекается (для проверок) */
  get stats() { return { chunks: [...this.#chunks.values()].filter(c => !c.sprite.destroyed).length, growing: this.#growing.length, pools: this.pools.length }; }

  update(dt) {
    for (const ch of this.#chunks.values()) {
      // Слой земли мог пересоздаться (контейнер без детей убирается) — вернуть кусок на место
      if (ch.sprite.destroyed) continue;
      const ground = fx.ground(ch.elevation);
      if (ch.sprite.parent !== ground) ground.addChildAt(ch.sprite, 0);
      if (ch.dirty) { ch.sprite.texture.baseTexture.update(); ch.dirty = false; }
    }
    for (const p of this.#growing) {
      p.t += dt;
      const k = clamp(p.t / 7);
      // Растекается секунд семь: ровно, к концу медленнее
      p.r = p.max * (0.06 + 0.94 * (1 - (1 - k) * (1 - k)));
      p.ref.r = p.r;
      this.#drawGrowing(p);
      if (k >= 1) {
        // Впечатать в землю и убрать спрайт
        const art = poolArt(p.seed, p.fl, p.max, 1);
        this.paint(p.x, p.y, art.S / 2, p.elevation, ctx => {
          if (p.fl.glow) glowUnder(ctx, p.x, p.y, p.max, p.fl);
          ctx.drawImage(art.img, p.x - art.S / 2, p.y - art.S / 2);
        });
        p.sprite.destroy({ texture: true, baseTexture: true });
        p.done = true;
      }
    }
    this.#growing = this.#growing.filter(p => !p.done);
  }

  #drawGrowing(p) {
    const STEPS = 40, f = clamp(p.r / p.max) * STEPS, i = Math.floor(f), w = f - i;
    const art = poolArt(p.seed, p.fl, p.max, i / STEPS), next = w > 0.01 && i < STEPS ? poolArt(p.seed, p.fl, p.max, (i + 1) / STEPS) : null;
    const m = p.ctx, S = art.S;
    m.globalCompositeOperation = "copy"; m.globalAlpha = 1;
    if (p.fl.glow) { m.clearRect(0, 0, S, S); m.globalCompositeOperation = "source-over"; glowUnder(m, S / 2, S / 2, p.r, p.fl); }
    // Смешение сложением: (1 − w)·этот + w·следующий — без потемнения там, где оба полупрозрачны
    m.globalAlpha = next ? 1 - w : 1; m.drawImage(art.img, 0, 0);
    if (next) { m.globalCompositeOperation = "lighter"; m.globalAlpha = w; m.drawImage(next.img, 0, 0); }
    m.globalCompositeOperation = "source-over"; m.globalAlpha = 1;
    p.sprite.texture.baseTexture.update();
    const ground = fx.ground(p.elevation);
    if (p.sprite.parent !== ground) ground.addChild(p.sprite);
  }

  /** Лужа под павшим: растекается наплывами; max — радиус, px макета */
  pool(x, y, max, fl, elevation, seed) {
    if (!fx.active) return;
    const S = Math.ceil(max * 4.4), canvas = document.createElement("canvas");
    canvas.width = canvas.height = S;
    const sprite = new PIXI.Sprite(PIXI.Texture.from(canvas));
    sprite.eventMode = "none";
    sprite.anchor.set(0.5);
    sprite.position.set(x * this.u, y * this.u);
    sprite.scale.set(this.u);
    const ref = { x, y, r: max * 0.06, fl, elevation };
    this.pools.push(ref);
    this.#growing.push({ x, y, max, fl, elevation, seed, t: 0, r: 0, canvas, ctx: canvas.getContext("2d"), sprite, ref });
  }

  /** Сверху лежащая лужа в этой точке (px макета) */
  poolAt(x, y, pad) {
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      if (Math.hypot(p.x - x, p.y - y) < p.r + pad) return p;
    }
    return null;
  }

  clear() {
    for (const ch of this.#chunks.values()) if (!ch.sprite.destroyed) ch.sprite.destroy({ texture: true, baseTexture: true });
    for (const p of this.#growing) if (!p.sprite.destroyed) p.sprite.destroy({ texture: true, baseTexture: true });
    this.#chunks.clear();
    this.#growing = [];
    this.pools = [];
    this.printCount = 0;
  }

  /**
   * Пятно: плотная заливка одним контуром, тёмный ободок с теневой стороны, блик со стороны света. Вытянуто по
   * ang, брызги-спутники вперёд по полёту. r — случайность
   */
  splat(x, y, elevation, fl, ang, size, r, { alpha = 0.8, sats = 3, stretch = 1.4 } = {}) {
    const rnd = (a, b) => a + r() * (b - a), gl = fl.gloss ?? 1, ax = Math.cos(LIGHT), ay = Math.sin(LIGHT), a = Math.min(0.95, alpha + 0.15);
    const len = size * stretch, shape = [];
    if (size < 1.6) shape.push([0, 0, size, size, 0]);
    else for (let i = 0; i < 4; i++) shape.push([rnd(-0.3, 0.35) * len, rnd(-0.3, 0.3) * size, len * rnd(0.55, 0.9), size * rnd(0.55, 0.9), rnd(-0.4, 0.4)]);
    for (let i = 0; i < (size < 1.6 ? 0 : sats); i++) { const q = size * rnd(0.12, 0.3); shape.push([len + rnd(1, size * 2.2), rnd(-size, size) * 0.5, q, q, 0]); }
    const body = rgba(mixRgb(fl.lo, fl.hi, r), a), rim = Math.max(0.5, size * 0.16);
    this.paint(x, y, len + size * 3 + 4, elevation, l => {
      const fill = (dx, dy, color) => {
        l.save(); l.translate(x + dx, y + dy); l.rotate(ang); l.fillStyle = color; l.beginPath();
        for (const [cx, cy, rx, ry, rot] of shape) { l.moveTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * rx); l.ellipse(cx, cy, rx, ry, rot, 0, 6.283); }
        l.fill(); l.restore();
      };
      fill(ax * rim, ay * rim, rgba(fl.dark, a));
      fill(0, 0, body);
      if (size < 1.2 || gl < 0.2) return;
      l.fillStyle = rgba(fl.wet, 0.75 * gl * a); l.beginPath();
      l.ellipse(x - ax * size * 0.35, y - ay * size * 0.35, Math.max(0.5, size * 0.32), Math.max(0.4, size * 0.15), LIGHT + Math.PI / 2, 0, 6.283); l.fill();
    });
  }

  /** Мазок рубящего: дуга пятнышек поперёк удара */
  smear(x, y, elevation, fl, dir, len, r) {
    const rnd = (a, b) => a + r() * (b - a), nx = Math.cos(dir + Math.PI / 2), ny = Math.sin(dir + Math.PI / 2), bend = rnd(-0.3, 0.3);
    for (let i = 0; i < 16; i++) {
      const k = i / 15 - 0.5, off = k * len;
      this.splat(x + nx * off + Math.cos(dir) * (k * k) * len * bend * 2, y + ny * off + Math.sin(dir) * (k * k) * len * bend * 2, elevation, fl,
        dir + Math.PI / 2, rnd(1.2, 2.6) * (1 - Math.abs(k) * 1.2), r, { alpha: 0.55, sats: 0, stretch: 1.8 });
    }
  }

  /** Кровавый след ноги: навсегда, бледнеет к последнему шагу (k) */
  print(x, y, elevation, dir, z, k, fl) {
    this.printCount++;
    this.paint(x, y, 20 * z, elevation, l => {
      l.translate(x, y); l.rotate(dir);
      l.fillStyle = rgba(fl.lo, 0.25 + 0.45 * k);
      l.beginPath(); l.ellipse(0, 0, 9 * z, 5 * z, 0, 0, 7); l.fill();
      l.beginPath(); l.ellipse(-12 * z, 0, 4.5 * z, 4 * z, 0, 0, 7); l.fill();
    });
  }

  /** Горстка пыли вокруг павшего (скелет): мягкие светлые пятна и крошки за краем токена; rad — радиус токена */
  dustHeap(x, y, elevation, D, rad, r) {
    const rnd = (a, b) => a + r() * (b - a);
    const blots = Array.from({ length: 8 }, () => { const a = rnd(0, 6.283), d = rnd(rad * 0.95, rad * 1.35); return [x + Math.cos(a) * d, y + Math.sin(a) * d, rnd(rad * 0.2, rad * 0.38)]; });
    const chips = Array.from({ length: 18 }, () => { const a = rnd(0, 6.283), d = rnd(rad, rad * 1.55); return [x + Math.cos(a) * d, y + Math.sin(a) * d, rnd(0, 3), rnd(3, 7), rnd(0.75, 0.95)]; });
    this.paint(x, y, rad * 1.8, elevation, l => {
      for (const [bx, by, br] of blots) {
        const g = l.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, rgba(D.puff, 0.6)); g.addColorStop(1, rgba(D.puff, 0));
        l.fillStyle = g; l.beginPath(); l.arc(bx, by, br, 0, 7); l.fill();
      }
      for (const [cx, cy, rot, w, a] of chips) {
        l.save(); l.translate(cx, cy); l.rotate(rot);
        l.fillStyle = rgba(D.chip, a); l.fillRect(-w / 2, -1, w, 2);
        l.fillStyle = rgba(D.chip.map(v => v * 0.6 | 0), 0.5); l.fillRect(-w / 2, 0.6, w, 0.8);
        l.restore();
      }
    });
  }
}

/** Мягкий ореол светящейся жидкости */
function glowUnder(ctx, x, y, r, fl) {
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 1.7);
  g.addColorStop(0, rgba(fl.drop, 0.2)); g.addColorStop(1, rgba(fl.drop, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.7, 0, 7); ctx.fill(); ctx.restore();
}

/**
 * Картинка лужи на ступени роста grow (0…1). Форма: слившиеся наплывы, 1–3 затёка с каплей на конце, брызги у края;
 * под лужей — впитавшееся в землю пятно, по краю — тёмный ободок, блик идёт по настоящему краю лужи и рвётся.
 * Каждый наплыв знает, когда начинает вытекать — лужа растекается наплывами, а не растягивается. Кэш по сиду,
 * жидкости и ступени
 */
const POOL_ART = new Map();
export function poolArt(seed, fl, max, grow = 1) {
  const key = `${seed}|${fl.drop}|${Math.round(max)}|${grow}`;
  if (POOL_ART.has(key)) return POOL_ART.get(key);
  // Кэш не растёт бесконечно: лужи прошлых боёв не нужны
  if (POOL_ART.size > 400) POOL_ART.clear();
  const R0 = seededRnd(`pool${seed}`), pick = (a, b) => a + R0() * (b - a);
  const S = Math.ceil(max * 4.4), C = S / 2, mk = () => { const c = document.createElement("canvas"); c.width = c.height = S; return c; };
  const blobs = [], blob = (x, y, rr, tb = 0, span = 0.45) => blobs.push({ x, y, rr, tb, span });
  blob(0, 0, max * 0.55);
  for (let i = 0, n = 4 + Math.floor(R0() * 4); i < n; i++) { const a = R0() * 6.283, d = max * pick(0.25, 0.55); blob(Math.cos(a) * d, Math.sin(a) * d * 0.85, max * pick(0.22, 0.4), pick(0.05, 0.4), 0.4); }
  // Волнистый край: мелкие наплывы по кругу
  for (let i = 0, n = 10 + Math.floor(R0() * 6); i < n; i++) { const a = i / n * 6.283 + pick(-0.2, 0.2), d = max * pick(0.58, 0.78); blob(Math.cos(a) * d, Math.sin(a) * d * 0.85, max * pick(0.08, 0.18), pick(0.3, 0.62), 0.3); }
  const flow = R0() * 6.283;
  for (let i = 0, n = Math.floor(R0() * 3); i < n; i++) {
    let a = flow + pick(-0.9, 0.9), x = Math.cos(a) * max * 0.6, y = Math.sin(a) * max * 0.55;
    const w = max * pick(0.06, 0.1), len = max * pick(0.3, 0.65), steps = 14;
    for (let j = 0; j < steps; j++) { a += pick(-0.18, 0.18); x += Math.cos(a) * len / steps; y += Math.sin(a) * len / steps; blob(x, y, w * (1 - j / steps * 0.7), 0.5 + j / steps * 0.35, 0.12); }
    blob(x + Math.cos(a) * w * 0.4, y + Math.sin(a) * w * 0.4, w * 0.55, 0.86, 0.1);
  }
  for (let i = 0, n = 3 + Math.floor(R0() * 5); i < n; i++) { const a = R0() * 6.283, d = max * pick(0.95, 1.35); blob(Math.cos(a) * d, Math.sin(a) * d, max * pick(0.04, 0.09), pick(0.8, 0.92), 0.08); }
  const raw = mk(), r = raw.getContext("2d"); r.fillStyle = "#000";
  for (const b of blobs) { const k = ease.out(clamp((grow - b.tb) / b.span)); if (k > 0) { r.beginPath(); r.arc(C + b.x, C + b.y, b.rr * k, 0, 7); r.fill(); } }
  // Наплывы сливаются размытием и порогом — гладко, без швов
  const mask = mk(), m = mask.getContext("2d", { willReadFrequently: true });
  m.filter = `blur(${Math.max(2, max * 0.06)}px)`; m.drawImage(raw, 0, 0); m.filter = "none";
  const px = m.getImageData(0, 0, S, S); for (let i = 3; i < px.data.length; i += 4) px.data[i] = px.data[i] > 110 ? 255 : 0; m.putImageData(px, 0, 0);
  const out = mk(), o = out.getContext("2d"), gl = fl.gloss ?? 1;
  o.filter = `blur(${max * 0.12}px)`; o.globalAlpha = 0.35; o.drawImage(mask, 0, 0); o.globalAlpha = 1; o.filter = "none";
  o.globalCompositeOperation = "source-in"; o.fillStyle = rgba(fl.dark, 0.5); o.fillRect(0, 0, S, S); o.globalCompositeOperation = "source-over";
  const body = mk(), bctx = body.getContext("2d"), L = LIGHT + pick(-0.35, 0.35), lx = -Math.cos(L), ly = -Math.sin(L);
  const g = bctx.createRadialGradient(C + lx * max * 0.3, C + ly * max * 0.3, max * 0.05, C, C, max * 1.2);
  g.addColorStop(0, rgba(gl > 0.5 ? fl.drop : fl.hi, 0.94)); g.addColorStop(0.5, rgba(fl.hi, 0.92)); g.addColorStop(1, rgba(fl.dark, 0.94));
  bctx.fillStyle = g; bctx.fillRect(0, 0, S, S); bctx.globalCompositeOperation = "destination-in"; bctx.drawImage(mask, 0, 0);
  o.drawImage(body, 0, 0);
  const edge = (towardLight, width, color, alpha, broken) => {
    const e = mk(), ec = e.getContext("2d");
    ec.drawImage(mask, 0, 0); ec.globalCompositeOperation = "destination-out";
    const k = towardLight ? 1 : -1; ec.drawImage(mask, -lx * width * k, -ly * width * k);
    if (towardLight) { ec.globalCompositeOperation = "destination-in"; ec.drawImage(mask, lx * width * 0.6, ly * width * 0.6); }
    if (broken) { ec.globalCompositeOperation = "destination-out"; for (let i = 0; i < 9; i++) { const a = R0() * 6.283, d = max * pick(0.2, 1.1); ec.beginPath(); ec.arc(C + Math.cos(a) * d, C + Math.sin(a) * d, max * pick(0.1, 0.3), 0, 7); ec.fill(); } }
    ec.globalCompositeOperation = "source-in"; ec.fillStyle = rgba(color, 1); ec.fillRect(0, 0, S, S);
    o.globalAlpha = alpha; o.filter = "blur(.6px)"; o.drawImage(e, 0, 0); o.filter = "none"; o.globalAlpha = 1;
  };
  edge(false, Math.max(2, max * 0.07), fl.dark, 0.7, false);
  edge(true, Math.max(2, max * 0.09), fl.wet, 0.85 * gl, true);
  o.fillStyle = rgba(fl.wet, 0.95 * gl);
  for (let i = 0, n = 1 + Math.floor(R0() * 3); i < n; i++) {
    const a = L + Math.PI + pick(-0.9, 0.9), d = max * pick(0.15, 0.5), x = C + Math.cos(a) * d, y = C + Math.sin(a) * d;
    if (m.getImageData(x | 0, y | 0, 1, 1).data[3] < 200) continue;
    o.beginPath(); o.ellipse(x, y, max * pick(0.04, 0.08), max * pick(0.02, 0.04), L + Math.PI / 2 + pick(-0.4, 0.4), 0, 7); o.fill();
  }
  const art = { img: out, S };
  POOL_ART.set(key, art);
  return art;
}

export const decals = new Decals();
export { FLUIDS };
