/**
 * Лук (bw* макета). Сверху лук виден как дуга перед лучником: левая рука держит рукоять, правая тянет тетиву к лицу,
 * стрела на тетиве. В покое лук опущен вдоль левого бока. Выстрел: поднять — натянуть — задержать — отпустить
 * (тетива щёлкает и дрожит). Приёмы: выстрел (выпад), прицельный (с замахом: долгое натяжение, линия прицела,
 * дрожь), из укрытия (исподтишка: лучник почти не виден), на ходу (наскок: шаг вбок и выстрел в движении).
 * Пращу и духовую трубку пока показывает лук.
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, ease, lerp, sp, spring } from "../util.mjs";
import { R } from "./weapon.mjs";
import { loose } from "./shafts.mjs";

const calm = () => prefs.calm;

export class BowRig {
  constructor(vis, { face = 0 } = {}) {
    this.vis = vis;
    this.up = sp(0); this.draw = sp(0);
    this.T = { up: 0, draw: 0 };
    this.k = 300; this.kd = 300;
    this.vib = 0; this.nock = 0; this.aimLine = 0; this.tremble = 0;
    this.face = this.faceLock = face;
    this.time = 0;
    this.show = 0; this.leaving = false; this.done = false;
    this.gfx = new PIXI.Graphics();
    this.gfx.eventMode = "none";
  }

  release() { this.leaving = true; this.T.up = 0; this.T.draw = 0; this.nock = 0; }
  /** Защита луком: поднят перед собой; покой — опущен */
  to(pose) { if (pose?.tag === "idle") { this.T.up = 0; this.T.draw = 0; this.nock = 0; } else this.T.up = 0.75; }

  get hs() { const v = this.vis, z = v.z; return z * (1 + (v.hop + v.alt) / (260 * z)) - 0.252 * v.duck - 0.05 * v.low; }

  /** Геометрия лука (bowGeo макета), px макета */
  geo() {
    const v = this.vis, at = v.view ?? v.at, f = this.face + v.spin, up = this.up.p, hs = this.hs;
    const ga = lerp(f - 1.45, f - 0.2, up), gr = lerp(R * 1.0, R * 1.2, up) * hs;
    const tr = this.tremble ? Math.sin(this.time * 55) * this.tremble * 1.6 : 0;
    const gx = at.x + Math.cos(ga) * gr + tr, gy = at.y - v.hop + Math.sin(ga) * gr;
    // Нормаль лука (куда смотрит спинка): в покое — наружу влево, в стрельбе — на цель
    const n = lerp(f - Math.PI / 2, f, up), nx = Math.cos(n), ny = Math.sin(n), px = -ny, py = nx;
    const L = R * 0.98 * hs, c = R * (0.2 + 0.14 * this.draw.p) * hs, pull = R * this.draw.p * 0.95 * hs;
    const tipA = { x: gx - nx * c + px * L, y: gy - ny * c + py * L }, tipB = { x: gx - nx * c - px * L, y: gy - ny * c - py * L };
    const vib = this.vib * Math.sin(this.time * 70) * 5;
    const nock = { x: gx - nx * (c + pull - vib), y: gy - ny * (c + pull - vib) };
    return { gx, gy, nx, ny, px, py, L, c, tipA, tipB, nock, n, hs, up };
  }

  /** Где наконечник стрелы на тетиве */
  tip() { const g = this.geo(); return { x: g.nock.x + g.nx * R * 1.55 * g.hs, y: g.nock.y + g.ny * R * 1.55 * g.hs, a: g.n }; }

  update(dt) {
    this.time += dt;
    this.face += Math.atan2(Math.sin(this.faceLock - this.face), Math.cos(this.faceLock - this.face)) * clamp(dt * 8);
    spring(this.up, this.T.up, this.k, 2 * Math.sqrt(this.k) * 0.85, dt);
    spring(this.draw, this.T.draw, this.kd, 2 * Math.sqrt(this.kd) * 0.7, dt);
    this.vib = Math.max(0, this.vib - dt * 3.5);
    this.show = this.leaving ? Math.max(0, this.show - dt / 0.25) : Math.min(1, this.show + dt / 0.1);
    if (this.leaving && this.show <= 0) this.done = true;
  }

  render() {
    const v = this.vis, t = v.token, u = v.u, g = this.gfx;
    const seen = t.visible && t.mesh?.visible && this.show > 0.01;
    const parent = this.held ? fx.ground(t.document.elevation) : fx.over(t.document.elevation);
    if (!seen) { g.parent?.removeChild(g); return; }
    if (g.parent !== parent) parent.addChild(g);
    const G = this.geo(), U = p => [p.x * u, p.y * u];
    g.clear();
    g.alpha = this.show;
    const limbs = (dx, dy) => {
      const m1 = { x: G.gx + G.nx * G.L * 0.12 + G.px * G.L * 0.6 + dx, y: G.gy + G.ny * G.L * 0.12 + G.py * G.L * 0.6 + dy };
      const m2 = { x: G.gx + G.nx * G.L * 0.12 - G.px * G.L * 0.6 + dx, y: G.gy + G.ny * G.L * 0.12 - G.py * G.L * 0.6 + dy };
      g.moveTo(...U({ x: G.tipA.x + dx, y: G.tipA.y + dy }));
      g.quadraticCurveTo(...U(m1), ...U({ x: G.gx + dx, y: G.gy + dy }));
      g.quadraticCurveTo(...U(m2), ...U({ x: G.tipB.x + dx, y: G.tipB.y + dy }));
    };
    g.lineStyle({ width: 5 * u, color: 0x0a0e1e, alpha: 0.3, cap: "round" }); limbs(4, 6);
    // Прицел — тонкая линия к цели (прицельный выстрел), пунктиром
    if (this.aimLine > 0.02 && this.nock) {
      const tp = this.tip();
      g.lineStyle({ width: 1.5 * u, color: 0xfff0c8, alpha: 0.35 * this.aimLine });
      for (let d = 0; d < 400; d += 11) { g.moveTo(...U({ x: tp.x + Math.cos(tp.a) * d, y: tp.y + Math.sin(tp.a) * d })); g.lineTo(...U({ x: tp.x + Math.cos(tp.a) * (d + 4), y: tp.y + Math.sin(tp.a) * (d + 4) })); }
    }
    // Тетива: к точке натяжения, в покое — прямая (дрожит после выстрела)
    g.lineStyle({ width: 1 * u, color: 0xebe2cd, alpha: 0.75 });
    g.moveTo(...U(G.tipA)); g.lineTo(...U(G.nock)); g.lineTo(...U(G.tipB));
    g.lineStyle({ width: 5 * u, color: 0x5b3a1e, cap: "round" }); limbs(0, 0);
    g.lineStyle({ width: 2 * u, color: 0xa2723f, cap: "round" }); limbs(0, 0);
    g.lineStyle(0); g.beginFill(0x3a2416); g.drawCircle(G.gx * u, G.gy * u, 3.6 * u); g.endFill();
    // Стрела на тетиве: наконечник впереди, оперение у тетивы
    if (this.nock) {
      const len = R * 1.55 * G.hs, tp = { x: G.nock.x + G.nx * len, y: G.nock.y + G.ny * len }, c = Math.cos(G.n), s = Math.sin(G.n);
      const P = (x, y) => [(tp.x + c * x - s * y) * u, (tp.y + s * x + c * y) * u];
      g.lineStyle({ width: 2.2 * u, color: 0xd2bc90 }); g.moveTo(...P(-len, 0)); g.lineTo(...P(0, 0));
      g.lineStyle({ width: 0.8 * u, color: 0x3b3f44 }); g.beginFill(0xc9ced3); g.drawPolygon([...P(6, 0), ...P(-3, -3.5), ...P(-3, 3.5)]); g.endFill();
      g.lineStyle(0); g.beginFill(0xb5372c); g.drawPolygon([...P(-len + 9, 0), ...P(-len, -4), ...P(-len + 2, 0), ...P(-len, 4)]); g.endFill();
    }
    // Руки: левая на рукояти, правая у тетивы
    if (G.up > 0.4) {
      g.lineStyle({ width: 1.2 * u, color: 0x2d2118 });
      for (const q of [{ x: G.gx, y: G.gy }, G.nock]) { g.beginFill(0xc9a27c); g.drawCircle(q.x * u, q.y * u, R * 0.13 * u); g.endFill(); }
    }
  }

  destroy() { if (!this.gfx.destroyed) this.gfx.destroy(); }
}

/* ---------- Шаги лучника ---------- */

const raise = (A, dur = 0.16) => ({ dur, start() { const B = A.a.rig; B.k = 500; B.T.up = 1; B.nock = 1; } });
const drawStep = (A, dur, low) => ({
  dur, start() { A.a.rig.kd = 260; A.a.rig.T.draw = 1; },
  fn(k) { const a = A.a; a.squash = 0.05 * k; a.leanDir = A.dir; a.lean.p = -0.04 * k; if (low) a.low = 1; }
});
function release(A, o, flight) {
  return {
    dur: 0.02,
    start() {
      const a = A.a, B = a.rig;
      flight.S = loose(A, B.tip(), o);
      B.nock = 0; B.kd = 2600; B.T.draw = 0; B.vib = 1; B.aimLine = 0; B.tremble = 0;
      a.lean.v -= 1.6; a.sx.v += 2; a.hide = 0;
    }
  };
}
/** Ждать, пока стрела долетит и цель доуклоняется */
const wait = (A, flight) => ({ dur: 2, fn() { if (!flight.S?.flying && !A.b.react.dodge) this.cut = true; } });
const lower = (A, dur = 0.35) => ({
  dur, start() { A.a.rig.k = 220; },
  fn(k) { const a = A.a; if (k > 0.4) a.rig.T.up = 0; a.low = Math.max(0, a.low - 0.06); a.lean.p = 0; a.squash = 0; }
});
function finish(A) {
  const a = A.a;
  if (a.rig) { a.rig.T.up = 0; a.rig.nock = 0; }
  a.low = 0; a.hide = 0;
  A.place(A.home); A.ax.v = A.ay.v = 0; a.squash = 0; a.lean.p = 0;
}

function plain(A) {
  const f = {};
  A.seq([raise(A), drawStep(A, 0.3 * A.rng.range(0.9, 1.1)), { dur: 0.07 }, release(A, {}, f), wait(A, f), lower(A)], () => finish(A));
}

function aimed(A) {
  const f = {};
  A.seq([raise(A, 0.2), drawStep(A, 0.45),
    { dur: 0.38, fn(k) { const B = A.a.rig; B.aimLine = Math.min(1, k * 2); B.tremble = k > 0.5 ? (k - 0.5) * 1.2 : 0; } },
    release(A, { speed: 1600, power: 1.5, deep: true }, f), wait(A, f), lower(A)], () => finish(A));
}

function hidden(A) {
  const f = {}, a = A.a;
  A.seq([{ dur: 0.14, fn(k) { a.hide = k; a.low = k; } }, raise(A, 0.14), drawStep(A, 0.22, true), { dur: 0.05 },
    release(A, { speed: 1250, power: 1.3 }, f), { dur: 0.1, fn() { a.hide = 0; } }, wait(A, f), lower(A)], () => finish(A));
}

function moving(A) {
  const f = {}, a = A.a, H = A.home, side = A.rng.sign(), B0 = A.b.home;
  const to = { x: H.x + Math.cos(A.dir + side * Math.PI / 2) * 55, y: H.y + Math.sin(A.dir + side * Math.PI / 2) * 55 };
  const move = k => {
    const e = ease.inOut(k), p = { x: lerp(H.x, to.x, e), y: lerp(H.y, to.y, e) };
    A.place(p); a.hop = 4 * Math.abs(Math.sin(k * Math.PI * 2));
    A.dir = Math.atan2(B0.y - p.y, B0.x - p.x); A.dx = Math.cos(A.dir); A.dy = Math.sin(A.dir); a.rig.faceLock = A.dir;
  };
  let from;
  A.seq([
    { dur: 0.1, start() { const B = a.rig; B.k = 700; B.T.up = 1; B.nock = 1; }, fn(k) { move(k * 0.25); } },
    { dur: 0.2, start() { a.rig.kd = 400; a.rig.T.draw = 1; }, fn(k) { move(0.25 + k * 0.55); } },
    release(A, { speed: 1150 }, f),
    { dur: 0.12, fn(k) { move(0.8 + k * 0.2); if (k >= 1) { a.hop = 0; const p = A.sc(A.pos); fx.dust(p.x, p.y + R * 0.6 * A.u, A.elev, calm() ? 1 : 4, 0.5); } } },
    wait(A, f), lower(A, 0.2),
    { dur: 0.3, start() { from = A.pos; }, fn(k) { const e = ease.inOut(k); A.place({ x: lerp(from.x, H.x, e), y: lerp(from.y, H.y, e) }); } }
  ], () => finish(A));
}

export function bow(A, style) {
  ({ lunge: plain, heavy: aimed, sneak: hidden, leap: moving }[style] ?? plain)(A);
}
