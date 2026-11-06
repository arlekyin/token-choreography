/**
 * Кровь удара: брызги летят каплями и ложатся на землю пятнами, рубящий оставляет мазок поперёк удара, дробящий и
 * крит — красную взвесь. Сколько — от доли ПЗ, которую снимет удар; куда и как — от вида урона; чем — от типа
 * существа (fluids.mjs). Огонь прижигает: опалина и тлеющие искры вместо крови. Кто не течёт — пыль и осколки.
 *
 * Атака несёт A.gore: {type, share, fluid, seed} — общий у всех клиентов (зерно из сообщения). Место, куда упадёт
 * капля, и её пятно считаются в момент вылета, поэтому у всех они одинаковые, как бы ни шли кадры.
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { decals, seededRnd } from "./decals.mjs";
import { FLUIDS, DUSTS, fluidOf, hex } from "./fluids.mjs";
import { stain } from "./blade.mjs";

/** Разлёт капель по виду урона: веер — рубящий, узкая быстрая струя — колющий, во все стороны — дробящий */
const WOUND = {
  slash: { spread: 0.9, speed: [70, 210], up: [40, 120] },
  pierce: { spread: 0.24, speed: [130, 330], up: [20, 80] },
  blunt: { spread: 2.8, speed: [40, 150], up: [60, 150] }
};
const GRAVITY = 900;

/** Сколько крови вообще (настройка «Кровь» и спокойные эффекты) */
export const goreK = () => prefs.gore === "off" ? 0 : (prefs.gore === "low" ? 0.5 : 1) * (prefs.calm ? 0.5 : 1);

class Spray {
  drops = [];
  mists = [];
  embers = [];
  chips = [];
  /** elevation → Graphics над токенами */
  #gfx = new Map();

  /**
   * Кровь у точки удара (px сцены). n — сколько (как в макете), A — атака (её A.gore)
   */
  blood(x, y, elevation, dir, n, A) {
    const g = A?.gore;
    if (!g || !fx.active || goreK() <= 0) return;
    const u = fx.u, mx = x / u, my = y / u;
    // Каждая точка крови своей атаки — своё зерно: у всех клиентов одно и то же
    const r = seededRnd(`${g.seed}:${g.calls = (g.calls ?? 0) + 1}`), rnd = (a, b) => a + r() * (b - a);
    if (!g.hit) { g.hit = true; this.#onHit(A); }
    const crit = A.crit, share = g.share, K = goreK();
    if (g.type === "fire") return this.#scorch(mx, my, elevation, dir, n, crit, share, r);
    const fl = fluidOf(g.fluid);
    if (!fl) return this.#dust(mx, my, elevation, dir, n, DUSTS[g.fluid] ?? DUSTS.elemental, r);
    if (fl.embers) for (let i = 0, m = Math.round(7 * K); i < m; i++) { const a = dir + rnd(-1, 1), v = rnd(40, 130); this.embers.push({ x: mx, y: my, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: rnd(0.4, 0.9), age: 0, elevation }); }
    const W0 = WOUND[g.type] ?? WOUND.slash, k = (0.6 + share * 1.2) * (crit ? 1.5 : 1) * K;
    const count = Math.min(70, Math.max(2, Math.round(n * k * 2.4)));
    for (let i = 0; i < count; i++) {
      const a = dir + rnd(-W0.spread, W0.spread), v = rnd(...W0.speed) * (crit ? 1.15 : 1) * (0.75 + share * 0.35);
      this.launch(mx, my, elevation, Math.cos(a) * v, Math.sin(a) * v, rnd(10, 20), rnd(...W0.up), dropSize(r) * (1 + share * 0.4), fl, r());
    }
    // Сама рана — пятно сразу у места удара
    decals.splat(mx, my, elevation, fl, dir, rnd(2.5, 4) * (1 + share * 0.8), r, { alpha: 0.75, sats: 2, stretch: 1.2 });
    if (g.type === "slash") decals.smear(mx + Math.cos(dir) * 6, my + Math.sin(dir) * 6, elevation, fl, dir, 18 + 34 * share, r);
    if (g.type === "blunt" || crit) for (let i = 0, m = Math.round((crit ? 14 : 6) * K); i < m; i++) {
      const a = dir + rnd(-2.8, 2.8), v = rnd(20, 90);
      this.mists.push({ fl, x: mx, y: my, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rnd(7, 16) * (1 + share * 0.5), life: rnd(0.5, 0.95), age: 0, elevation });
    }
  }

  /**
   * Капля в воздух: где упадёт и каким пятном — решается сразу (seed), полёт только показывает это.
   * x, y, z, vx, vy, vz — px макета и px/с
   */
  launch(x, y, elevation, vx, vy, z, vz, size, fl, seed) {
    const t = (vz + Math.sqrt(vz * vz + 2 * GRAVITY * z)) / GRAVITY;
    this.drops.push({ x, y, z, vx, vy, vz, r: size, fl, seed, t, age: 0, elevation, x0: x, y0: y, z0: z });
  }

  /** Попал: клинок бьющего пачкается жидкостью цели */
  #onHit(A) {
    const g = A.gore, rig = A.a.rig;
    if (!fluidOf(g.fluid) || g.type === "fire" || !g.melee || !rig?.K?.kind) return;
    stain(A.a.token.document.id, rig.K.kind, g.fluid, 0.07 + 0.12 * g.share + (A.crit ? 0.06 : 0), { face: A.dir, two: rig.two });
    // Для лужи под павшим: кто бил последним и чем
    lastHits.set(A.b.token.document.id, { tokenId: A.a.token.document.id, kind: rig.K.kind, at: Date.now() });
  }

  /** Огонь: опалина на земле и тлеющие искры, крови нет */
  #scorch(x, y, elevation, dir, n, crit, share, r) {
    const rnd = (a, b) => a + r() * (b - a), size = (10 + 18 * share) * (crit ? 1.5 : 1);
    decals.paint(x, y, size, elevation, l => {
      const g = l.createRadialGradient(x, y, 0, x, y, size);
      g.addColorStop(0, "rgba(20,12,8,.75)"); g.addColorStop(0.6, "rgba(40,22,10,.45)"); g.addColorStop(1, "rgba(40,22,10,0)");
      l.fillStyle = g; l.beginPath(); l.arc(x, y, size, 0, 7); l.fill();
    });
    for (let i = 0, m = Math.round((6 + n * 2) * (crit ? 2 : 1) * goreK()); i < m; i++) { const a = dir + rnd(-1.4, 1.4), v = rnd(40, 160); this.embers.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: rnd(0.5, 1.2), age: 0, elevation }); }
  }

  /** Кто не течёт: облачко пыли и осколки по удару */
  #dust(x, y, elevation, dir, n, D, r) {
    const rnd = (a, b) => a + r() * (b - a);
    for (let i = 0, m = Math.round((6 + n * 2) * D.amount * goreK()); i < m; i++) {
      const a = dir + rnd(-1.2, 1.2), v = rnd(50, 170);
      if (r() < 0.5) this.chips.push({ c: D.chip, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: rnd(1.2, 3) * (D.heap ? 0.8 : 1), rot: rnd(0, 6), age: 0, life: rnd(0.4, 0.8), elevation });
      else this.chips.push({ puff: true, c: D.puff, x, y, vx: Math.cos(a) * v * 0.4, vy: Math.sin(a) * v * 0.4, size: rnd(6, 12), age: 0, life: rnd(0.5, 0.9), elevation });
    }
  }

  update(dt) {
    if (!fx.active) return;
    for (const d of this.drops) {
      d.age += dt;
      const t = Math.min(d.age, d.t);
      d.x = d.x0 + d.vx * t; d.y = d.y0 + d.vy * t; d.z = Math.max(0, d.z0 + d.vz * t - GRAVITY / 2 * t * t);
      if (d.age >= d.t) {
        // Упала: пятно, вытянутое по полёту, тем длиннее, чем быстрее летела
        const sp = Math.hypot(d.vx, d.vy), r = seededRnd(d.seed);
        decals.splat(d.x, d.y, d.elevation, d.fl, Math.atan2(d.vy, d.vx), d.r, r, { alpha: 0.8, sats: d.r > 2 && sp > 180 ? 2 : 0, stretch: 1 + sp / 260 });
        d.done = true;
      }
    }
    this.drops = this.drops.filter(d => !d.done);
    for (const m of this.mists) { m.age += dt; m.x += m.vx * dt; m.y += m.vy * dt; m.vx *= Math.pow(0.9, dt * 200); m.vy *= Math.pow(0.9, dt * 200); }
    this.mists = this.mists.filter(m => m.age < m.life);
    for (const e of this.embers) { e.age += dt; e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= Math.pow(0.96, dt * 200); e.vy = e.vy * Math.pow(0.96, dt * 200) - 20 * dt; }
    this.embers = this.embers.filter(e => e.age < e.life);
    for (const c of this.chips) { c.age += dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= Math.pow(0.93, dt * 200); c.vy *= Math.pow(0.93, dt * 200); }
    this.chips = this.chips.filter(c => c.age < c.life);
    this.#render();
  }

  #render() {
    const u = fx.u, used = new Set();
    const gfx = e => {
      const key = Math.round((e || 0) * 100) / 100;
      let g = this.#gfx.get(key);
      const parent = fx.over(key);
      if (!g || g.destroyed) { g = new PIXI.Graphics(); g.eventMode = "none"; this.#gfx.set(key, g); }
      if (g.parent !== parent) parent.addChild(g);
      if (!used.has(key)) { g.clear(); used.add(key); }
      return g;
    };
    for (const m of this.mists) {
      const k = m.age / m.life, g = gfx(m.elevation);
      g.beginFill(hex(m.fl.drop), (1 - k) * 0.28); g.drawCircle(m.x * u, m.y * u, m.r * (0.7 + k * 1.1) * u); g.endFill();
    }
    for (const d of this.drops) {
      const g = gfx(d.elevation);
      // Тень капли на земле, сама капля — выше на высоту полёта
      g.beginFill(0x000000, 0.18 * Math.max(0, 1 - d.z / 60)); g.drawEllipse(d.x * u, d.y * u, d.r * u, d.r * 0.6 * u); g.endFill();
      g.beginFill(hex(d.fl.drop), 0.95); g.drawCircle(d.x * u, (d.y - d.z * 0.45) * u, d.r * (1 + d.z / 90) * u); g.endFill();
    }
    for (const e of this.embers) {
      const k = e.age / e.life, g = gfx(e.elevation);
      g.beginFill((255 << 16) | (((150 + 80 * (1 - k)) | 0) << 8) | 60, 1 - k); g.drawCircle(e.x * u, e.y * u, (2.2 * (1 - k) + 0.6) * u); g.endFill();
    }
    for (const c of this.chips) {
      const k = c.age / c.life, g = gfx(c.elevation);
      if (c.puff) { g.beginFill(hex(c.c), (1 - k) * 0.55); g.drawCircle(c.x * u, c.y * u, c.size * (0.7 + k * 0.8) * u); g.endFill(); continue; }
      const a = c.rot + c.age * 14, w = c.size * u, h = c.size * 0.4 * u, cs = Math.cos(a), sn = Math.sin(a);
      g.beginFill(hex(c.c), 1 - k);
      g.drawPolygon([c.x * u - cs * w + sn * h, c.y * u - sn * w - cs * h, c.x * u + cs * w + sn * h, c.y * u + sn * w - cs * h, c.x * u + cs * w - sn * h, c.y * u + sn * w + cs * h, c.x * u - cs * w - sn * h, c.y * u - sn * w + cs * h]);
      g.endFill();
    }
    for (const [key, g] of this.#gfx) if (!used.has(key) && !g.destroyed) g.clear();
  }

  clear() {
    this.drops = []; this.mists = []; this.embers = []; this.chips = [];
    for (const g of this.#gfx.values()) if (!g.destroyed) g.destroy();
    this.#gfx.clear();
  }
}

/** Размер капли: в основном мелкие, изредка крупная */
export const dropSize = (r = Math.random) => 0.7 + Math.pow(r(), 2.6) * 3.6;

/** Цель → кто бил её последним и чем: {tokenId, kind, at} */
export const lastHits = new Map();

export const spray = new Spray();
export { FLUIDS };
