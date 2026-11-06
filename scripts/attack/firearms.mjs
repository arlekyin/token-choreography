/**
 * Арбалеты и огнестрел (xb* и gn* макета). Картинка — вид сбоку; тетиву, болт, ворот, шомпол, вспышку и дым
 * рисует код. В покое оружие у правого бока, в стрельбе — у плеча на линии цели.
 *
 * Арбалет: щелчок спуска, тетива бьёт вперёд и дрожит, отдача; болт летит почти без дуги. Перезарядка своя:
 * ручной — взвод одной рукой, лёгкий — нога в стремя, тяжёлый — ворот с трещоткой. Тяжёлый сбивает цель с места.
 * Огнестрел: курок — вспышка на полке — выстрел: пламя, свет на земле, дым висит; пулю не видно — только трассер
 * и что она сделала (рывок цели, пыль за целью, искры и рикошет). Перезарядка: порох, шомпол, полка, курок.
 * Приёмы: выстрел (выпад), прицельный/дуэльный (с замахом), из укрытия (исподтишка), навскидку/от бедра (наскок).
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, ease, lerp, rnd, sp, spring } from "../util.mjs";
import { GUARD, IDLE, PUSH, R } from "./weapon.mjs";
import { SPRITES } from "./kinds.mjs";
import { loose } from "./shafts.mjs";
import { shieldHit, useShield } from "./shield.mjs";

const calm = () => prefs.calm;

/** Общее у оружия «вид сбоку»: картинка с тенью, видимость, взгляд */
class SideRig {
  constructor(vis, K, texture, { face = 0 } = {}) {
    this.vis = vis; this.K = K;
    this.meta = SPRITES[K.src] ?? { w: texture.width, h: texture.height, haftX: 0.5 };
    this.up = sp(0); this.kick = sp(0);
    this.T = { up: 0 };
    this.k = 300;
    this.aimLine = 0;
    this.face = this.faceLock = face;
    this.time = 0;
    this.show = 0; this.leaving = false; this.done = false;
    this.shadow = new PIXI.Sprite(texture); this.shadow.tint = 0x0a0e1e;
    this.main = new PIXI.Sprite(texture);
    for (const s of [this.shadow, this.main]) { s.eventMode = "none"; s.anchor.set(this.meta.haftX, 1); }
    this.gfx = new PIXI.Graphics(); this.gfx.eventMode = "none";
  }

  release() { this.leaving = true; this.T.up = 0; }
  /** Защита: поднят перед собой; покой — у бока */
  to(pose) { this.T.up = pose?.tag === "idle" || pose === IDLE ? 0 : 0.6; }

  get hs() { const v = this.vis, z = v.z; return z * (1 + (v.hop + v.alt) / (260 * z)) - 0.252 * v.duck - 0.05 * v.low; }

  baseUpdate(dt) {
    this.time += dt;
    this.face += Math.atan2(Math.sin(this.faceLock - this.face), Math.cos(this.faceLock - this.face)) * clamp(dt * 8);
    spring(this.up, this.T.up, this.k, 2 * Math.sqrt(this.k) * 0.85, dt);
    this.show = this.leaving ? Math.max(0, this.show - dt / 0.25) : Math.min(1, this.show + dt / 0.1);
    if (this.leaving && this.show <= 0) this.done = true;
  }

  /** Поставить картинку по геометрии g и вернуть Graphics для дорисовки (или null, если не видно) */
  place(g, mir = 1) {
    const v = this.vis, t = v.token, u = v.u;
    const seen = t.visible && t.mesh?.visible && this.show > 0.01;
    const parent = this.held ? fx.ground(t.document.elevation) : fx.over(t.document.elevation);
    for (const d of [this.shadow, this.main, this.gfx]) {
      if (!seen) { d.parent?.removeChild(d); continue; }
      if (d.parent !== parent) parent.addChild(d);
    }
    if (!seen) return null;
    for (const [s, ox, oy, al] of [[this.shadow, 4, 6, 0.3], [this.main, 0, 0, 1]]) {
      s.position.set((g.bx + ox) * u, (g.by + oy) * u);
      s.rotation = g.ang + Math.PI / 2;
      s.scale.set(g.k * u * mir, g.k * u);
      s.alpha = al * this.show;
    }
    this.gfx.clear();
    this.gfx.alpha = this.show;
    return this.gfx;
  }

  /** Пунктир прицела от точки по направлению */
  aim(g, from, a) {
    if (this.aimLine <= 0.02) return;
    const u = this.vis.u;
    g.lineStyle({ width: 1.5 * u, color: 0xfff0c8, alpha: 0.35 * this.aimLine });
    for (let d = 0; d < 410; d += 11) {
      g.moveTo((from.x + Math.cos(a) * d) * u, (from.y + Math.sin(a) * d) * u);
      g.lineTo((from.x + Math.cos(a) * (d + 4)) * u, (from.y + Math.sin(a) * (d + 4)) * u);
    }
  }

  hands(g, pts) {
    const u = this.vis.u;
    g.lineStyle({ width: 1.2 * u, color: 0x2d2118 });
    for (const q of pts) { g.beginFill(0xc9a27c); g.drawCircle(q.x * u, q.y * u, R * 0.13 * u); g.endFill(); }
  }

  destroy() { for (const d of [this.shadow, this.main, this.gfx]) if (!d.destroyed) d.destroy(); }
}

/* ---------------- Арбалет ---------------- */

export class XbowRig extends SideRig {
  constructor(vis, K, texture, o) {
    super(vis, K, texture, o);
    this.cock = sp(1); this.T.cock = 1; this.kc = 300;
    this.loaded = 1; this.vib = 0; this.crank = 0;
  }

  geo() {
    const v = this.vis, at = v.view ?? v.at, f = this.face + v.spin, up = this.up.p, hs = this.hs, M = this.meta;
    const ang = lerp(f + 0.5, f, up), side = f + Math.PI / 2, k = this.K.len / M.h * hs;
    const bx = at.x + Math.cos(side) * lerp(R * 0.78, R * 0.22, up) * hs + Math.cos(f) * lerp(-R * 0.35, -R * 0.1, up) * hs - Math.cos(ang) * this.kick.p * 8;
    const by = at.y - v.hop + Math.sin(side) * lerp(R * 0.78, R * 0.22, up) * hs + Math.sin(f) * lerp(-R * 0.35, -R * 0.1, up) * hs - Math.sin(ang) * this.kick.p * 8;
    // Из координат картинки (доли ширины и высоты) — в мир: вверх картинки — по линии выстрела
    const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
    const P = (xf, yf) => { const lx = (xf - M.haftX) * M.w * k, ly = (1 - yf) * M.h * k; return { x: bx + ux * ly + vx * lx, y: by + uy * ly + vy * lx }; };
    return { k, bx, by, ang, P, hs, up };
  }

  nutY() { return lerp(this.meta.tipL.y + 0.02, this.K.nut, this.cock.p); }
  tip() { const g = this.geo(); return g.P(this.meta.haftX, this.nutY() - this.K.bolt); }

  update(dt) {
    this.baseUpdate(dt);
    spring(this.cock, this.T.cock, this.kc, 2 * Math.sqrt(this.kc) * 0.8, dt);
    spring(this.kick, 0, 300, 22, dt);
    this.vib = Math.max(0, this.vib - dt * 4);
  }

  render() {
    const G = this.geo(), g = this.place(G);
    if (!g) return;
    const u = this.vis.u, M = this.meta, U = p => [p.x * u, p.y * u];
    // Тетива: от концов плеч к ореху (взведён) или почти прямо (спущен), после выстрела дрожит
    const nutY = this.nutY() + this.vib * Math.sin(this.time * 80) * 0.025;
    const A = G.P(M.tipL.x + 0.01, M.tipL.y + 0.01), B = G.P(M.tipR.x - 0.01, M.tipR.y + 0.01), N = G.P(M.haftX, nutY);
    g.lineStyle({ width: 1.2 * u, color: 0xebe2cd, alpha: 0.85 });
    g.moveTo(...U(A)); g.lineTo(...U(N)); g.lineTo(...U(B));
    // Болт в желобе
    if (this.loaded) {
      const tp = G.P(M.haftX, nutY - this.K.bolt);
      g.lineStyle({ width: 3 * u, color: 0x8a6a44 }); g.moveTo(...U(N)); g.lineTo(...U(tp));
      g.lineStyle({ width: 0.8 * u, color: 0x3b3f44 }); g.beginFill(0xc9ced3);
      const c = Math.cos(G.ang), s = Math.sin(G.ang), P = (x, y) => [(tp.x + c * x - s * y) * u, (tp.y + s * x + c * y) * u];
      g.drawPolygon([...P(6, 0), ...P(-3, -3.5), ...P(-3, 3.5)]); g.endFill();
    }
    // Ворот тяжёлого: барабан на прикладе, шнур к тетиве, ручка крутится
    if (this.crank > 0) {
      const c = G.P(M.haftX + 0.16, 0.86), a = this.time * 14, r = 11 * G.hs, N0 = G.P(M.haftX, lerp(M.tipL.y + 0.02, this.K.nut, this.cock.p));
      g.lineStyle({ width: 1.2 * u, color: 0x3c2d1e, alpha: 0.8 }); g.moveTo(...U(c)); g.lineTo(...U(N0));
      g.lineStyle({ width: 1.2 * u, color: 0x1e2124 }); g.beginFill(0x5c6268); g.drawCircle(c.x * u, c.y * u, 4.5 * G.hs * u); g.endFill();
      g.lineStyle({ width: 2.8 * u, color: 0xb8bec4 }); g.moveTo(...U(c)); g.lineTo((c.x + Math.cos(a) * r) * u, (c.y + Math.sin(a) * r) * u);
      g.lineStyle(0); g.beginFill(0x7a5434); g.drawCircle((c.x + Math.cos(a) * r) * u, (c.y + Math.sin(a) * r) * u, 3.2 * u); g.endFill();
    }
    if (this.loaded) this.aim(g, this.tip(), G.ang);
    // Руки: правая у приклада, левая под ложем
    if (G.up > 0.4) this.hands(g, [G.P(M.haftX, 0.86), G.P(M.haftX, 0.62)]);
  }
}

/* ---------------- Огнестрел ---------------- */

export class GunRig extends SideRig {
  constructor(vis, K, texture, o) {
    super(vis, K, texture, o);
    this.flip = sp(0); this.rod = 0; this.rodIn = 0; this.mir = -1;
    this.pistol = K.gun === "pistol";
  }

  geo() {
    const v = this.vis, at = v.view ?? v.at, f = this.face + v.spin, up = this.up.p, hs = this.hs, M = this.meta, pis = this.pistol;
    const k = this.K.len / M.h * hs, side = f + Math.PI / 2;
    // Пистоль целится в цель, даже когда стрелок стоит боком (дуэльная стойка поворачивает тело, но не руку)
    const fa = f - (pis ? v.spin * up : 0);
    const ang = pis ? lerp(fa + 0.65, fa + 0.06, up) - this.flip.p * 0.35 : lerp(f + 0.45, f, up);
    const sd = pis ? lerp(R * 0.85, R * 0.3, up) : lerp(R * 0.8, R * 0.25, up), fw = pis ? lerp(-R * 0.05, R * 0.9, up) : lerp(-R * 0.5, -R * 0.2, up), kk = this.kick.p * (pis ? 6 : 10);
    const bx = at.x + Math.cos(side) * sd * hs + Math.cos(f) * fw * hs - Math.cos(ang) * kk;
    const by = at.y - v.hop + Math.sin(side) * sd * hs + Math.sin(f) * fw * hs - Math.sin(ang) * kk;
    const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
    // Замок (курок) — сверху по экрану: картинку зеркалим по тому, с какой её стороны замок и куда смотрит ствол
    this.mir = (Math.cos(ang) >= 0) === (M.lock === "left") ? 1 : -1;
    const mir = this.mir;
    const P = (xf, yf) => { const lx = (xf - M.haftX) * M.w * k * mir, ly = (1 - yf) * M.h * k; return { x: bx + ux * ly + vx * lx, y: by + uy * ly + vy * lx }; };
    return { k, bx, by, ang, P, hs, up, mir };
  }

  muzzle() { const g = this.geo(), m = this.meta.muzzle; return { ...g.P(m.x, m.y), a: g.ang }; }

  update(dt) {
    this.baseUpdate(dt);
    spring(this.kick, 0, 260, 20, dt);
    spring(this.flip, 0, 220, 16, dt);
  }

  render() {
    const G = this.geo(), g = this.place(G, G.mir);
    if (!g) return;
    const u = this.vis.u, M = this.meta;
    // Шомпол: торчит из дула на (1 − глубина)
    if (this.rod > 0) {
      const m = G.P(M.muzzle.x, M.muzzle.y), out = (1 - this.rodIn) * this.K.len * 0.45 * G.hs + 4;
      g.lineStyle({ width: 2 * u, color: 0xb9bec4 }); g.moveTo(m.x * u, m.y * u); g.lineTo((m.x + Math.cos(G.ang) * out) * u, (m.y + Math.sin(G.ang) * out) * u);
      g.lineStyle(0); g.beginFill(0xd9dde0); g.drawCircle((m.x + Math.cos(G.ang) * out) * u, (m.y + Math.sin(G.ang) * out) * u, 2.2 * u); g.endFill();
    }
    const m = this.muzzle();
    this.aim(g, m, m.a);
    if (this.pistol) { if (G.up > 0.3) this.hands(g, [G.P(M.haftX, 0.82)]); }
    else if (G.up > 0.4) this.hands(g, [G.P(M.haftX, 0.9), G.P(M.muzzle.x, 0.5)]);
  }
}

/* ---------------- Общие шаги ---------------- */

function finish(A) {
  const a = A.a, w = a.rig;
  if (w) { w.T.up = 0; w.aimLine = 0; if (w.crank !== undefined) { w.crank = 0; w.loaded = 1; w.T.cock = 1; } if (w.rod !== undefined) w.rod = 0; }
  a.low = 0; a.hide = 0; a.spin = 0;
  A.place(A.home); A.ax.v = A.ay.v = 0; a.squash = 0; a.lean.p = 0;
}
const wait = (A, flight) => ({ dur: 2, fn() { if (!flight.S?.flying && !A.b.react.dodge) this.cut = true; } });
const lower = (A, dur = 0.3) => ({ dur, start() { A.a.rig.k = 240; A.a.rig.T.up = 0; }, fn() { const a = A.a; a.low = Math.max(0, a.low - 0.06); a.lean.p = 0; a.squash = 0; } });
const walkTo = (A, to, k, f0, f1) => {
  const e = ease.inOut(lerp(f0, f1, k)), H = A.home;
  A.place({ x: lerp(H.x, to.x, e), y: lerp(H.y, to.y, e) });
  A.a.hop = 4 * Math.abs(Math.sin(lerp(f0, f1, k) * Math.PI * 2));
};
const backHome = (A, dur = 0.3) => {
  let f;
  return { dur, start() { f = A.pos; }, fn(k) { const e = ease.inOut(k); A.place({ x: lerp(f.x, A.home.x, e), y: lerp(f.y, A.home.y, e) }); } };
};

/* ---------------- Арбалет: шаги ---------------- */

const xbRaise = (A, dur = 0.2, up = 1) => ({ dur, start() { A.a.rig.k = 520; A.a.rig.T.up = up; } });
function xbFire(A, o, flight) {
  return {
    dur: 0.03,
    start() {
      const a = A.a, X = a.rig, kind = X.K.xbow;
      flight.S = loose(A, X.tip(), {
        bolt: true, speed: o.speed ?? (kind === "heavy" ? 1900 : kind === "hand" ? 1500 : 1700),
        power: o.power ?? (kind === "heavy" ? 2 : kind === "hand" ? 0.8 : 1.1), push: kind === "heavy" && !A.miss && !A.glance, deep: true
      });
      X.loaded = 0; X.kc = 3000; X.T.cock = 0; X.vib = 1; X.kick.v += kind === "heavy" ? 14 : 9; X.aimLine = 0;
      a.lean.v -= kind === "heavy" ? 2.2 : 1.2; a.hide = 0;
    }
  };
}
/** Перезарядка — у каждого арбалета своя */
function xbReload(A) {
  const a = A.a, X = a.rig, kind = X.K.xbow;
  if (kind === "hand") return [
    { dur: 0.34, start() { X.k = 400; X.T.up = 0.7; X.kc = 260; X.T.cock = 1; } },
    { dur: 0.14, end() { X.loaded = 1; } }];
  if (kind === "heavy") return [
    { dur: 0.14, start() { X.k = 300; X.T.up = 0.35; }, fn(k) { a.squash = 0.06 * ease.inOut(k); } },
    { dur: 1.0, start() { X.crank = 1; X.kc = 900; }, fn(k) { X.T.cock = Math.min(1, Math.floor(k * 7) / 6 + 0.05); }, end() { X.crank = 0; X.T.cock = 1; } },
    { dur: 0.16, fn(k) { a.squash = 0.06 * (1 - ease.inOut(k)); }, end() { X.loaded = 1; } }];
  return [
    { dur: 0.12, start() { X.k = 320; X.T.up = 0.3; a.squash = 0.12; } },
    { dur: 0.42, start() { X.kc = 140; X.T.cock = 1; a.lean.p = -0.08; } },
    { dur: 0.14, start() { a.squash = 0; a.lean.p = 0; }, end() { X.loaded = 1; } }];
}

function xbPlain(A) { const f = {}; A.seq([xbRaise(A), { dur: 0.14 }, xbFire(A, {}, f), wait(A, f), ...xbReload(A), lower(A)], () => finish(A)); }
function xbAimed(A) {
  const f = {}, a = A.a, heavy = a.rig.K.xbow === "heavy";
  A.seq([{ dur: 0.16, fn(k) { a.low = 0.6 * k; a.squash = 0.12 * k; } }, xbRaise(A, 0.2),
    { dur: 0.42, fn(k) { a.rig.aimLine = Math.min(1, k * 2); } },
    xbFire(A, { speed: 2100, power: heavy ? 2.4 : 1.4 }, f), wait(A, f), ...xbReload(A), lower(A)], () => finish(A));
}
function xbHidden(A) {
  const f = {}, a = A.a, heavy = a.rig.K.xbow === "heavy";
  A.seq([{ dur: 0.14, fn(k) { a.hide = k; a.low = k; } }, xbRaise(A, 0.18), { dur: 0.1 }, xbFire(A, { power: heavy ? 2.2 : 1.3 }, f), { dur: 0.1 },
    wait(A, f), ...xbReload(A), lower(A)], () => finish(A));
}
function xbSnap(A) {
  const f = {}, a = A.a, H = A.home, to = { x: H.x + A.dx * 40, y: H.y + A.dy * 40 };
  A.seq([{ dur: 0.16, start() { a.rig.k = 900; a.rig.T.up = 0.85; }, fn(k) { walkTo(A, to, k, 0, 0.7); } }, xbFire(A, {}, f),
    { dur: 0.1, fn(k) { walkTo(A, to, k, 0.7, 1); }, end() { a.hop = 0; } }, wait(A, f), ...xbReload(A), lower(A, 0.2), backHome(A)], () => finish(A));
}

/* ---------------- Огнестрел: шаги ---------------- */

/** Трассер: тонкий светлый след пули на миг */
function tracer(A, x0, y0, x1, y1, life = 0.09) {
  const u = A.u, g = new PIXI.Graphics();
  fx.add(g, life, k => { g.clear(); g.lineStyle({ width: 1.6 * u, color: 0xffecbe, alpha: 0.7 * (1 - k) }); g.moveTo(x0 * u, y0 * u); g.lineTo(x1 * u, y1 * u); }, { elevation: A.elev });
}
function ricochet(A, x, y, dir) { const d = dir + Math.PI + A.rng.sign() * rnd(1.2, 2); tracer(A, x, y, x + Math.cos(d) * 260, y + Math.sin(d) * 260, 0.08); }

/** Пламя из дула: язык огня и свет на земле */
function flame(A, m, ang, len, w, glow, life) {
  const u = A.u, g = new PIXI.Graphics();
  g.position.set(m.x * u, m.y * u); g.rotation = ang;
  fx.glow(m.x * u, m.y * u, A.elev, glow, life);
  fx.add(g, life, k => {
    const a = 1 - k, L = len * (k < 0.3 ? 0.6 + k : 1 - (k - 0.3) * 0.9) * u, W = w * a * u;
    g.clear();
    g.beginFill(0xffaa3c, a); g.moveTo(0, -W); g.quadraticCurveTo(L * 0.5, -W * 1.1, L, 0); g.quadraticCurveTo(L * 0.5, W * 1.1, 0, W); g.closePath(); g.endFill();
    g.beginFill(0xfff5c8, a); g.moveTo(0, -W * 0.5); g.quadraticCurveTo(L * 0.3, -W * 0.5, L * 0.6, 0); g.quadraticCurveTo(L * 0.3, W * 0.5, 0, W * 0.5); g.closePath(); g.endFill();
  }, { elevation: A.elev });
}
const smoke = (A, p, dir, n, spd, size, life) => fx.smoke(p.x * A.u, p.y * A.u, A.elev, dir, n, spd, size, life);

const gnRaise = (A, dur = 0.26, up = 1) => { const pis = A.a.rig.pistol; return { dur: pis ? dur * 0.7 : dur, start() { A.a.rig.k = pis ? 700 : 420; A.a.rig.T.up = up; } }; };

/** Цель видит ствол и дёргается раньше выстрела. Пулю парируют клинком (это аркада); без оружия — уход вбок */
function gnDodge(A) {
  const b = A.b, d = A.dodge === "parry" && !b.rig ? "side" : A.dodge;
  if (d === "side") b.react.dodge = { kind: "side", dir: A.dir + Math.PI / 2 * A.ds, t: 0 };
  if (d === "back") b.react.dodge = { kind: "back", dir: A.dir, t: 0 };
  if (d === "duck") b.react.dodge = { kind: "duck", dir: A.dir, t: 0 };
  if (d === "parry") { b.rig.faceLock = A.dir + Math.PI; b.rig.to(GUARD, 3000); }
}

/** Выстрел: курок — вспышка на полке — через миг пламя, дым, отдача; пуля долетает почти сразу */
function gnFire(A, o = {}) {
  const a = A.a;
  return {
    dur: 0.1,
    start() {
      const Q = a.rig, G = Q.geo(), pan = G.P(Q.meta.muzzle.x - 0.1, Q.K.pan);
      flame(A, pan, G.ang + Math.PI / 2, 8, 4, 22, 0.07); smoke(A, pan, G.ang + Math.PI / 2, 2, 20, 5, 1.1);
      if (A.miss) gnDodge(A);
    },
    end() {
      const Q = a.rig, m = Q.muzzle(), pis = Q.pistol, heavy = o.power ?? (pis ? 1.2 : 1.6), sc = pis ? 0.62 : 1;
      flame(A, m, m.a, 48 * sc, 15 * sc, 120 * sc, 0.11);
      // Чёрный порох: облако больше стрелка, уходит вперёд и висит; часть — назад, к стрелку
      smoke(A, m, m.a, Math.round(12 * sc), 210 * sc, 15 * sc, 2.8 * sc);
      smoke(A, m, m.a, Math.round(5 * sc), 60, 20 * sc, 3.2 * sc);
      smoke(A, m, m.a + Math.PI, pis ? 1 : 3, 40, 12 * sc, 2.2 * sc);
      if (pis) { Q.kick.v += 14; Q.flip.v += 9; a.lean.v -= 1.4; } else { Q.kick.v += 22; a.lean.v -= 3.2; a.ox.v -= Math.cos(m.a) * 160; a.oy.v -= Math.sin(m.a) * 160; }
      a.leanDir = m.a; a.hide = 0; Q.aimLine = 0;
      A.shake(pis ? 2.5 : 4);
      bullet(A, m, heavy * A.sizeK);
    }
  };
}

function bullet(A, m, p) {
  const b = A.b, B = b.home, e = b.token.document.elevation, u = A.u;
  const away = A.miss && !(A.dodge === "parry" && b.rig), off = away ? -A.ds * R * 1.1 * b.z : A.rng.range(-R * 0.25, R * 0.25);
  const tx = B.x + Math.cos(A.dir + Math.PI / 2) * off, ty = B.y + Math.sin(A.dir + Math.PI / 2) * off, dir = Math.atan2(ty - m.y, tx - m.x);
  const far = away || (A.crit && !A.glance), D = Math.hypot(tx - m.x, ty - m.y), end = far ? D + R * 3 : D - R * 0.8;
  const ex = m.x + Math.cos(dir) * end, ey = m.y + Math.sin(dir) * end;
  tracer(A, m.x + Math.cos(dir) * 20, m.y + Math.sin(dir) * 20, ex, ey);
  A.later(D / 3200, () => {
    const hx = m.x + Math.cos(dir) * (D - R * 0.8), hy = m.y + Math.sin(dir) * (D - R * 0.8);
    if (A.miss && A.dodge === "parry" && b.shield && useShield(A)) { shieldHit(A, dir, p); A.stop(0.09); A.shake(3); return; }
    if (A.miss && A.dodge === "parry" && b.rig) {
      // Пуля о клинок: звон, сноп искр, рикошет; клинок отбрасывает, защитника сдвигает
      const md = b.rig.mid?.() ?? b.at, c = A.sc(md);
      fx.sparks(c.x, c.y, e, dir + Math.PI, calm() ? 6 : 18); fx.clash(c.x, c.y, e); fx.ring(c.x, c.y, e, { r: 5, life: 0.22, w: 4, grow: 34, hit: true });
      ricochet(A, md.x, md.y, dir); b.rig.to(PUSH, 3400); A.later(0.3, () => b.rig?.to(IDLE, 260));
      b.react.retreat = { t: 0, dur: 0.26, dist: 10 * p, dir, sharp: true }; b.react.stagger = { t: 0, amp: 0.06 * p, dir, twist: 0 }; b.react.ringFlash = 0.8;
      A.stop(0.1); A.shake(3);
      return;
    }
    if (away) { fx.dust(ex * u, ey * u, e, calm() ? 2 : 7, 0.6); fx.crack(ex * u, ey * u, e, 0.6); return; }
    if (A.glance) {
      fx.sparks(hx * u, hy * u, e, dir + Math.PI, calm() ? 5 : 14); fx.clash(hx * u, hy * u, e); ricochet(A, hx, hy, dir);
      b.react.ringFlash = 1; b.react.white = 0.6; b.react.retreat = { t: 0, dur: 0.24, dist: 12 * p, dir, sharp: true }; b.react.stagger = { t: 0, amp: 0.06 * p, dir, twist: 0 };
      A.stop(0.07); A.shake(2.5);
      return;
    }
    // Попадание: рывок, кровь у входа и брызги с обратной стороны
    const pp = p * (A.crit ? 1.4 : 1);
    A.stop(Math.min(0.15, 0.06 + 0.03 * pp)); b.react.white = 1; b.react.red = 0.8;
    b.react.retreat = { t: 0, dur: 0.24, dist: 18 * pp, dir, sharp: true }; b.react.stagger = { t: 0, amp: 0.07 * pp, dir, twist: A.rng.range(-0.5, 0.5) * pp }; b.sx.v -= 6; b.sy.v += 5;
    fx.blood(hx * u, hy * u, e, dir + Math.PI, 3, A);
    fx.blood((B.x + Math.cos(dir) * R * 0.9 * b.z) * u, (B.y + Math.sin(dir) * R * 0.9 * b.z) * u, e, dir, Math.round(6 * pp), A);
    fx.ring(hx * u, hy * u, e, { r: 4, life: 0.2, w: 3, grow: 30 * pp, hit: true });
    smoke(A, { x: hx, y: hy }, dir + Math.PI, 2, 40, 5, 0.5);
    A.shake(2.5 * pp);
  });
}

/** Перезарядка: порох, пуля, шомпол, порох на полку, курок */
function gnReload(A) {
  const Q = A.a.rig, puff = (n, s, z, l) => ({ end() { const m = Q.muzzle(); smoke(A, m, m.a, n, s, z, l); } });
  if (Q.pistol) return [
    { dur: 0.16, start() { Q.k = 300; Q.T.up = 0.25; } },
    { dur: 0.2, ...puff(1, 10, 3, 0.6) },
    { dur: 0.42, start() { Q.rod = 1; Q.rodIn = 0; }, fn(k) { Q.rodIn = 0.5 + 0.5 * Math.abs(Math.sin(k * Math.PI * 2)); }, end() { Q.rod = 0; } },
    { dur: 0.18 }];
  return [
    { dur: 0.22, start() { Q.k = 260; Q.T.up = 0.1; } },
    { dur: 0.3, ...puff(2, 15, 4, 0.8) },
    { dur: 0.78, start() { Q.rod = 1; Q.rodIn = 0; }, fn(k) { Q.rodIn = 0.55 + 0.45 * Math.abs(Math.sin(k * Math.PI * 3)); }, end() { Q.rod = 0; } },
    { dur: 0.26 }];
}

function gnPlain(A) { A.seq([gnRaise(A), { dur: 0.22 }, gnFire(A), { dur: 0.45 }, ...gnReload(A), lower(A)], () => finish(A)); }
function gnAimed(A) {
  const a = A.a;
  A.seq([{ dur: 0.18, fn(k) { a.low = 0.6 * k; a.squash = 0.1 * k; } }, gnRaise(A), { dur: 0.5, fn(k) { a.rig.aimLine = Math.min(1, k * 2); } },
    gnFire(A, { power: 2.2 }), { dur: 0.45 }, ...gnReload(A), lower(A)], () => finish(A));
}
function gnHidden(A) {
  const a = A.a;
  A.seq([{ dur: 0.16, fn(k) { a.hide = k; a.low = k; } }, gnRaise(A, 0.24), { dur: 0.2 }, gnFire(A, { power: 1.9 }), { dur: 0.45 }, ...gnReload(A), lower(A)], () => finish(A));
}
/** От бедра: на шаге, не поднимая к плечу — отдача сбивает шаг */
function gnHip(A) {
  const a = A.a, H = A.home, to = { x: H.x + A.dx * 35, y: H.y + A.dy * 35 };
  A.seq([{ dur: 0.18, start() { a.rig.k = 700; a.rig.T.up = 0.65; }, fn(k) { walkTo(A, to, k, 0, 1); } },
    gnFire(A, { power: 1.5 }),
    { dur: 0.3, start() { a.hop = 0; a.react.stagger = { t: 0, amp: 0.1, dir: A.dir + Math.PI }; }, fn(k) { const e = ease.out(k); A.place({ x: lerp(to.x, to.x - A.dx * 16, e), y: lerp(to.y, to.y - A.dy * 16, e) }); } },
    { dur: 0.2 }, ...gnReload(A), lower(A, 0.2), backHome(A)], () => finish(A));
}
/** Дуэльный: боком к цели, рука вытянута, долгий прицел */
function psDuel(A) {
  const a = A.a;
  A.seq([{ dur: 0.2, fn(k) { a.spin = -0.55 * ease.inOut(k); } }, gnRaise(A, 0.26),
    { dur: 0.48, fn(k) { a.rig.aimLine = Math.min(1, k * 2); } },
    gnFire(A, { power: 1.7 }), { dur: 0.35 }, { dur: 0.2, fn(k) { a.spin = -0.55 * (1 - ease.inOut(k)); } }, ...gnReload(A), lower(A)], () => finish(A));
}
/** Навскидку: из-за пояса и сразу выстрел на шаге */
function psQuick(A) {
  const a = A.a, H = A.home, to = { x: H.x + A.dx * 30, y: H.y + A.dy * 30 };
  A.seq([{ dur: 0.14, start() { a.rig.k = 1400; a.rig.T.up = 0.9; }, fn(k) { const e = ease.inOut(k); A.place({ x: lerp(H.x, to.x, e), y: lerp(H.y, to.y, e) }); a.hop = 4 * Math.sin(k * Math.PI); } },
    gnFire(A, { power: 1.1 }), { dur: 0.1, start() { a.hop = 0; } }, { dur: 0.25 }, ...gnReload(A), lower(A, 0.2), backHome(A, 0.26)], () => finish(A));
}

/** Приёмы арбалета и огнестрела по стилю */
export function firearm(A, style) {
  const K = A.a.rig.K;
  A.ds = A.rng.sign();
  if (K.xbow) ({ lunge: xbPlain, heavy: xbAimed, sneak: xbHidden, leap: xbSnap }[style] ?? xbPlain)(A);
  else if (K.gun === "pistol") ({ lunge: gnPlain, heavy: psDuel, sneak: gnHidden, leap: psQuick }[style] ?? gnPlain)(A);
  else ({ lunge: gnPlain, heavy: gnAimed, sneak: gnHidden, leap: gnHip }[style] ?? gnPlain)(A);
}
