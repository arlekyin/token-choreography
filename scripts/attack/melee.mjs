/**
 * Ближняя атака оружием (melee макета): замах, подход по стилю, удар клинком; исход — попадание, крит,
 * по броне (клинок отскакивает, искры), промах — цель уходит вбок, отскакивает, приседает или парирует.
 *
 * Стиль подхода: выпад (обычный), наскок (подошёл в этот ход), с замахом, исподтишка. Сейчас от броска dnd5e
 * берутся выпад и наскок. Дистанция удара — по длине оружия: кончик заходит в цель, а не токен в токен.
 * Все величины — пиксели макета; цель и атакующий — TokenVisual.
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, ease, lerp, spring, wrapAngle } from "../util.mjs";
import { ARM, ARMPOSE, ARMPOSE2, ARMTHRUST, GA_CLEAVE, GA_OVER, GUARD, IDLE, PUSH, R } from "./weapon.mjs";
import { shieldHit, useShield } from "./shield.mjs";

const calm = () => prefs.calm;

/** Расстояние от центра бьющего до центра цели, при котором кончик заходит в цель (weaponReach макета) */
export function weaponReach(K, ps) {
  const L = K.len * K.grip, armL = K.two ? ARM * 1.15 : ARM;
  if (ps.pull) return armL + ps.wind.ext + L * 0.9 - R * 0.25;
  if (ps.kind === "thrust" || ps.kind === "chop") return (armL + ps.strike.ext) * Math.cos(ps.strike.ha) + L * (ps.kind === "chop" ? 0.85 : 1) + R * 0.65;
  return armL + ps.strike.ext + L * 0.8 + R * 0.35;
}

/**
 * @param {import("./attack.mjs").Attack} A
 * @param {object} o  style: lunge|leap|heavy|sneak, dodge: side|back|duck|parry
 */
export function melee(A, { style = "lunge", dodge = "side" } = {}) {
  const a = A.a, b = A.b, w = a.rig, rng = A.rng, K = w.K;
  const { miss, crit, glance } = A;
  const start = A.pos, home = A.home, Bh = b.home;
  // Исподтишка заходит сбоку: шаг вбок (почти клетка), оттуда — тычок
  const side = rng.sign();
  const base = A.dir;
  const perp = base + side * Math.PI / 2, sideStep = { x: home.x + Math.cos(perp) * 95, y: home.y + Math.sin(perp) * 95 };
  const dir = style === "sneak" ? Math.atan2(Bh.y - sideStep.y, Bh.x - sideStep.x) : base;
  const isGA = K.moves === "greataxe";
  const twoH = w.two;
  // Колющее оружие колет всегда; секира — рубит; меч: выпад и с замахом рубят, наскок и исподтишка колют
  const PS = K.thrust ? ARMTHRUST
    : isGA ? (style === "heavy" ? GA_OVER : GA_CLEAVE)
    : (style === "leap" || style === "sneak") ? ARMTHRUST
    : twoH ? ARMPOSE2 : ARMPOSE;
  const standoff = Math.max(R * 1.9, weaponReach(K, PS)) + A.gap;
  const contact = { x: Bh.x - Math.cos(dir) * standoff, y: Bh.y - Math.sin(dir) * standoff };
  const T = {
    lunge: { wind: crit ? 0.24 : 0.16, go: 0.09, back: crit ? 22 : 12 },
    leap: { wind: 0.18, go: 0.34, back: 6 },
    sneak: { wind: 0.08, go: 0.4, back: 0 },
    heavy: { wind: 0.5, go: 0.08, back: 26 }
  }[style];
  // Разброс: темп и глубина замаха — два одинаковых удара подряд не копии; двумя руками — тяжелее
  T.wind *= rng.range(0.88, 1.14) * (twoH ? 1.25 : 1); T.back *= rng.range(0.85, 1.2);
  if (isGA) { T.wind *= 1.15; T.go *= 1.15; if (PS === GA_OVER) T.wind = Math.max(T.wind, 0.9); }
  if (twoH) { T.go *= 1.3; T.back *= 1.3; }
  // Цель ближе, чем бьёт оружие: в замахе — отскок назад прыжком, чтобы было откуда ударить
  const dist0 = Math.hypot(Bh.x - home.x, Bh.y - home.y);
  const jumpBack = style !== "sneak" && dist0 < standoff + 24 ? standoff + 30 - dist0 : 0;
  if (jumpBack) { T.back = Math.max(T.back, jumpBack); T.wind = Math.max(T.wind, 0.26); T.go = Math.max(T.go, 0.12); }
  const done = {};
  const once = (key, f) => { if (!done[key]) { done[key] = 1; f(); } };
  const dx = Math.cos(dir), dy = Math.sin(dir);
  if (miss && dodge === "duck" && (PS.kind === "thrust" || PS.kind === "chop")) dodge = "side";
  if (dodge === "parry" && !b.rig) dodge = "side";
  const jit = P => ({ ...P, ha: P.ha + rng.range(-0.18, 0.18), ext: P.ext + rng.range(-3, 3) });
  w.sweep = PS.sweep || w.sweep;
  const WP = { wind: jit(PS.wind), strike: jit(PS.strike), base: PS }, heavyW = K.heavy || twoH;
  w.faceLock = w.face = dir;
  const S = { parriedAt: null, knockPose: null, buriedAt: null };
  A.state = S;

  A.task = dt => {
    const time = A.time;
    // Пригнуться и парировать защитник начинает заранее, видя удар
    if (miss && dodge === "duck" && time >= T.wind - 0.06 && !done.duckIn) { done.duckIn = 1; b.react.dodge = { kind: "duck", dir, t: 0 }; }
    if (miss && dodge === "parry" && time >= T.wind - 0.04 && !done.guard) { done.guard = 1; b.rig.faceLock = dir + Math.PI; b.rig.to(GUARD, 1800); }
    if (S.parriedAt != null) {
      // Клинок отбит: отлетает назад-вбок, потом возвращается к покою
      if (time - S.parriedAt < 0.3) w.to(S.knockPose, 900); else w.to(IDLE, 220);
    } else {
      // Рубящий — с началом рывка; тычок — к концу подхода; пригнулся — взмах, когда атакующий уже рядом
      const K0 = PS.kind;
      const strikeAt = miss && dodge === "duck" ? T.wind + T.go * 0.7
        : K0 === "slash" ? T.wind : isGA && K0 === "chop" ? T.wind + T.go * 0.3 : T.wind + T.go * (style === "leap" ? 0.74 : 0.72);
      if (S.buriedAt != null && time - S.buriedAt < 0.42) w.to({ ...WP.strike, ext: WP.strike.ext + 6 }, 4000);
      else if (S.buriedAt != null) {
        once("wrench", () => { a.lean.v -= 2.5; a.sy.v += 3; const tp = A.sc(w.tip()); fx.dust(tp.x, tp.y, A.elev, calm() ? 2 : 6, 0.6); });
        w.to(IDLE, 260);
      }
      else if (done.contact && PS.follow && !miss && time < T.wind + T.go + 0.3) w.to(PS.follow, 1100);
      else if (time < strikeAt && PS.whirl) w.to({ ...WP.wind, ha: lerp(0.75, WP.wind.ha + 6.283, ease.inOut(clamp(time / T.wind))) }, 1400);
      else if (time < strikeAt) w.to(WP.wind, heavyW ? 260 : 420);
      // Парируют: рубящий удар доходит только до клинка защитника
      else if (time < T.wind + T.go + 0.3) {
        w.to(miss && dodge === "parry" && K0 === "slash" ? { ha: 0.35, ba: -0.35, ext: 6 } : WP.strike,
          isGA ? 1700 : twoH ? 1500 : heavyW ? 2200 : 3600);
      }
      else w.to(IDLE, 220);
    }
    // Замах
    if (time < T.wind) {
      const k = ease.out(time / T.wind);
      A.place({ x: start.x - Math.cos(base) * T.back * k, y: start.y - Math.sin(base) * T.back * k });
      if (jumpBack) {
        a.hop = 18 * Math.sin(clamp(time / T.wind) * Math.PI);
        if (time > T.wind * 0.9) once("land", () => { const p = A.sc(A.pos); fx.dust(p.x, p.y + R * 0.6 * A.u, A.elev, calm() ? 1 : 4, 0.5); });
      }
      a.squash = (style === "leap" ? 0.16 : style === "heavy" ? 0.18 : 0.1) * k * (twoH ? 1.5 : 1);
      if (twoH) {
        a.lean.p = -0.09 * k;
        if (time > T.wind * 0.85) once("plant", () => { const p = A.sc(A.pos); fx.dust(p.x, p.y + R * 0.6 * A.u, A.elev, calm() ? 2 : 6, 0.7); });
      }
      if (style === "heavy") { a.ox.p = Math.sin(time * 70) * 2 * k; a.react.white = 0.25 * k * Math.abs(Math.sin(time * 20)); }
      if (style === "sneak") a.low = k;
      a.leanDir = base; if (!twoH) a.lean.p = -0.05 * k;
      return true;
    }
    const tg = time - T.wind;
    // Подход: у каждого стиля свой путь
    if (tg < T.go) {
      const k = tg / T.go, from = { x: start.x - Math.cos(base) * T.back, y: start.y - Math.sin(base) * T.back };
      // Уход вбок — проскакивает дальше; пригнулся — клинок проходит прямо над ним; но не ближе, чем токен к токену
      const over = Math.min(Math.max(0, standoff - R * 2.15), miss && dodge === "side" ? R * 1.2 : miss && dodge === "duck" ? R * 0.75 : 0);
      const tx = contact.x + dx * over, ty = contact.y + dy * over;
      if (style === "sneak") {
        if (k < 0.62) {
          const kk = ease.inOut(k / 0.62);
          A.place({ x: lerp(from.x, sideStep.x, kk), y: lerp(from.y, sideStep.y, kk) });
          a.leanDir = perp; a.lean.p = 0.07;
          w.faceLock = Math.atan2(Bh.y - A.ay.p, Bh.x - A.ax.p);
        } else {
          const kk = ease.in((k - 0.62) / 0.38);
          A.place({ x: lerp(sideStep.x, contact.x, kk), y: lerp(sideStep.y, contact.y, kk) });
          a.leanDir = dir; a.lean.p = 0.1; w.faceLock = dir;
        }
        a.squash = 0;
      } else {
        const kk = style === "leap" ? ease.inOut(k) : ease.in(k);
        A.place({ x: lerp(from.x, tx, kk), y: lerp(from.y, ty, kk) });
        a.squash = style === "leap" ? -0.06 : -0.14 * kk; a.leanDir = dir; a.lean.p = 0.1;
        if (style === "leap") a.hop = 70 * Math.sin(k * Math.PI) * (miss && dodge === "duck" ? 1.3 : 1);
      }
      return true;
    }
    once("contact", () => {
      done.contact = 1;
      a.squash = 0; a.hop = 0; a.low = 0;
      const power = (crit ? 1.6 : 1) * (style === "heavy" ? 1.5 : style === "leap" ? 1.25 : style === "sneak" ? 0.8 : 1) * (twoH ? 1.5 : 1);
      const p = A.sc(A.pos);
      // Инерция двуручного: после удара клинок тянет героя вперёд, он пошатывается
      if (twoH) { a.ox.v += dx * 260; a.oy.v += dy * 260; a.lean.p = 0.12; a.react.stagger = { t: 0, amp: 0.05, dir, twist: 0 }; fx.dust(p.x, p.y + R * 0.6 * A.u, A.elev, calm() ? 2 : 6, 0.7); }
      if (style === "leap") {
        fx.dust(p.x, p.y + R * 0.4 * A.u, A.elev, calm() ? 2 : 10, 0.8); a.sx.v -= 6; a.sy.v += 5;
        fx.ring(p.x, p.y, A.elev, { r: R * 0.8, life: 0.35, w: 5, hit: true });
      }
      // Промах тяжёлым рубящим — секира врубается в землю у ног цели
      if (miss && dodge !== "parry" && PS.bury) {
        S.buriedAt = A.time;
        const tp = A.sc(w.tip());
        fx.crack(tp.x, tp.y, A.elev); fx.dust(tp.x, tp.y, A.elev, calm() ? 3 : 10, 0.8);
        fx.ring(tp.x, tp.y, A.elev, { r: 6, life: 0.3, w: 4, grow: 40 }); A.shake(6);
      }
      if (miss) return evade(A, dir, dodge, style, twoH);
      if (glance) return glanceHit(A, dir, PS, power);
      landHit(A, dir, power, crit, style, PS, twoH);
    });
    // Возврат: с двуручным — медленнее и позже (оружие тяжело)
    const after = time - T.wind - T.go;
    if (after > (S.buriedAt != null ? 0.55 : done.recoil ? 0.25 : twoH ? 0.3 : 0.08)) {
      spring(A.ax, home.x, twoH ? 90 : 200, twoH ? 17 : 22, dt);
      spring(A.ay, home.y, twoH ? 90 : 200, twoH ? 17 : 22, dt);
      a.lean.p = 0;
    }
    if (after > (S.buriedAt != null ? 1.35 : twoH ? 1.05 : 0.7)) {
      A.place(home); A.ax.v = A.ay.v = 0; a.low = 0;
      w.release();
      return false;
    }
    return true;
  };
}

/** Где клинок встречает цель и куда толкает (bladeContact макета) */
function bladeContact(A, dir, PS) {
  const w = A.a.rig, Bh = A.b.home;
  const g = w.grip(), tp = w.tip(), vx = tp.x - g.x, vy = tp.y - g.y, L2 = vx * vx + vy * vy || 1;
  const t = clamp(((Bh.x - g.x) * vx + (Bh.y - g.y) * vy) / L2);
  let qx = g.x + vx * t, qy = g.y + vy * t;
  const d = Math.hypot(qx - Bh.x, qy - Bh.y) || 1, rb = R * 0.95 * A.b.z;
  if (d > rb) { qx = Bh.x + (qx - Bh.x) / d * rb; qy = Bh.y + (qy - Bh.y) / d * rb; }
  if (PS.pull) return { x: qx, y: qy, hd: dir + Math.PI, side: 0 };
  if (PS.kind === "thrust" || PS.kind === "chop") return { x: qx, y: qy, hd: dir + clamp(wrapAngle(g.a - dir), -0.5, 0.5), side: 0 };
  // Дуга справа налево — кончик движется на 90° против часовой от клинка; слева направо — по часовой
  const sweep = PS.sweep || -1, tang = g.a + sweep * Math.PI / 2;
  const hx = Math.cos(dir) * 0.45 + Math.cos(tang) * 0.85, hy = Math.sin(dir) * 0.45 + Math.sin(tang) * 0.85;
  // Толчок всегда от атакующего: ход клинка лишь отклоняет его вбок
  const hd = dir + clamp(wrapAngle(Math.atan2(hy, hx) - dir), -0.96, 0.96);
  return { x: qx, y: qy, hd, side: sweep };
}

/** Попадание: вспышка, толчок и разворот по ходу клинка, кровь, кольцо и метка удара */
export function landHit(A, dir, power, crit, style, PS, twoH) {
  const a = A.a, b = A.b;
  power *= A.sizeK;
  const C = bladeContact(A, dir, PS);
  dir = C.hd;
  const dx = Math.cos(dir), dy = Math.sin(dir), e = b.token.document.elevation;
  A.stop(Math.min(0.22, 0.05 + 0.06 * power));
  b.react.white = 1; b.react.red = Math.min(1, 0.5 + 0.25 * power);
  b.ox.v += dx * 480 * power; b.oy.v += dy * 480 * power;
  b.sx.v -= 6 * power; b.sy.v += 4 * power;
  b.react.stagger = { t: 0, amp: 0.06 * power, dir, twist: -C.side * 0.35 * power };
  a.sx.v -= 4; a.sy.v += 3;
  const bl = A.sc({ x: C.x + dx * R * 0.3, y: C.y + dy * R * 0.3 });
  fx.blood(bl.x, bl.y, e, dir, Math.round(7 * power * power), A);
  A.shake(3 * power * power);
  const c = A.sc(C);
  fx.ring(c.x, c.y, e, { r: 8, life: 0.22 + 0.06 * power, w: 3 + 2 * power, grow: 50 + 40 * power, hit: true });
  fx.mark(c.x, c.y, e, dir, crit || power > 1.4);
  if (style === "heavy" || twoH) { const p = A.sc(b.home); fx.crack(p.x, p.y, e); }
  // Двуручный вдавливает цель: она оседает на миг
  if (twoH) { b.react.sink = { t: 0 }; A.stop(0.04); }
}

/** По броне: клинок не прорубил — звон и искры, клинок отскакивает, цель качнуло и она отступает на шаг */
export function glanceHit(A, dir, PS, power = 1) {
  const a = A.a, b = A.b, p = power * A.sizeK, e = b.token.document.elevation;
  const C = bladeContact(A, dir, PS), c = A.sc(C);
  A.stop(Math.min(0.2, 0.06 + 0.04 * p));
  fx.clash(c.x, c.y, e); fx.sparks(c.x, c.y, e, C.hd + Math.PI, Math.round((calm() ? 5 : 14) * p));
  b.ox.v += Math.cos(C.hd) * 600 * p; b.oy.v += Math.sin(C.hd) * 600 * p;
  b.sx.v -= 5 * p; b.sy.v += 4 * p; b.react.ringFlash = 1; b.react.white = 0.45;
  b.react.stagger = { t: 0, amp: 0.07 * p, dir: C.hd, twist: -C.side * 0.25 * p };
  b.react.retreat = { t: 0, dur: 0.5, dist: Math.min(60, 20 * p * p), dir: C.hd };
  const w = a.rig, S = A.state;
  if (w && S) { S.parriedAt = A.time; w.ha.v = w.ba.v = 0; S.knockPose = { ha: w.ha.p + 0.5, ba: w.ba.p + 0.5, ext: -2 }; w.ha.v += 8; w.ba.v += 14; }
  A.shake(3 * p * p);
}

/**
 * Ответ после удачного ухода: защитник с оружием разворачивается и колет в открывшегося атакующего,
 * тот сразу отпрыгивает — тычок приходит в пустоту
 */
export function readyCounter(A, delay) {
  const a = A.a, b = A.b;
  // Щит без оружия в ответ не колет
  if (!b.rig || b.rig.isShield) return;
  const ang = () => { const p = a.at, q = b.home; return Math.atan2(p.y - q.y, p.x - q.x); };
  A.later(delay, () => { b.rig.faceLock = ang(); b.rig.to(ARMTHRUST.wind, 900); a.react.evade = { t: 0, dir: ang() }; });
  A.later(delay + 0.1, () => {
    const p = a.at, q = b.home, d = Math.hypot(p.x - q.x, p.y - q.y), st = Math.min(46, d - R * 2.4);
    if (st > 8) { b.rig.faceLock = ang(); b.react.retreat = { t: 0, dur: 0.2, dist: st, dir: ang(), sharp: true }; }
  });
  A.later(delay + 0.16, () => { b.leanDir = b.rig.faceLock; b.lean.p = 0.08; b.rig.to({ ha: -0.25, ba: 0.15, ext: -4 }, 2600); });
  // Клинок убирается быстро — атакующий возвращается только после этого
  A.later(delay + 0.36, () => { b.rig.to(IDLE, 650); b.lean.p = 0; });
  A.later(delay + 0.8, () => {});
}

/** Промах: цель уходит одним из способов (evade макета) */
export function evade(A, dir, dodge, style, twoH) {
  const a = A.a, b = A.b, dx = Math.cos(dir), dy = Math.sin(dir), S = A.state ?? {};
  if (dodge === "side") { b.react.dodge = { kind: "side", dir: dir + Math.PI / 2 * A.rng.sign(), t: 0 }; A.ax.v = dx * 400; A.ay.v = dy * 400; }
  if (dodge === "back") b.react.dodge = { kind: "back", dir, t: 0 };
  if (dodge !== "parry") readyCounter(A, S.buriedAt != null ? 0.62 : dodge === "duck" ? 0.3 : 0.2);
  if (dodge === "duck") {
    // Клинок прошёл над головой: атакующий проваливается вперёд — открылся; защитник выпрямляется
    A.ax.v = dx * 520; A.ay.v = dy * 520;
    a.react.stagger = { t: 0, amp: 0.12, dir }; a.react.overrun = { t: 0, dir };
    if (a.rig?.ha) a.rig.ha.v -= 10;
  }
  if (A.fumble) { a.react.stagger = { t: 0, amp: 0.16, dir, twist: 0.3 * A.rng.sign() }; a.react.overrun = { t: 0, dir }; }
  if (dodge === "parry") {
    // Клинки встречаются на середине клинка защитника; искры там же
    // Со щитом — два варианта: закрыться щитом или отбить клинком, прикрываясь щитом
    const e = b.token.document.elevation;
    const pw = (style === "heavy" ? 1.6 : style === "leap" ? 1.35 : style === "sneak" ? 0.8 : 1) * (twoH ? 1.4 : 1), hard = pw > 1.1;
    A.stop(hard ? 0.12 : 0.07); b.react.ringFlash = 0.6;
    if (useShield(A)) shieldHit(A, dir, pw);
    else { const meet = A.sc(b.rig.mid()); fx.clash(meet.x, meet.y, e); fx.sparks(meet.x, meet.y, e, dir + Math.PI, Math.round((calm() ? 4 : 12) * pw)); }
    // Удар остановлен на клинке защитника: клинок отбит, атакующий отскакивает и спотыкается
    S.parriedAt = A.time;
    const w = a.rig;
    if (w?.ha) { w.ha.v = w.ba.v = w.ext.v = 0; S.knockPose = { ha: w.ha.p + 0.9, ba: w.ba.p + 0.8, ext: -6 }; w.ha.v += 14; w.ba.v += 26; }
    A.ax.v = 0; A.ay.v = 0;
    a.ox.v -= dx * 560 / pw; a.oy.v -= dy * 560 / pw; a.react.recoil = { t: 0 };
    a.react.stagger = { t: 0, amp: 0.1, dir: dir + Math.PI }; a.sx.v += 4; a.sy.v -= 3;
    if (hard) {
      // Блок продавлен: защитника сдвигает, отбив слабый и поздний
      b.ox.v += dx * 380 * pw; b.oy.v += dy * 380 * pw; b.sx.v -= 4 * pw; b.sy.v += 3 * pw;
      b.react.stagger = { t: 0, amp: 0.07 * pw, dir };
      b.react.retreat = { t: 0, dur: 0.7, dist: 22 * pw, dir };
      A.later(0.28, () => b.rig?.to({ ...PUSH, ext: 4 }, 900));
      A.later(0.7, () => b.rig?.to(IDLE, 160));
      A.shake(6 * pw);
    } else {
      A.later(0.07, () => { b.rig?.to(PUSH, 3200); b.ox.v += dx * 90; b.oy.v += dy * 90; });
      A.later(0.33, () => b.rig?.to(IDLE, 240));
      A.shake(3);
    }
  }
}
