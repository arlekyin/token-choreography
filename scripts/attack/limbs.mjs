/**
 * Природные атаки с конечностью и особые (natAttack2 макета):
 *  лоза и щупальце — хлёст с захватом: обвивает цель и подтягивает к себе;
 *  жало — хвост из-за спины, укол сверху, яд (цель зеленеет и шипит);
 *  касание — призрак тускнеет и проплывает к цели; цель стынет, жизнь струйками уходит к нему;
 *  плевок — комок кислоты по дуге; попал — кислота шипит на цели, мимо — лужица на земле.
 * Промах: цель уходит, кончик конечности проходит мимо с другой стороны.
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, ease, lerp, rnd } from "../util.mjs";
import { GUARD, IDLE, PUSH, R } from "./weapon.mjs";
import { readyCounter } from "./melee.mjs";
import { shieldHit, useShield } from "./shield.mjs";

const calm = () => prefs.calm;
const STYLE = {
  vine: [0x26351a, 0x55742c, 9, 3],
  tentacle: [0x4a2a3e, 0xa5708f, 11, 2.5],
  tail: [0x2e1d12, 0x6b4a2e, 9, 3.5]
};

/** Гибкая конечность: кривая от основания к кончику, сужается */
class LimbRig {
  constructor(vis, b, kind, side) {
    this.vis = vis; this.b = b; this.kind = kind; this.side = side;
    this.len = 0; this.swing = 1.4; this.wrap = 0; this.deep = null; this.missSide = 0;
    this.done = false; this.leaving = false;
    this.gfx = new PIXI.Graphics(); this.gfx.eventMode = "none";
  }
  update() { if (this.leaving) this.done = true; }
  release() { this.leaving = true; }

  geo() {
    const a = this.vis, b = this.b, A0 = a.at, B0 = b.at, B1 = b.home;
    const dir = Math.atan2(B0.y - A0.y, B0.x - A0.x), dx = Math.cos(dir), dy = Math.sin(dir), px = -dy, py = dx, sd = this.side;
    const rb = R * b.z, ra = R * a.z;
    // Промах: кончик уходит мимо края цели — в сторону, противоположную её уходу
    const ms = this.missSide * rb * 1.3, base = this.missSide ? B1 : B0;
    const E = { x: base.x - dx * rb * (this.deep ?? 0.55) + px * ms, y: base.y - dy * rb * (this.deep ?? 0.55) + py * ms };
    let S, rest;
    if (this.kind === "tail") {
      // Хвост — из-за спины, дугой сбоку над телом
      S = { x: A0.x - dx * ra * 0.75, y: A0.y - dy * ra * 0.75 };
      rest = { x: A0.x + px * sd * ra * 1.15 - dx * ra * 0.1, y: A0.y + py * sd * ra * 1.15 - dy * ra * 0.1 };
    } else {
      S = { x: A0.x + dx * ra * 0.75 + px * sd * ra * 0.35, y: A0.y + dy * ra * 0.75 + py * sd * ra * 0.35 };
      rest = { x: S.x + dx * R * 0.6 + px * sd * R * 0.5, y: S.y + dy * R * 0.6 + py * sd * R * 0.5 };
    }
    const T = { x: lerp(rest.x, E.x, this.len), y: lerp(rest.y, E.y, this.len) }, mx = (S.x + T.x) / 2, my = (S.y + T.y) / 2;
    const ctrl = this.kind === "tail"
      ? { x: mx + px * sd * R * (1.5 - this.len * 0.7) - dx * R * 0.3, y: my + py * sd * R * (1.5 - this.len * 0.7) - dy * R * 0.3 }
      : { x: mx + px * sd * R * this.swing, y: my + py * sd * R * this.swing };
    return { S, T, ctrl, dir };
  }

  render() {
    const a = this.vis, t = a.token, u = a.u, g = this.gfx;
    const seen = t.visible && t.mesh?.visible && !this.leaving;
    const parent = fx.over(t.document.elevation);
    if (!seen) { g.parent?.removeChild(g); return; }
    if (g.parent !== parent) parent.addChild(g);
    g.clear();
    const G = this.geo(), n = 16, pts = [], st = STYLE[this.kind];
    for (let i = 0; i <= n; i++) {
      const s = i / n, v = 1 - s;
      pts.push({ x: v * v * G.S.x + 2 * v * s * G.ctrl.x + s * s * G.T.x, y: v * v * G.S.y + 2 * v * s * G.ctrl.y + s * s * G.T.y });
    }
    for (const [col, extra, al, o] of [[0x0a0e1e, 0, 0.3, 5], [st[0], 2, 1, 0], [st[1], 0, 1, 0]]) {
      for (let i = 1; i <= n; i++) {
        g.lineStyle({ width: (lerp(st[2], st[3], i / n) + extra) * u, color: col, alpha: al, cap: "round" });
        g.moveTo((pts[i - 1].x + o * 0.8) * u, (pts[i - 1].y + o) * u); g.lineTo((pts[i].x + o * 0.8) * u, (pts[i].y + o) * u);
      }
    }
    // Шипы, присоски, кольца хвоста
    for (let i = 2; i < n; i += 2) {
      const q = pts[i], r = pts[i + 1], ang = Math.atan2(r.y - q.y, r.x - q.x), w = lerp(st[2], st[3], i / n) / 2;
      if (this.kind === "vine") {
        g.lineStyle(0); g.beginFill(0xd6c79a);
        for (const sg of [-1, 1]) g.drawPolygon([
          (q.x + Math.cos(ang + sg * 1.57) * w) * u, (q.y + Math.sin(ang + sg * 1.57) * w) * u,
          (q.x + Math.cos(ang + sg * 1.9) * (w + 5)) * u, (q.y + Math.sin(ang + sg * 1.9) * (w + 5)) * u,
          (q.x + Math.cos(ang + sg * 1.57) * w + Math.cos(ang) * 3) * u, (q.y + Math.sin(ang + sg * 1.57) * w + Math.sin(ang) * 3) * u]);
        g.endFill();
      } else if (this.kind === "tentacle") {
        g.lineStyle(0); g.beginFill(0xe8c3d3); g.drawCircle((q.x + Math.cos(ang + 1.57) * w * 0.5) * u, (q.y + Math.sin(ang + 1.57) * w * 0.5) * u, 1.8 * u); g.endFill();
      } else {
        g.lineStyle({ width: 1.2 * u, color: 0x2e1d12 });
        g.moveTo((q.x + Math.cos(ang + 1.57) * w) * u, (q.y + Math.sin(ang + 1.57) * w) * u); g.lineTo((q.x - Math.cos(ang + 1.57) * w) * u, (q.y - Math.sin(ang + 1.57) * w) * u);
      }
    }
    // Жало на конце хвоста
    if (this.kind === "tail") {
      const q = pts[n], r = pts[n - 2], ang = Math.atan2(q.y - r.y, q.x - r.x), c = Math.cos(ang), s = Math.sin(ang);
      const P = (x, y) => [(q.x + c * x - s * y) * u, (q.y + s * x + c * y) * u];
      g.lineStyle({ width: 1.2 * u, color: 0x2e1d12 }); g.beginFill(0xe2d8bd);
      g.moveTo(...P(12, 0)); g.quadraticCurveTo(...P(2, -6), ...P(-4, -4)); g.lineTo(...P(-4, 4)); g.quadraticCurveTo(...P(2, 6), ...P(12, 0));
      g.endFill();
    }
    // Захват: обвивает цель
    if (this.wrap > 0.02) {
      const B = this.b.at, sweep = 6.283 * this.wrap, a0 = G.dir + Math.PI, rb = R * this.b.z;
      for (const [col, w] of [[st[0], st[2] * 0.7 + 2], [st[1], st[2] * 0.7]]) {
        g.lineStyle({ width: w * u, color: col });
        for (let i = 0; i <= 40; i++) {
          const an = a0 + sweep * i / 40, x = B.x + Math.cos(an) * rb, y = B.y + Math.sin(an) * rb * 0.92;
          if (i) g.lineTo(x * u, y * u); else g.moveTo(x * u, y * u);
        }
      }
      if (this.kind === "vine") {
        g.lineStyle(0); g.beginFill(0xd6c79a);
        for (let i = 0; i < 9 * this.wrap; i++) { const an = a0 + i * 0.7; g.drawCircle((B.x + Math.cos(an) * rb) * u, (B.y + Math.sin(an) * rb * 0.92) * u, 2.2 * u); }
        g.endFill();
      }
    }
  }

  destroy() { if (!this.gfx.destroyed) this.gfx.destroy(); }
}

/** Уход цели и сторона, куда пройдёт мимо кончик конечности: всегда разные */
function missSide(A) {
  const b = A.b, ds = A.rng.sign();
  if (A.dodge === "back") b.react.dodge = { kind: "back", dir: A.dir, t: 0 };
  else if (A.dodge === "duck") b.react.dodge = { kind: "duck", dir: A.dir, t: 0 };
  else b.react.dodge = { kind: "side", dir: A.dir + Math.PI / 2 * ds, t: 0 };
  return -ds;
}

/** Уход цели (касание, плевок): как у остальных природных */
function dodgeOf(A) {
  const b = A.b, d = A.dodge;
  if (d === "duck") b.react.dodge = { kind: "duck", dir: A.dir, t: 0 };
  else if (d === "parry" && b.rig) { b.rig.faceLock = A.dir + Math.PI; b.rig.to(GUARD, 2200); }
  else if (d === "back") b.react.dodge = { kind: "back", dir: A.dir, t: 0 };
  else b.react.dodge = { kind: "side", dir: A.dir + Math.PI / 2 * A.rng.sign(), t: 0 };
}

/** Исход (natResolve макета): блок, промах, по броне, попадание; onHit(сила) */
function resolve(A, at, p, onHit) {
  const a = A.a, b = A.b, e = b.token.document.elevation, c = A.sc(at);
  p *= A.sizeK;
  if (A.miss && A.dodge === "parry" && b.rig) {
    if (useShield(A)) shieldHit(A, A.dir, p);
    else { fx.clash(c.x, c.y, e); fx.sparks(c.x, c.y, e, A.dir + Math.PI, Math.round((calm() ? 4 : 10) * p)); }
    A.later(0.04, () => b.rig?.to(PUSH, 3000)); A.later(0.35, () => b.rig?.to(IDLE, 300));
    b.react.ringFlash = 0.5; A.stop(0.07);
    a.ox.v -= A.dx * 260; a.oy.v -= A.dy * 260;
    return "miss";
  }
  if (A.miss) { readyCounter(A, 0.3); return "miss"; }
  if (A.glance) {
    fx.sparks(c.x, c.y, e, A.dir + Math.PI, calm() ? 3 : 8);
    b.react.ringFlash = 1; b.react.white = 0.4; b.ox.v += A.dx * 150 * p; b.oy.v += A.dy * 150 * p;
    A.stop(0.05); a.ox.v -= A.dx * 200; a.oy.v -= A.dy * 200;
    return "glance";
  }
  const pp = p * (A.crit ? 1.5 : 1);
  A.stop(Math.min(0.14, 0.05 + 0.03 * pp));
  b.react.white = 0.9; b.react.red = 0.5 + 0.2 * pp; b.sx.v -= 4 * pp; b.sy.v += 4 * pp;
  b.react.stagger = { t: 0, amp: 0.06 * pp, dir: A.dir, twist: A.rng.range(-0.3, 0.3) * pp };
  A.shake(2 * pp);
  onHit?.(pp, c, e);
  return "hit";
}

const edge = A => { const B = A.B; return { x: B.x - A.dx * R * A.b.z * 0.6, y: B.y - A.dy * R * A.b.z * 0.6 }; };

function recover(A, dur) {
  let from;
  return { dur, start() { from = A.pos; }, fn(k) { const e = ease.out(k); A.place({ x: lerp(from.x, A.home.x, e), y: lerp(from.y, A.home.y, e) }); A.a.lean.p = -0.05 * (1 - k); A.a.squash = 0; } };
}

function done(A) {
  const a = A.a;
  a.rig?.release();
  a.hide = 0; a.rot = 0; a.squash = 0; a.lean.p = 0;
  A.place(A.home); A.ax.v = A.ay.v = 0;
}

/** Лоза и щупальце: хлёст с захватом */
function lash(A, kind) {
  const a = A.a, b = A.b, L = a.rig = new LimbRig(a, b, kind, A.rng.sign());
  let out = null;
  A.seq([
    { dur: 0.26, fn(k) { L.len = 0.15 * ease.out(k); L.swing = 1.4 + Math.sin(k * 9) * 0.2; a.lean.p = -0.05 * k; a.leanDir = A.dir; } },
    {
      dur: 0.14, start() { if (A.miss) { L.deep = -0.6; L.missSide = missSide(A); } },
      fn(k) { const e = ease.in(k); L.len = lerp(0.15, 1, e); L.swing = lerp(1.4, -0.35, e); a.lean.p = 0.1; },
      end() {
        const at = edge(A);
        out = resolve(A, at, 0.9, (pp, c, e) => fx.blood(c.x, c.y, e, A.dir, Math.round(3 * pp), A));
        if (out === "miss") { const G = L.geo(), p = A.sc(G.T); fx.dust(p.x, p.y, A.elev, calm() ? 2 : 6, 0.6); }
      }
    },
    // Захват: обвивает и подтягивает к себе
    {
      dur: 0.55, start() { if (out === "hit") b.react.retreat = { t: 0, dur: 0.45, dist: R * 0.7, dir: A.dir + Math.PI }; },
      fn(k) { if (out !== "hit") { this.cut = true; return; } L.wrap = ease.out(clamp(k / 0.5)); L.deep = 0.55 - 0.4 * k; a.lean.p = -0.1; if (k > 0.5) b.sx.v += Math.sin(k * 40) * 0.3; }
    },
    { dur: 0.3, fn(k) { L.wrap = Math.max(0, L.wrap - 0.12); L.len = lerp(L.len, 0, k); L.swing = lerp(L.swing, 1.4, k); a.lean.p = 0; } }
  ], () => done(A));
}

/** Жало: подходит, хвост поднимается — укол сверху, яд */
function sting(A) {
  const a = A.a, b = A.b, L = a.rig = new LimbRig(a, b, "tail", A.rng.sign()), B = b.home;
  const near = { x: B.x - A.dx * (R * 2.35 + A.gap), y: B.y - A.dy * (R * 2.35 + A.gap) };
  let from, out = null;
  A.seq([
    { dur: 0.33, start() { from = A.pos; }, fn(k) { const e = ease.inOut(k); A.place({ x: lerp(from.x, near.x, e), y: lerp(from.y, near.y, e) }); L.len = 0; a.squash = 0.1 * k; a.leanDir = A.dir; a.lean.p = -0.06 * k; } },
    {
      dur: 0.12, start() { if (A.miss) { L.deep = -0.4; L.missSide = missSide(A); } }, fn(k) { L.len = ease.in(k); a.squash = -0.08; a.lean.p = 0.1; },
      end() {
        const at = edge(A);
        out = resolve(A, at, 0.9, (pp, c, e) => { b.react.tint = { t: 0, dur: 1.4, color: 0x7bd648, a: 0.45, fizz: true }; fx.blood(c.x, c.y, e, A.dir, 2, A); });
        if (out === "miss") { const p = A.sc(L.geo().T); fx.dust(p.x, p.y, A.elev, calm() ? 2 : 6, 0.5); fx.crack(p.x, p.y, A.elev, 0.6); }
      }
    },
    { dur: 0.2 },
    { dur: 0.3, fn(k) { L.len = 1 - ease.inOut(k); a.squash = 0; a.lean.p = 0; } },
    recover(A, 0.3)
  ], () => done(A));
}

/** Касание призрака: полупрозрачен, проплывает к цели без шагов; цель стынет, жизнь струйками уходит к нему */
function touch(A) {
  const a = A.a, b = A.b, B = b.home, near = { x: B.x - A.dx * (R * 1.75 + A.gap), y: B.y - A.dy * (R * 1.75 + A.gap) };
  let from;
  A.seq([
    { dur: 0.25, fn(k) { a.hide = 0.7 * k; } },
    {
      dur: 0.38, start() { from = A.pos; if (A.miss) dodgeOf(A); },
      fn(k) { const e = ease.inOut(k); A.place({ x: lerp(from.x, near.x, e), y: lerp(from.y, near.y, e) + Math.sin(k * Math.PI * 2) * 4 }); },
      end() {
        const out = resolve(A, edge(A), 0.7, () => { b.react.tint = { t: 0, dur: 1.2, color: 0x1c2a55, a: 0.55 }; wisps(A); A.stop(0.08); });
        if (out === "glance") b.react.tint = { t: 0, dur: 0.5, color: 0x1c2a55, a: 0.3 };
      }
    },
    { dur: 0.5, fn() { a.hide = 0.7; } },
    { dur: 0.45, start() { from = A.pos; }, fn(k) { const e = ease.inOut(k); A.place({ x: lerp(from.x, A.home.x, e), y: lerp(from.y, A.home.y, e) }); a.hide = 0.7 * (1 - k); }, end() { a.hide = 0; } }
  ], () => done(A));
}

/** Струйки жизни: от цели к призраку */
function wisps(A) {
  const u = A.u, g = new PIXI.Graphics(), a = A.a, b = A.b, life = 0.8;
  fx.add(g, life, (k, dt, e) => {
    g.clear();
    const s = b.at, d = a.at;
    for (let i = 0; i < 9; i++) {
      const q = (e.age * 1.6 + i / 9) % 1, al = Math.sin(q * Math.PI) * (1 - k), wob = Math.sin(q * 9 + i) * 10;
      const x = lerp(s.x, d.x, q) - (d.y - s.y) / 200 * wob, y = lerp(s.y, d.y, q) + (d.x - s.x) / 200 * wob;
      g.beginFill(0xbed7ff, 0.7 * al); g.drawCircle(x * u, y * u, (3 + 2 * al) * u); g.endFill();
    }
  }, { elevation: b.token.document.elevation });
}

/** Плевок: вскинулся, комок по дуге; попал — кислота шипит на цели; мимо — лужица на земле */
function spit(A) {
  const a = A.a, b = A.b, u = A.u, e = b.token.document.elevation;
  A.seq([
    { dur: 0.24, fn(k) { a.squash = 0.14 * k; a.leanDir = A.dir; a.lean.p = -0.1 * k; } },
    {
      dur: 0.06,
      start() {
        a.squash = -0.12; a.lean.v += 2;
        const H = A.home, B = b.home, from = { x: H.x + A.dx * R * 0.9 * a.z, y: H.y + A.dy * R * 0.9 * a.z };
        const off = A.miss ? A.rng.sign() * R * 1.2 * b.z : 0;
        const to = { x: B.x - A.dy * off + (A.miss ? A.dx * R * 1.4 : 0), y: B.y + A.dx * off + (A.miss ? A.dy * R * 1.4 : 0) };
        if (A.miss) dodgeOf(A);
        fx.projectile(A.sc(from), A.sc(to), e, {
          speed: 520, glob: true,
          onArrive: () => {
            splat(A, to);
            if (A.miss) { for (let i = 0; i < 4; i++) A.later(i * 0.15, () => fx.dust(to.x * u, to.y * u, e, 1, 0.3)); return; }
            resolve(A, to, 0.7, () => { b.react.tint = { t: 0, dur: 1.6, color: 0xc2d83a, a: 0.45, fizz: true }; });
          }
        });
        // Атака ждёт, пока комок долетит
        A.later(Math.hypot(to.x - from.x, to.y - from.y) / 520 + 0.05, () => {});
      }
    },
    { dur: 0.7, fn() { a.squash = 0; a.lean.p = 0; } }
  ], () => done(A));
}

/** Лужица кислоты: брызги, гаснут за 2 с */
function splat(A, at) {
  const u = A.u, g = new PIXI.Graphics(), seed = rnd(0, 6), c = A.sc(at);
  g.position.set(c.x, c.y);
  fx.add(g, 2.2, k => {
    const al = 1 - clamp((k - 0.6) / 0.4);
    g.clear(); g.beginFill(0xaac832, 0.75 * al);
    for (let i = 0; i < 7; i++) { const an = seed + i * 0.9, d = (i ? 10 + (i * 7) % 14 : 0) * Math.min(1, k * 8); g.drawCircle(Math.cos(an) * d * u, Math.sin(an) * d * u, (i ? 4 : 9) * u); }
    g.endFill();
  }, { over: false, elevation: A.b.token.document.elevation });
}

/** Природные атаки с конечностью и особые; false — не этот вид */
export function limbAttack(A, kind) {
  if (kind === "vine" || kind === "tentacle") lash(A, kind);
  else if (kind === "sting") sting(A);
  else if (kind === "touch") touch(A);
  else if (kind === "spit") spit(A);
  else return false;
  return true;
}
