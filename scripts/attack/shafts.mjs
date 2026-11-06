/**
 * Снаряды: стрела, болт, метательное оружие (loose/shafts макета). Летят лёгкой дугой (высота — смещением от тени).
 * Попала — застревает в цели и торчит (следует за целью); мимо — пролетает дальше и втыкается в землю за целью;
 * по броне — отскакивает и падает; сбита клинком — кувыркается в сторону; крит — насквозь, втыкается за целью.
 * Всё в пикселях макета; рисование — PIXI.Graphics в слое эффектов.
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, lerp, rnd } from "../util.mjs";
import { GUARD, IDLE, PUSH, R } from "./weapon.mjs";
import { SPRITES, WKINDS, spritePath } from "./kinds.mjs";
import { shieldHit, stickInShield, useShield } from "./shield.mjs";

const calm = () => prefs.calm;

/** Стрела (или болт) в локальных осях: наконечник в (0,0), древко назад на len */
function arrowShape(g, len, u, { bolt = false, shadow = false } = {}) {
  if (shadow) {
    g.lineStyle({ width: (bolt ? 3 : 2.2) * u, color: 0x0a0e1e, alpha: 0.3 });
    g.moveTo(-len * u, 0); g.lineTo(4 * u, 0);
    return g;
  }
  g.lineStyle({ width: (bolt ? 3 : 2.2) * u, color: bolt ? 0x8a6a44 : 0xd2bc90 });
  g.moveTo(-len * u, 0); g.lineTo(0, 0);
  g.lineStyle({ width: 0.8 * u, color: 0x3b3f44 }); g.beginFill(0xc9ced3);
  g.drawPolygon([6 * u, 0, -3 * u, -3.5 * u, -3 * u, 3.5 * u]); g.endFill();
  g.lineStyle(0); g.beginFill(bolt ? 0x5a3c22 : 0xb5372c);
  g.drawPolygon([(-len + 9) * u, 0, -len * u, -4 * u, (-len + 2) * u, 0, -len * u, 4 * u]); g.endFill();
  return g;
}

/** Картинка метательного: остриё (верх картинки) — в точке, рукоять назад; embed — доля внутри */
function thrownSprite(kind, texture, u, { embed = 0.3, shadow = false } = {}) {
  const K = WKINDS[kind] ?? WKINDS.dagger, M = SPRITES[K.src] ?? { h: texture.height, haftX: 0.5 };
  const s = new PIXI.Sprite(texture), k = K.len / M.h * u;
  s.anchor.set(M.haftX, embed);
  s.scale.set(k, k);
  if (shadow) { s.tint = 0x0a0e1e; s.alpha = 0.3; }
  return s;
}

/** Нарисовать снаряд: стрелу или картинку метательного (в контейнере, ось X — по полёту) */
function makeShaft(o, u) {
  const c = new PIXI.Container();
  if (o.sprite) {
    const sh = thrownSprite(o.sprite, o.texture, u, { embed: 0.5, shadow: true }), main = thrownSprite(o.sprite, o.texture, u, { embed: 0.5 });
    c.addChild(sh, main);
    c.main = main; c.shade = sh; c.turn = Math.PI / 2;
  } else {
    const len = R * (o.bolt ? 0.85 : 1.45);
    const sh = arrowShape(new PIXI.Graphics(), len, u, { bolt: o.bolt, shadow: true }), main = arrowShape(new PIXI.Graphics(), len, u, { bolt: o.bolt });
    c.addChild(sh, main);
    c.main = main; c.shade = sh; c.turn = 0;
  }
  c.base = c.main.scale.x;
  c.shade.position.set(3 * u, 5 * u);
  return c;
}

/**
 * Выпустить снаряд от from (px макета) в цель атаки A.
 * o: speed, power, bolt, push (тяжёлый — сбивает с места), deep (короче торчит), sprite + texture (метательное), arc
 * Возвращает объект полёта: {flying} — пока летит
 */
export function loose(A, from, o = {}) {
  const b = A.b, B = b.home, u = A.u;
  const dodge = A.miss ? A.dodge : null, through = A.crit && !A.miss && !A.glance;
  // Промах с уходом: цель шагает в одну сторону, стрела проходит с другой — мимо края, а не сквозь токен
  const ds = A.rng.sign(), away = dodge === "side" || dodge === "back" || (dodge === "parry" && !b.rig);
  const c0 = Math.atan2(B.y - from.y, B.x - from.x), off = away ? -ds * R * 1.15 * b.z : 0;
  const dir = Math.atan2(B.y + Math.sin(c0 + Math.PI / 2) * off - from.y, B.x + Math.cos(c0 + Math.PI / 2) * off - from.x);
  const side = A.rng.range(-0.3, 0.3), spd = o.speed ?? 1100;
  const dist = Math.hypot(B.x - from.x, B.y - from.y), dur = dist / spd;
  const H = dist * (dodge === "duck" ? 0.16 : o.bolt ? 0.02 : 0.07) * (o.arc ?? 1);
  const power = (o.power ?? 1) * A.sizeK;
  const S = { x0: from.x, y0: from.y, x: from.x, y: from.y, h: 0, t: 0, dur, H, dir, side, through, state: "fly", o: { ...o, power }, flying: true };
  // Цель уходит, пока снаряд в воздухе
  if (away) A.later(dur * 0.35, () => { b.react.dodge = dodge === "back" ? { kind: "back", dir: c0, t: 0 } : { kind: "side", dir: c0 + Math.PI / 2 * ds, t: 0 }; });
  if (dodge === "duck") A.later(Math.max(0, dur - 0.12), () => { b.react.dodge = { kind: "duck", dir, t: 0 }; });
  if (dodge === "parry" && b.rig) A.later(Math.max(0, dur - 0.14), () => { b.rig.faceLock = dir + Math.PI; b.rig.to(GUARD, 2200); });

  const gfx = makeShaft(S.o, u), e = b.token.document.elevation;
  const spin = S.o.sprite && WKINDS[S.o.sprite]?.thrown === "spin";
  fx.add(gfx, 30, (k, dt, entry) => {
    S.t += dt;
    if (S.state === "fly") {
      const kk = clamp(S.t / S.dur), miss = A.miss && !(A.dodge === "parry" && b.rig);
      // Конец пути: в цель — точка входа у края (следит за целью); мимо или насквозь — дальше, в землю за целью
      const Bt = b.at, ex = Bt.x - Math.cos(S.dir - S.side) * R * 0.85 * b.z, ey = Bt.y - Math.sin(S.dir - S.side) * R * 0.85 * b.z;
      if (!(miss || S.through)) {
        S.x = lerp(S.x0, ex, kk); S.y = lerp(S.y0, ey, kk); S.h = S.H * Math.sin(kk * Math.PI * 0.5) * (1 - kk) * 2;
        if (kk >= 1) { arrive(A, S); }
      } else {
        const D = S.dur * spd, k2 = clamp(S.t * spd / (D + R * 2.6)), d = k2 * (D + R * 2.6);
        S.x = S.x0 + Math.cos(S.dir) * d; S.y = S.y0 + Math.sin(S.dir) * d; S.h = S.H * Math.sin(k2 * Math.PI);
        if (S.through && !S.passed && S.t >= S.dur) { S.passed = true; hit(A, S, true); }
        if (k2 >= 1) { S.state = "done"; S.flying = false; ground(A, S, { x: S.x, y: S.y, ang: S.dir, vib: 1, lying: spin && Math.random() < 0.5 }); fx.dust(S.x * u, S.y * u, e, calm() ? 1 : 3, 0.35); }
      }
    } else if (S.state === "bounce") {
      S.x += Math.cos(S.bd) * S.v * dt; S.y += Math.sin(S.bd) * S.v * dt; S.v *= Math.pow(0.04, dt); S.spin += dt * 22;
      S.h = Math.max(0, S.h + S.hv * dt); S.hv -= 900 * dt;
      if (S.h <= 0 && S.t > 0.1) { S.state = "done"; ground(A, S, { x: S.x, y: S.y, ang: S.spin, vib: 0, lying: true }); }
    }
    if (S.state === "done") { entry.age = entry.life; return; }
    // В полёте: тень на земле, снаряд выше на высоту дуги и крупнее
    const a = S.state === "bounce" ? S.spin : S.dir + (spin && S.state === "fly" ? S.t * 26 : 0), sc = 1 + S.h / 260;
    gfx.position.set(S.x * u, S.y * u);
    gfx.main.position.set(0, -S.h * u);
    gfx.main.rotation = gfx.shade.rotation = a + gfx.turn;
    gfx.main.scale.set(gfx.base * sc, gfx.base * sc);
  }, { elevation: e });
  return S;
}

/** Снаряд долетел до цели: блок, броня или попадание */
function arrive(A, S) {
  const b = A.b, p = S.o.power ?? 1, heavy = p > 1.3, e = b.token.document.elevation, u = A.u;
  S.state = "done"; S.flying = false;
  // Сила выстрела давит и на блок: защитника сдвигает резким толчком
  const shove = (dist, amp) => {
    b.react.retreat = { t: 0, dur: 0.26, dist, dir: S.dir, sharp: true }; b.react.stagger = { t: 0, amp, dir: S.dir, twist: 0 };
    const c = A.sc(b.home); fx.dust(c.x, c.y + R * 0.5 * u, e, calm() ? 1 : 5, 0.6); A.shake(2.5 * p);
  };
  // Щит: стрела застревает в нём, защитника толкает
  if (A.miss && A.dodge === "parry" && b.shield && useShield(A)) {
    stickInShield(A, S.dir, S.o.bolt);
    shieldHit(A, S.dir, p); A.stop(0.06);
    if (heavy) shove(12 * p * p, 0.08 * p);
    return;
  }
  if ((A.miss && A.dodge === "parry" && b.rig) || A.glance) {
    // Сбита клинком или отскочила от брони: искры, кувыркается в сторону и падает
    fx.sparks(S.x * u, S.y * u, e, S.dir + Math.PI, Math.round((calm() ? 4 : 9) * p)); fx.clash(S.x * u, S.y * u, e);
    if (heavy) { A.stop(0.1); fx.ring(S.x * u, S.y * u, e, { r: 5, life: 0.22, w: 4, grow: 26 * p, hit: true }); }
    if (A.glance) {
      b.react.ringFlash = 1; b.react.white = heavy ? 0.6 : 0.35; b.ox.v += Math.cos(S.dir) * 90; b.oy.v += Math.sin(S.dir) * 90;
      if (heavy) shove(10 * p * p, 0.07 * p);
    } else {
      b.rig?.to(PUSH, 3000); A.later(0.25, () => b.rig?.to(IDLE, 300));
      if (heavy) shove(12 * p * p, 0.08 * p);
    }
    Object.assign(S, { state: "bounce", t: 0, bd: S.dir + Math.PI + (Math.random() < 0.5 ? 1 : -1) * rnd(0.9, 1.6), v: 420, spin: S.dir, h: 10, hv: 160, flying: false });
    return;
  }
  hit(A, S, false);
}

/** Снаряд вошёл в цель: вздрагивает, кровь у входа; остаётся торчать (насквозь — кровь и с другой стороны) */
function hit(A, S, through) {
  const b = A.b, dir = S.dir, p = (S.o.power ?? 1) * (A.crit ? 1.5 : 1), ea = dir + Math.PI - S.side, e = b.token.document.elevation;
  const Bt = b.at, ex = A.sc({ x: Bt.x + Math.cos(ea) * R * 0.85 * b.z, y: Bt.y + Math.sin(ea) * R * 0.85 * b.z });
  A.stop(Math.min(0.12, 0.04 + 0.03 * p));
  b.react.white = 0.75; b.react.red = 0.5 + 0.2 * p;
  b.ox.v += Math.cos(dir) * 200 * p; b.oy.v += Math.sin(dir) * 200 * p; b.sx.v -= 3 * p; b.sy.v += 3 * p;
  b.react.stagger = { t: 0, amp: 0.05 * p, dir, twist: S.side * 0.6 * p };
  fx.blood(ex.x, ex.y, e, dir + Math.PI, 3, A); fx.ring(ex.x, ex.y, e, { r: 4, life: 0.18, w: 2.5, grow: 28, hit: true });
  if (through) { const q = A.sc({ x: Bt.x + Math.cos(dir) * R * b.z, y: Bt.y + Math.sin(dir) * R * b.z }); fx.blood(q.x, q.y, e, dir, Math.round(7 * p), A); }
  else stick(A, { ang: ea, tilt: rnd(-0.3, 0.3), len: R * (S.o.bolt ? 0.42 : S.o.deep ? 0.55 : 0.8), bolt: S.o.bolt, sprite: S.o.sprite, texture: S.o.texture });
  A.shake(1.5 * p);
  // Тяжёлый выстрел: цель сбивает с места — резкий отлёт, двойное кольцо, пыль из-под ног
  if (S.o.push || p >= 1.6) {
    A.stop(Math.min(0.16, 0.06 + 0.035 * p)); b.react.white = 1; b.sx.v -= 7; b.sy.v += 6;
    b.react.retreat = { t: 0, dur: 0.26, dist: Math.min(90, 30 * p), dir, sharp: true }; b.react.stagger = { t: 0, amp: 0.08 * p, dir, twist: S.side * 0.9 * p };
    const c = A.sc(b.home);
    fx.ring(ex.x, ex.y, e, { r: 6, life: 0.26, w: 5, grow: 30 * p, hit: true }); fx.ring(c.x, c.y, e, { r: R * b.z, life: 0.3, w: 3, grow: 22 * p, hit: true });
    fx.dust(c.x, c.y + R * 0.5 * A.u, e, calm() ? 2 : 8, 0.8);
    A.shake(3 * p);
  }
}

/** Торчит из цели: от точки входа наружу, по линии прилёта; следует за целью, гаснет через 6 с */
function stick(A, q) {
  const b = A.b, u = A.u, e = b.token.document.elevation;
  let gfx;
  if (q.sprite) {
    gfx = new PIXI.Container();
    gfx.addChild(thrownSprite(q.sprite, q.texture, u, { embed: 0.3 }));
    gfx.children[0].rotation = Math.PI / 2;
  } else {
    // Древко наружу от точки входа (по +X), оперение на конце
    gfx = new PIXI.Graphics();
    gfx.lineStyle({ width: (q.bolt ? 3 : 2) * u, color: 0x0a0e1e, alpha: 0.28 }); gfx.moveTo(3 * u, 5 * u); gfx.lineTo((q.len + 3) * u, 5 * u);
    gfx.lineStyle({ width: (q.bolt ? 3 : 2.2) * u, color: q.bolt ? 0x8a6a44 : 0xd2bc90 }); gfx.moveTo(0, 0); gfx.lineTo(q.len * u, 0);
    gfx.lineStyle(0); gfx.beginFill(q.bolt ? 0x5a3c22 : 0xb5372c);
    gfx.drawPolygon([(q.len - 9) * u, 0, q.len * u, -4 * u, (q.len - 2) * u, 0, q.len * u, 4 * u]); gfx.endFill();
  }
  fx.add(gfx, 6, (k, dt, entry) => {
    if (b.token.destroyed) { entry.age = entry.life; return; }
    const Bt = b.at, a = q.ang + b.rot, r = R * b.z * (q.sprite ? 0.8 : 0.85);
    gfx.position.set((Bt.x + Math.cos(a) * r) * u, (Bt.y - b.hop + Math.sin(a) * r) * u);
    gfx.rotation = q.sprite ? a + Math.PI + q.tilt : a + q.tilt;
    gfx.alpha = 1 - clamp((k * 6 - 5.4) / 0.6);
  }, { elevation: e });
}

/** В земле (воткнута наклонно, дрожит) или на земле (лежит); гаснет через 5 с */
function ground(A, S, g) {
  const u = A.u, e = A.b.token.document.elevation, o = S.o;
  let gfx;
  if (o.sprite) {
    gfx = new PIXI.Container();
    const s = thrownSprite(o.sprite, o.texture, u, { embed: g.lying ? 0.5 : 0.1 });
    s.rotation = Math.PI / 2;
    if (!g.lying) s.scale.y *= 0.55;
    gfx.addChild(s);
  } else if (g.lying) {
    const len = R * (o.bolt ? 0.9 : 1.5);
    gfx = arrowShape(new PIXI.Graphics(), len, u, { bolt: o.bolt });
    gfx.pivot.set(-R * 0.2 * u, 0);
  } else {
    gfx = new PIXI.Graphics();
    const L = R * 0.55;
    gfx.lineStyle({ width: (o.bolt ? 3 : 2) * u, color: 0x0a0e1e, alpha: 0.28 }); gfx.moveTo(0, 0); gfx.lineTo(L * u, 6 * u);
    gfx.lineStyle({ width: (o.bolt ? 3 : 2.2) * u, color: o.bolt ? 0x8a6a44 : 0xd2bc90 }); gfx.moveTo(0, 0); gfx.lineTo(L * u, 0);
    gfx.lineStyle(0); gfx.beginFill(o.bolt ? 0x5a3c22 : 0xb5372c);
    gfx.drawPolygon([(L - 9) * u, 0, L * u, -4 * u, (L - 2) * u, 0, L * u, 4 * u]); gfx.endFill();
    gfx.beginFill(0x3c2d1e, 0.5); gfx.drawEllipse(0, 0, 3 * u, 2 * u); gfx.endFill();
  }
  gfx.position.set(g.x * u, g.y * u);
  let vib = g.vib;
  fx.add(gfx, 5, (k, dt, entry) => {
    vib = Math.max(0, vib - dt * 4);
    const wob = vib * Math.sin(entry.age * 60) * (o.sprite ? 0.2 : 0.25);
    gfx.rotation = g.lying ? g.ang : (o.sprite ? g.ang : g.ang + Math.PI) + wob;
    gfx.alpha = 1 - clamp((entry.age - 4.3) / 0.7);
  }, { over: false, elevation: e });
}

/** Картинка метательного оружия */
export const thrownTexture = kind => foundry.canvas.loadTexture(spritePath((WKINDS[kind] ?? WKINDS.dagger).src));
