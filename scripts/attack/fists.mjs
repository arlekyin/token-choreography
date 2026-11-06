/**
 * Без оружия (монах, безоружный удар): fs* макета. Кулаки — две точки перед телом (угол от взгляда и расстояние
 * от центра), стопа — для ударов ногой. Удар — кулак выстреливает и возвращается в стойку, корпус доворачивается.
 * Попадание — звезда в точке контакта, цель отбрасывает без крови (крит — капля).
 * Приёмы: двойка (выпад), удар в прыжке (наскок), удар в точку (исподтишка — цель цепенеет),
 * открытая ладонь (с замахом — сбор ци, цель отлетает на клетку).
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, ease, lerp, sp, spring } from "../util.mjs";
import { R } from "./weapon.mjs";
import { evade, readyCounter } from "./melee.mjs";

const calm = () => prefs.calm;
/** Стойка: левый кулак чуть впереди, правый у подбородка; нога спрятана */
const FGUARD = { L: { a: -0.5, r: R * 1.02 }, R: { a: 0.42, r: R * 0.9 }, F: { a: 0.5, r: R * 0.5, on: 0 } };
const fsStand = () => R * 2.35;

/** Кулаки и стопа у токена (вместо картинки оружия) */
export class FistRig {
  constructor(vis, { face = 0 } = {}) {
    this.vis = vis;
    const h = (P, on) => ({ a: sp(P.a), r: sp(P.r), on: sp(on ?? 1), trail: [], last: null });
    this.hands = { L: h(FGUARD.L), R: h(FGUARD.R), F: h(FGUARD.F, 0) };
    this.T = JSON.parse(JSON.stringify(FGUARD));
    this.k = 700;
    this.face = this.faceLock = face;
    this.ki = 0; this.kiHold = false;
    this.show = 0; this.leaving = false; this.done = false;
    this.gfx = new PIXI.Graphics();
    this.gfx.eventMode = "none";
  }

  /** Руки к позе: можно задать только часть (одну руку, ногу) */
  to(pose, k) { for (const n of ["L", "R", "F"]) if (pose[n]) this.T[n] = { ...this.T[n], ...pose[n] }; if (k) this.k = k; }
  guard(k = 900) { this.to(FGUARD, k); }
  release() { this.leaving = true; }

  get hs() { const v = this.vis, z = v.z; return z * (1 + (v.hop + v.alt) / (260 * z)) - 0.252 * v.duck - 0.05 * v.low; }

  /** Где рука n, px макета */
  pos(n) {
    const v = this.vis, h = this.hands[n], f = this.face + v.spin, hs = this.hs, at = v.view ?? v.at;
    return { x: at.x + Math.cos(f + h.a.p) * h.r.p * hs, y: at.y - v.hop + Math.sin(f + h.a.p) * h.r.p * hs, a: f + h.a.p, hs };
  }

  update(dt) {
    this.face += Math.atan2(Math.sin(this.faceLock - this.face), Math.cos(this.faceLock - this.face)) * clamp(dt * 8);
    const k = this.k, z = 2 * Math.sqrt(k) * 0.78;
    for (const n of ["L", "R", "F"]) {
      const h = this.hands[n], T = this.T[n];
      spring(h.a, T.a, k, z, dt); spring(h.r, T.r, k, z, dt); spring(h.on, T.on ?? 1, 400, 40, dt);
      // Росчерк быстрого удара
      const p = this.pos(n), q = h.last;
      h.last = p;
      if (q && dt > 0 && Math.hypot(p.x - q.x, p.y - q.y) / dt > (n === "F" ? 150 : 520) && h.on.p > 0.5) {
        if (!h.trail.length) h.trail.push({ ...q, age: 0 });
        h.trail.push({ ...p, age: 0 });
      }
      for (const o of h.trail) o.age += dt;
      h.trail = h.trail.filter(o => o.age < 0.1).slice(-10);
    }
    this.ki = Math.max(0, this.ki - (this.kiHold ? 0 : dt * 3));
    this.show = this.leaving ? Math.max(0, this.show - dt / 0.18) : Math.min(1, this.show + dt / 0.1);
    if (this.leaving && this.show <= 0) this.done = true;
  }

  render() {
    const v = this.vis, t = v.token, u = v.u, g = this.gfx;
    const seen = t.visible && t.mesh?.visible && this.show > 0.01;
    const parent = this.held ? fx.ground(t.document.elevation) : fx.over(t.document.elevation);
    if (!seen) { g.parent?.removeChild(g); return; }
    if (g.parent !== parent) parent.addChild(g);
    g.clear();
    g.alpha = this.show;
    // Росчерки: у рук — тонкие, у ноги — широкий светлый серп
    for (const n of ["L", "R", "F"]) {
      const tr = this.hands[n].trail, wide = n === "F";
      for (let i = 1; i < tr.length; i++) {
        const q = tr[i], o = tr[i - 1], a = (1 - q.age / 0.1) * (i / tr.length);
        g.lineStyle({ width: ((wide ? 26 : 12) * a + 1) * u, color: wide ? 0xffeed2 : 0xfff8e6, alpha: a * (wide ? 0.6 : 0.55), cap: "round" });
        g.moveTo(o.x * u, o.y * u); g.lineTo(q.x * u, q.y * u);
      }
    }
    // Стопа: подошва в сандалии, носком по ходу удара
    const F = this.hands.F;
    if (F.on.p > 0.05) {
      const p = this.pos("F"), m = R * 0.021 * p.hs, al = Math.min(1, F.on.p * 1.4), c = Math.cos(p.a), s = Math.sin(p.a);
      const P = (x, y) => [(p.x + c * x - s * y) * u, (p.y + s * x + c * y) * u];
      const oval = (cx, cy, rx, ry, fill, line) => {
        const pts = [];
        for (let i = 0; i < 16; i++) { const an = i / 16 * 6.283; pts.push(...P(cx + Math.cos(an) * rx, cy + Math.sin(an) * ry)); }
        g.lineStyle(line ? { width: 1.6 * u, color: 0x2a1d12, alpha: al } : 0);
        g.beginFill(fill, line ? al : 0.3 * al); g.drawPolygon(pts); g.endFill();
      };
      oval(3 + 2 * m + 3, 4, 12 * m, 7.5 * m, 0x0a0e1e, false);
      oval(4 * m, 0, 11 * m, 7 * m, 0xc9a77a, true);
      oval(-9 * m, 0, 6.5 * m, 5.5 * m, 0xc9a77a, true);
    }
    for (const n of ["L", "R"]) {
      const p = this.pos(n), r = R * 0.21 * p.hs;
      // Ци в ладони: мягкое сияние
      if (n === "R" && this.ki > 0.02) {
        g.lineStyle(0);
        for (let i = 4; i >= 1; i--) { g.beginFill(0xc8ebff, 0.18 * this.ki); g.drawCircle(p.x * u, p.y * u, (r + r * this.ki * i) * u); g.endFill(); }
      }
      g.lineStyle(0); g.beginFill(0x0a0e1e, 0.3); g.drawCircle((p.x + 3) * u, (p.y + 4) * u, r * u); g.endFill();
      g.lineStyle({ width: 1.6 * u, color: 0x2d2118 }); g.beginFill(0xdcc79f); g.drawCircle(p.x * u, p.y * u, r * u); g.endFill();
      // Обмотка и костяшки — с той стороны, куда смотрит кулак
      const c = Math.cos(p.a), s = Math.sin(p.a), P = (x, y) => [(p.x + c * x - s * y) * u, (p.y + s * x + c * y) * u];
      g.lineStyle({ width: 1.1 * u, color: 0x3c2a1c, alpha: 0.75 });
      for (const y of [-0.45, 0, 0.45]) { g.moveTo(...P(r * 0.35, y * r)); g.lineTo(...P(r * 0.85, y * r * 0.9)); }
      g.moveTo(...P(-r * 0.6, -r * 0.75)); g.lineTo(...P(-r * 0.2, r * 0.8));
    }
  }

  destroy() { if (!this.gfx.destroyed) this.gfx.destroy(); }
}

/** Звезда удара кулаком (или отпечаток подошвы) в точке контакта */
function burst(A, at, { r = 12, life = 0.16, color = 0xfff6dc, sole = false, dir = 0 } = {}) {
  const u = A.u, g = new PIXI.Graphics(), c = A.sc(at), rot = sole ? dir : Math.random();
  g.position.set(c.x, c.y);
  g.rotation = rot;
  fx.add(g, life, k => {
    const sc = r * (k < 0.3 ? k / 0.3 : 1 + (k - 0.3) * 0.4) * u;
    g.clear();
    g.alpha = 1 - clamp((k - 0.4) / 0.6);
    if (sole) {
      const m = sc / 15;
      g.lineStyle({ width: 2 * u, color: 0x281c12, alpha: 0.8 }); g.beginFill(color);
      g.drawEllipse(5 * m, 0, 12 * m, 8 * m); g.drawEllipse(-12 * m, 0, 7 * m, 6.5 * m); g.endFill();
      return;
    }
    const pts = [];
    for (let i = 0; i < 16; i++) { const rr = i % 2 ? sc * 0.42 : sc, an = i / 16 * 6.283; pts.push(Math.cos(an) * rr, Math.sin(an) * rr); }
    g.beginFill(color); g.drawPolygon(pts); g.endFill();
  }, { elevation: A.b.token.document.elevation });
}

function fsHit(A, dir, power, at, crit) {
  const b = A.b, dx = Math.cos(dir), dy = Math.sin(dir);
  power *= A.sizeK;
  A.stop(Math.min(0.13, 0.035 + 0.04 * power));
  b.react.white = Math.min(1, 0.5 + 0.3 * power); b.ox.v += dx * 300 * power; b.oy.v += dy * 300 * power; b.sx.v -= 4 * power; b.sy.v += 3 * power;
  b.react.stagger = { t: 0, amp: 0.05 * power, dir, twist: A.rng.range(-0.2, 0.2) * power };
  burst(A, at, { r: 9 + 7 * power, life: 0.16 + 0.04 * power });
  if (power > 1.1) { const c = A.sc(at); fx.ring(c.x, c.y, A.elev, { r: 6, life: 0.22, w: 3, grow: 40 * power, hit: true }); }
  if (crit) { const c = A.sc(b.home); fx.blood(c.x, c.y, b.token.document.elevation, dir, 3, A); }
  A.shake(2 * power * power);
}

function dodgeOf(A) {
  const b = A.b;
  if (A.dodge === "duck") b.react.dodge = { kind: "duck", dir: A.dir, t: 0 };
  else if (A.dodge === "back") b.react.dodge = { kind: "back", dir: A.dir, t: 0 };
  else if (A.dodge !== "parry") b.react.dodge = { kind: "side", dir: A.dir + Math.PI / 2 * A.rng.sign(), t: 0 };
}

/** Исход удара рукой n (или ногой F) */
function fsResolve(A, n, power) {
  const a = A.a, b = A.b, f = a.rig, at = f.pos(n);
  if (A.miss && A.dodge === "parry" && b.rig) { A.done = "parry"; evade(A, A.dir, "parry", "sneak", false); A.ax.v = A.ay.v = 0; f.hands[n].r.v -= 300; return; }
  if (A.miss) { A.done = "miss"; const p = A.sc(A.pos); fx.whiff(p.x + A.dx * R * 1.2 * A.u, p.y + A.dy * R * 1.2 * A.u, A.elev, A.dir); readyCounter(A, 0.32); return; }
  if (A.glance) {
    A.done = "glance";
    A.stop(0.04); b.react.ringFlash = 0.8; b.ox.v += A.dx * 140; b.oy.v += A.dy * 140;
    burst(A, at, { r: 8, life: 0.12, color: 0xd8dde6 });
    f.hands[n].r.v -= 260; a.sx.v += 2;
    return;
  }
  A.done = "hit";
  fsHit(A, A.dir, power * (A.crit ? 1.5 : 1), at, A.crit);
  if (n === "F") burst(A, at, { r: 21, life: 0.4, sole: true, dir: A.dir, color: 0xfff6dc });
}

const at = (A, d) => { const B = A.b.home; return { x: B.x - A.dx * (d + A.gap), y: B.y - A.dy * (d + A.gap) }; };

function back(A, dur = 0.26) {
  let from;
  return {
    dur, start() { from = A.pos; A.a.rig.guard(); },
    fn(k) { const e = ease.out(k), a = A.a; A.place({ x: lerp(from.x, A.home.x, e), y: lerp(from.y, A.home.y, e) }); a.spin *= (1 - k); a.lean.p = 0; a.squash = 0; a.hop = 0; }
  };
}

function done(A) {
  const a = A.a, f = a.rig;
  A.place(A.home); A.ax.v = A.ay.v = 0;
  a.spin = 0; a.hop = 0; a.squash = 0; a.lean.p = 0; a.low = 0;
  if (f) { f.ki = 0; f.kiHold = false; f.guard(); }
}

/** Подшаг в дистанцию удара с поднятыми кулаками */
function step(A, dur, to) {
  let from;
  return {
    dur, start() { from = A.pos; A.a.rig.to({ L: { a: -0.35, r: R * 1.05 }, R: { a: 0.32, r: R * 0.95 } }, 900); },
    fn(k) { const e = ease.inOut(k), w = to ?? at(A, fsStand()), a = A.a; A.place({ x: lerp(from.x, w.x, e), y: lerp(from.y, w.y, e) }); a.hop = 3 * Math.sin(k * Math.PI); a.leanDir = A.dir; a.lean.p = 0.05; }
  };
}

/** Двойка: джеб левой — прямой правой с доворотом корпуса */
function fsTwo(A) {
  const a = A.a, f = a.rig, steps = [step(A, 0.16)];
  steps.push({
    dur: 0.08, start() { if (A.miss) dodgeOf(A); f.to({ L: { a: -0.08, r: R + 18 } }, 6500); }, fn(k) { a.spin = -0.15 * k; },
    end() { if (!A.miss && !A.glance) fsHit(A, A.dir, 0.45, f.pos("L"), false); }
  });
  steps.push({
    dur: 0.1, start() { f.to({ L: FGUARD.L, R: { a: 0.04, r: R + 22 } }, 6500); },
    fn(k) { a.spin = lerp(-0.15, 0.32, ease.out(k)); a.leanDir = A.dir; a.lean.p = 0.12; A.place(at(A, fsStand() - 6 * k)); },
    end() { fsResolve(A, "R", 1); }
  });
  steps.push({ dur: 0.08 }, back(A));
  A.seq(steps, () => done(A));
}

/** Удар в прыжке: присед, прыжок по дуге — нога вперёд к приземлению */
function fsLeap(A) {
  const a = A.a, f = a.rig, land = at(A, fsStand() + 8);
  let from;
  const steps = [
    { dur: 0.12, start() { f.to({ L: { a: -0.7, r: R * 0.85 }, R: { a: 0.7, r: R * 0.85 } }, 900); }, fn(k) { a.squash = 0.16 * k; } },
    {
      dur: 0.32, start() { from = A.pos; a.squash = -0.06; if (A.miss && A.dodge !== "parry") A.later(0.12, () => dodgeOf(A)); },
      fn(k) {
        const e = ease.inOut(k);
        A.place({ x: lerp(from.x, land.x, e), y: lerp(from.y, land.y, e) });
        a.hop = 62 * Math.sin(k * Math.PI) * (A.dodge === "duck" && A.miss ? 1.2 : 1); a.leanDir = A.dir; a.lean.p = 0.1;
        if (k > 0.45) f.to({ F: { a: 0.08, r: R + 30, on: 1 }, L: { a: -1.1, r: R * 0.9 }, R: { a: 1.2, r: R * 0.8 } }, 3000);
        a.spin = -0.25 * k;
      },
      end() { a.hop = 0; const p = A.sc(A.pos); fx.dust(p.x, p.y + R * 0.5 * A.u, A.elev, calm() ? 2 : 8, 0.8); a.sx.v -= 5; a.sy.v += 4; fsResolve(A, "F", 1.35); }
    },
    { dur: 0.12, start() { f.to({ F: { a: 0.5, r: R * 0.5, on: 0 } }, 900); } },
    back(A, 0.3)
  ];
  A.seq(steps, () => done(A));
}

/** Удар в точку: шаг во фланг, пригнувшись, — два пальца в шею; цель цепенеет */
function fsPoint(A) {
  const a = A.a, b = A.b, f = a.rig, side = A.rng.sign(), B = b.home;
  const ang = A.dir + Math.PI + side * 1.05, D = fsStand() + A.gap, spot = { x: B.x + Math.cos(ang) * D, y: B.y + Math.sin(ang) * D };
  let from;
  const steps = [
    {
      dur: 0.26, start() { from = A.pos; f.to({ R: { a: 0.25, r: R * 0.8 }, L: { a: -0.6, r: R * 1.0 } }, 900); },
      fn(k) {
        const e = ease.inOut(k), p = { x: lerp(from.x, spot.x, e), y: lerp(from.y, spot.y, e) };
        A.place(p); a.low = e;
        A.dir = Math.atan2(B.y - p.y, B.x - p.x); A.dx = Math.cos(A.dir); A.dy = Math.sin(A.dir); f.faceLock = A.dir;
      }
    },
    {
      dur: 0.06, start() { if (A.miss) dodgeOf(A); f.to({ R: { a: 0.02, r: R + 20 } }, 9000); },
      end() {
        if (A.miss || A.glance) return fsResolve(A, "R", 0.8);
        A.done = "hit";
        const p = f.pos("R"), c = A.sc(p), e = b.token.document.elevation;
        A.stop(0.06); b.react.white = 0.5;
        burst(A, p, { r: 7, life: 0.12, color: 0xdff0ff });
        fx.ring(c.x, c.y, e, { r: 3, life: 0.3, w: 2, grow: 26, hit: true });
        A.later(0.12, () => fx.ring(c.x, c.y, e, { r: 3, life: 0.35, w: 1.5, grow: 40, hit: true }));
        b.react.numb = { t: 0, dur: A.crit ? 1.6 : 1.1 };
      }
    },
    { dur: 0.12, fn() { a.low = Math.max(0, a.low - 0.1); } },
    back(A, 0.3)
  ];
  A.seq(steps, () => done(A));
}

/** Открытая ладонь: сбор ци — шаг и удар ладонью; цель отлетает на клетку с лишним и скользит */
function fsPalm(A) {
  const a = A.a, b = A.b, f = a.rig;
  let from;
  const steps = [
    step(A, 0.14, at(A, fsStand() + 18)),
    {
      dur: 0.42, start() { f.to({ L: { a: -1.25, r: R * 0.78 }, R: { a: 1.15, r: R * 0.78 } }, 700); f.kiHold = true; },
      fn(k) { f.ki = ease.inOut(k); a.squash = 0.1 * k; a.ox.p = Math.sin(k * 80) * 0.8 * k; }
    },
    {
      dur: 0.1, start() { from = A.pos; if (A.miss) dodgeOf(A); f.to({ R: { a: 0.02, r: R + 22 }, L: { a: -1.0, r: R * 0.85 } }, 6000); a.squash = -0.08; },
      fn(k) { const w = at(A, fsStand()), e = ease.in(k); A.place({ x: lerp(from.x, w.x, e), y: lerp(from.y, w.y, e) }); a.leanDir = A.dir; a.lean.p = 0.14; a.spin = 0.2 * k; },
      end() {
        f.kiHold = false;
        const p = f.pos("R"), c = A.sc(p), e = b.token.document.elevation;
        fsResolve(A, "R", 1.5);
        if (A.done === "hit") {
          b.ox.v = b.oy.v = 0; b.react.retreat = { t: 0, dur: 0.45, dist: 115, dir: A.dir };
          fx.ring(c.x, c.y, e, { r: 10, life: 0.35, w: 6, grow: 110, hit: true });
          fx.ring(c.x, c.y, e, { r: 4, life: 0.45, w: 3, grow: 160, hit: true });
          for (let i = 1; i <= 4; i++) A.later(i * 0.08, () => { const q = A.sc(b.at); fx.dust(q.x, q.y + R * 0.5 * A.u, e, calm() ? 1 : 4, 0.6); });
          A.shake(7);
        } else fx.ring(c.x, c.y, e, { r: 6, life: 0.3, w: 3, grow: 50, hit: true });
      }
    },
    { dur: 0.14 },
    back(A, 0.3)
  ];
  A.seq(steps, () => done(A));
}

/** Приёмы без оружия по стилю */
export function fists(A, style) {
  ({ lunge: fsTwo, leap: fsLeap, sneak: fsPoint, heavy: fsPalm }[style] ?? fsTwo)(A);
}
