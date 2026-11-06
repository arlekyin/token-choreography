/**
 * Двуручная секира и её заглушки (двуручный меч, глефа, алебарда, молот, палица): ga* макета.
 * Тяжёлое оружие не машут, а разгоняют и тащат инерцией:
 *  раскрутка (выпад) — корпус уходит от цели, секира за спину; отпуск — секира разгоняется и тянет героя за собой.
 *    Попала — дуга вязнет в цели; мимо — героя доворачивает почти на полный круг; блок/броня — встаёт как в стену;
 *  колун (с замахом) — секира уходит за голову (сверху — короче, тень отходит), падение — удар в землю; цель оседает;
 *  зацеп (исподтишка) — секира заходит за цель, бородка дёргает её на себя, удар древком поперёк;
 *  таран (наскок) — разбег с древком поперёк груди, толчок — и с того же хода короткий колун.
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, ease, lerp, spring, wrapAngle } from "../util.mjs";
import { ARM, GUARD, IDLE, R } from "./weapon.mjs";
import { evade, glanceHit, landHit, readyCounter, weaponReach } from "./melee.mjs";

const calm = () => prefs.calm;

const GA_MOM = { wind: { ha: 1.35, ba: 0.25, ext: 2 }, strike: { ha: -0.25, ba: -0.12, ext: 14 }, kind: "slash", sweep: -1 };
const GA_CHOP = { wind: { ha: 0, ba: 0, ext: -8 }, strike: { ha: 0, ba: 0, ext: 14 }, kind: "chop", sweep: 0 };
const GA_HOOK = { wind: { ha: 0.05, ba: -0.22, ext: 22 }, strike: { ha: 0.75, ba: 0.4, ext: -12 }, kind: "hook", sweep: 0, pull: true };
const GA_CLEAVE = { wind: { ha: 2.3, ba: 0.9, ext: -4 }, strike: { ha: -0.45, ba: -0.05, ext: 14 }, kind: "slash", sweep: -1 };
const GA_REACH = { ha: 0.05, ba: -0.3, ext: 28 }, GA_YANK = { ha: 0.2, ba: -0.12, ext: -20 }, GA_BAR_HIT = { ha: 0.05, ba: -1.45, ext: 20 };
const GA_BAR = { ha: 0.1, ba: -1.5, ext: -16 };

const dustAt = (A, p, n, r) => { const s = A.sc(p); fx.dust(s.x, s.y, A.elev, n, r); };
const feet = (A, n, r) => { const p = A.pos; dustAt(A, { x: p.x, y: p.y + R * 0.6 }, n, r); };

/** Общий исход удара секирой: попадание, по броне, блок, промах (цель уходит) */
function resolve(A, dir, WP, power, counterAt, style = "heavy") {
  const b = A.b;
  if (A.miss && A.dodge === "parry" && b.rig) { evade(A, dir, "parry", "heavy", true); A.ax.v = A.ay.v = 0; return "stop"; }
  if (A.miss) {
    if (A.dodge === "side" && !b.react.dodge) b.react.dodge = { kind: "side", dir: dir + Math.PI / 2 * A.rng.sign(), t: 0 };
    if (A.dodge === "back" && !b.react.dodge) b.react.dodge = { kind: "back", dir, t: 0 };
    readyCounter(A, counterAt);
    return "miss";
  }
  if (A.glance) { glanceHit(A, dir, WP, power); return "stop"; }
  landHit(A, dir, power, A.crit, style, WP, true);
  return "hit";
}

/** Вернуть секиру из вертикального удара в обычный хват */
function level(w) {
  w.twistT = 0;
  if (w.phi == null) return;
  w.phi = null; w.ha.p = 0; w.ba.p = 0; w.ha.v = w.ba.v = 0;
  w.to(IDLE, 220);
}

/** Общий конец */
function finish(A) {
  const a = A.a, w = a.rig;
  if (w) { level(w); w.gp = null; w.twistT = 0; }
  A.place(A.home); A.ax.v = A.ay.v = 0;
  a.spin = 0; a.squash = 0; a.lean.p = 0; a.low = 0; a.react.white = 0;
}

/** Раскрутка: оружие тянет тело */
function momentum(A) {
  const a = A.a, b = A.b, w = a.rig, dir = A.dir, dx = A.dx, dy = A.dy, start = A.pos, home = A.home;
  const tx = Math.cos(dir - Math.PI / 2), ty = Math.sin(dir - Math.PI / 2);
  const reach = weaponReach(w.K, GA_CLEAVE), dist0 = Math.hypot(b.home.x - start.x, b.home.y - start.y);
  // Шаг на замахе: вперёд, если далеко, назад — если вплотную (секире нужно место для дуги)
  const stepIn = clamp(dist0 - reach - A.gap, -34, 60);
  const TW = 0.55 * A.rng.range(0.9, 1.12), HOLD = 0.07, TR = 0.2;
  const WP = { wind: GA_MOM.wind, strike: GA_MOM.strike, base: GA_MOM }, power = (A.crit ? 1.6 : 1) * 1.55;
  w.sweep = -1; w.faceLock = w.face = dir; a.spin = 0;
  A.state = {};
  let pt = 0, phase = "wind", outcome = "", sEnd = 0, prevOff = null, base = start, pos = start;
  const done = {}, once = (k, f) => { if (!done[k]) { done[k] = 1; f(); } };
  if (A.miss && A.dodge === "parry" && b.rig) A.later(TW + HOLD - 0.05, () => { b.rig.faceLock = dir + Math.PI; b.rig.to(GUARD, 1800); });
  if (A.miss && A.dodge === "duck") A.later(TW + HOLD + TR * 0.25, () => { b.react.dodge = { kind: "duck", dir, t: 0 }; });
  const contact = () => {
    phase = "after"; pt = 0; sEnd = a.spin; pos = A.pos; a.squash = 0;
    if (A.miss && A.dodge === "parry" && b.rig) { outcome = "stop"; evade(A, dir, "parry", "heavy", true); A.ax.v = A.ay.v = 0; }
    else if (A.miss) {
      outcome = "miss";
      if (A.dodge === "side") b.react.dodge = { kind: "side", dir: dir + Math.PI / 2, t: 0 };
      if (A.dodge === "back") b.react.dodge = { kind: "back", dir, t: 0 };
      // Открылся: ответ приходит, пока героя ещё крутит
      readyCounter(A, 0.62);
    }
    else if (A.glance) { outcome = "stop"; glanceHit(A, dir, WP, power); }
    else { outcome = "hit"; landHit(A, dir, power, A.crit, "lunge", WP, true); if (b.react.stagger) b.react.stagger.twist *= 1.6; }
  };
  A.task = dt => {
    pt += dt;
    if (phase === "wind") {
      // Замах: корпус медленно уходит от цели, секира волочится за спину; упор — и пауза наверху
      const k = clamp(pt / TW), e = ease.inOut(k), m = ease.out(k);
      a.spin = 1.5 * e; w.to(GA_MOM.wind, 320);
      A.place({ x: start.x + dx * stepIn * m, y: start.y + dy * stepIn * m });
      a.squash = 0.14 * e; a.leanDir = dir; a.lean.p = -0.08 * e;
      if (k >= 1) once("plant", () => feet(A, calm() ? 2 : 6, 0.7));
      if (pt >= TW + HOLD) { phase = "release"; pt = 0; base = A.pos; }
      return true;
    }
    if (phase === "release") {
      // Разгон: сорвалась медленно, прошла быстро. Секира тянет героя вперёд и вбок по ходу дуги
      const k = clamp(pt / TR), d = ease.in(k);
      a.spin = lerp(1.5, -1.05, d); w.to(GA_MOM.strike, 2400);
      A.place({ x: base.x + dx * 10 * d + tx * 14 * d, y: base.y + dy * 10 * d + ty * 14 * d });
      a.squash = -0.1 * d; a.leanDir = dir - 0.6; a.lean.p = 0.1;
      // Контакт — в тот миг, когда лезвие проходит линию на цель
      const g = w.grip(), off = wrapAngle(g.a - Math.atan2(b.home.y - g.y, b.home.x - g.x));
      if ((prevOff != null && prevOff > 0 && off <= 0 && prevOff < 1.5) || k >= 1) contact();
      prevOff = off;
      return true;
    }
    const t = pt, S = A.state;
    if (outcome === "hit") {
      // Дуга вязнет в цели: дотягивается ещё немного и гаснет
      if (t < 0.25) { const e = ease.out(t / 0.25); a.spin = sEnd - 0.5 * e; A.place({ x: pos.x + tx * 8 * e, y: pos.y + ty * 8 * e }); w.to({ ha: -0.85, ba: -0.3, ext: 10 }, 900); }
      else if (t > 0.45) { a.spin += -a.spin * clamp(dt * 6); w.to(IDLE, 220); a.lean.p = 0; }
    } else if (outcome === "miss") {
      // Гасить нечем: секира уходит дальше и разворачивает героя почти по кругу, ноги проскальзывают
      if (t < 0.5) {
        const e = ease.out(t / 0.5), tg = dir - Math.PI / 2 - 1.2 * e;
        a.spin = sEnd - 3 * e;
        A.place({ x: pos.x + Math.cos(tg) * 30 * e + dx * 10 * e, y: pos.y + Math.sin(tg) * 30 * e + dy * 10 * e });
        w.to({ ha: -1.1, ba: -0.5, ext: 12 }, 700); a.leanDir = tg; a.lean.p = 0.12;
        if (Math.random() < 0.35) feet(A, 1, 0.4);
        if (t > 0.32) once("scrape", () => dustAt(A, w.tip(), calm() ? 2 : 7, 0.7));
      } else {
        once("stumble", () => { a.react.stagger = { t: 0, amp: 0.14, dir, twist: 0 }; a.sx.v += 4; a.sy.v -= 4; feet(A, calm() ? 2 : 5, 0.6); });
        // Выправляется: доводит оборот до конца и только потом возвращается
        if (t > 0.7) { const e = ease.inOut(clamp((t - 0.7) / 0.6)); a.spin = lerp(sEnd - 3, -6.283, e); w.to(IDLE, 200); a.lean.p = 0; }
      }
    } else {
      // Встала как в стену: отдача разворачивает назад, секира отлетает
      if (t < 0.15) a.spin = sEnd + 0.55 * ease.out(t / 0.15);
      else a.spin += -a.spin * clamp(dt * 5);
      if (t < 0.3 && S.knockPose) w.to(S.knockPose, 900); else w.to(IDLE, 220);
      if (t < 0.3) A.place(pos);
    }
    const back = outcome === "miss" ? 1.15 : outcome === "hit" ? 0.5 : 0.35;
    if (t > back) { spring(A.ax, home.x, 90, 17, dt); spring(A.ay, home.y, 90, 17, dt); }
    if (t > (outcome === "miss" ? 1.75 : 1.2)) { finish(A); w.release(); return false; }
    return true;
  };
}

/** Колун: секира за голову, пауза с дрожью, падение; цель оседает. ram — с хода тарана (быстрый) */
function chop(A, { ram = false } = {}) {
  const a = A.a, b = A.b, w = a.rig, home = A.home, B = b.at;
  const dir = Math.atan2(B.y - A.pos.y, B.x - A.pos.x), dx = Math.cos(dir), dy = Math.sin(dir);
  if (A.dodge === "duck") A.dodge = "side";
  // Лезвие должно прийтись на середину цели: руки вытянуты вперёд, до лезвия — почти вся длина
  const stand = (ARM * 1.15 + 14) * 0.9 + w.K.len * w.K.grip * 0.8 + A.gap;
  const TL = ram ? 0.16 : 0.72 * A.rng.range(0.92, 1.1), HOLD = ram ? 0 : 0.16, TD = 0.12;
  const WP = { wind: GA_CHOP.wind, strike: GA_CHOP.strike, base: GA_CHOP }, power = (A.crit ? 1.6 : 1) * 1.75;
  w.sweep = 1; w.faceLock = w.face = dir; a.spin = 0;
  const phi0 = ram ? 1.25 : 2.95, phiTop = 2.2;
  w.phi = phi0; w.twistT = 0.72;
  A.state = {};
  let pt = 0, phase = "lift", outcome = "", from = A.pos;
  const done = {}, once = (k, f) => { if (!done[k]) { done[k] = 1; f(); } };
  if (A.miss && A.dodge === "parry" && b.rig) A.later(TL + HOLD - 0.04, () => { b.rig.faceLock = dir + Math.PI; b.rig.to(GUARD, 1800); });
  if (A.miss && A.dodge !== "parry") A.later(TL + HOLD + TD * 0.35, () => resolve(A, dir, WP, power, 0.9));
  A.task = dt => {
    pt += dt;
    // Цель могло отбросить (таран) — встаём от её настоящего места
    const bb = b.at, d0 = Math.hypot(bb.x - from.x, bb.y - from.y), step = clamp(d0 - stand, -40, 70);
    if (phase === "lift") {
      const k = clamp(pt / TL), e = ease.inOut(k);
      w.phi = lerp(phi0, phiTop, e); w.to(GA_CHOP.wind, 400);
      const m = ease.out(clamp(pt / (ram ? TL : TL * 0.6)));
      A.place({ x: from.x + dx * step * m, y: from.y + dy * step * m });
      a.leanDir = dir; a.lean.p = -0.1 * e; a.squash = -0.06 * e;
      if (pt >= TL) { phase = "hold"; pt = 0; from = A.pos; }
      return true;
    }
    if (phase === "hold") {
      const k = clamp(pt / Math.max(HOLD, 0.001));
      a.ox.p = Math.sin(A.time * 70) * 1.6 * k; a.react.white = 0.2 * k * Math.abs(Math.sin(A.time * 18));
      if (pt >= HOLD) { phase = "drop"; pt = 0; from = A.pos; }
      return true;
    }
    if (phase === "drop") {
      const k = clamp(pt / TD), e = ease.in(k);
      w.phi = lerp(phiTop, -0.04, e); w.to(GA_CHOP.strike, 3000);
      A.place({ x: from.x + dx * 8 * e, y: from.y + dy * 8 * e });
      a.leanDir = dir; a.lean.p = 0.14 * e; a.squash = 0.14 * e;
      if (k >= 1) {
        phase = "after"; pt = 0;
        const tp = A.sc(w.tip());
        if (A.miss && A.dodge !== "parry") {
          outcome = "bury";
          fx.crack(tp.x, tp.y, A.elev); fx.dust(tp.x, tp.y, A.elev, calm() ? 3 : 12, 0.9);
          fx.ring(tp.x, tp.y, A.elev, { r: 6, life: 0.3, w: 4, grow: 46 }); A.shake(7);
        } else {
          outcome = resolve(A, dir, WP, power, 0.5);
          if (outcome === "hit") {
            // Удар сверху вдавливает, а не отбрасывает: цель оседает, толчок — слабый
            b.ox.v *= 0.3; b.oy.v *= 0.3; b.react.sink = { t: 0 }; b.sx.v += 8; b.sy.v -= 2;
            fx.crack(tp.x, tp.y, A.elev);
            dustAt(A, { x: b.home.x, y: b.home.y + R * 0.5 }, calm() ? 3 : 10, 0.8); A.shake(9);
          }
        }
      }
      return true;
    }
    const t = pt;
    if (outcome === "bury") {
      // Врубилась: держится, герой рвёт её на себя — рывок, пыль, секира выходит из земли
      if (t < 0.45) { w.phi = -0.04; a.lean.p = 0.1; }
      else {
        once("wrench", () => { a.lean.v -= 3; a.sy.v += 3; dustAt(A, w.tip(), calm() ? 2 : 7, 0.6); });
        w.phi = lerp(-0.04, 0.9, ease.out(clamp((t - 0.45) / 0.18)));
        if (t > 0.63) level(w);
      }
    } else if (outcome === "hit") {
      if (t < 0.18) w.phi = 0; else if (t < 0.34) w.phi = lerp(0, 0.7, ease.out((t - 0.18) / 0.16)); else level(w);
      a.lean.p = t < 0.18 ? 0.12 : 0;
    } else {
      // Блок или броня: секиру подбрасывает отдачей, затем — в покой
      if (t < 0.14) w.phi = lerp(0, 1.1, ease.out(t / 0.14)); else if (t < 0.3) w.phi = 1.1; else level(w);
    }
    a.squash = Math.max(0, a.squash - dt * 2);
    if (t > (outcome === "bury" ? 0.75 : 0.45)) { spring(A.ax, home.x, 90, 17, dt); spring(A.ay, home.y, 90, 17, dt); a.lean.p = 0; }
    if (t > (outcome === "bury" ? 1.5 : 1.15)) { finish(A); w.release(); return false; }
    return true;
  };
}

/** Зацеп: секира за цель, рывок на себя, удар древком поперёк */
function hook(A) {
  const a = A.a, b = A.b, w = a.rig, dir = A.dir, dx = A.dx, dy = A.dy, start = A.pos, home = A.home;
  if (A.dodge === "duck") A.dodge = "side";
  const stand = weaponReach(w.K, GA_HOOK) + A.gap;
  const step = clamp(Math.hypot(b.home.x - start.x, b.home.y - start.y) - stand, -40, 70);
  const TR = 0.34 * A.rng.range(0.92, 1.1), TY = 0.16;
  const WP = { wind: GA_REACH, strike: GA_YANK, base: GA_HOOK }, power = (A.crit ? 1.6 : 1) * 0.9;
  w.sweep = -1; w.faceLock = w.face = dir; a.spin = 0;
  A.state = {};
  const G0 = w.K.grip;
  let pt = 0, phase = "reach", outcome = "", from = start;
  const done = {}, once = (k, f) => { if (!done[k]) { done[k] = 1; f(); } };
  if (A.miss && A.dodge === "parry" && b.rig) A.later(TR - 0.06, () => { b.rig.faceLock = dir + Math.PI; b.rig.to(GUARD, 1800); });
  // Цель замечает и выходит из-под зацепа до рывка
  if (A.miss && A.dodge !== "parry") A.later(TR * 0.75, () => resolve(A, dir, WP, power, 0.5));
  A.task = dt => {
    pt += dt;
    if (phase === "reach") {
      const e = ease.out(clamp(pt / TR));
      A.place({ x: start.x + dx * step * e, y: start.y + dy * step * e }); a.low = e; a.leanDir = dir; a.lean.p = 0.08 * e;
      w.to(GA_REACH, 700);
      if (pt >= TR) { phase = "yank"; pt = 0; from = A.pos; }
      return true;
    }
    if (phase === "yank") {
      // Рывок: герой откидывается назад, секира идёт к нему
      const k = clamp(pt / TY), e = ease.in(k);
      w.to(GA_YANK, 2600); A.place({ x: from.x - dx * 16 * e, y: from.y - dy * 16 * e }); a.leanDir = dir; a.lean.p = -0.12 * e;
      if (k >= 0.35) once("contact", () => {
        if (A.miss && A.dodge !== "parry") { outcome = "miss"; return; }
        outcome = resolve(A, dir, WP, power, 0.5, "lunge");
        if (outcome === "hit") {
          // Цель тащит к герою и разворачивает боком
          b.react.sink = null; b.duck = 0; b.ox.v = b.oy.v = 0;
          b.react.retreat = { t: 0, dur: 0.5, dist: R * 1.5, dir: dir + Math.PI };
          b.react.stagger = { t: 0, amp: 0.1, dir: dir + Math.PI, twist: 0.9 * (A.crit ? 1.3 : 1) };
          dustAt(A, { x: b.home.x, y: b.home.y + R * 0.6 }, calm() ? 2 : 6, 0.6);
        }
      });
      if (pt >= TY) {
        phase = "after"; pt = 0; from = A.pos;
        if (outcome === "miss") { a.react.stagger = { t: 0, amp: 0.12, dir: dir + Math.PI }; a.react.overrun = { t: 0, dir: dir + Math.PI }; }
      }
      return true;
    }
    const t = pt;
    if (outcome === "hit") {
      // Удар древком: руки перехватывают на середину, древко поперёк груди — и обеими руками в подтянутую цель
      if (t < 0.14) { const k = ease.inOut(t / 0.14); w.gp = lerp(G0, 0.5, k); w.twistT = 0.55; w.to(GA_BAR, 1400); a.low = 1 - k; a.lean.p = -0.06; }
      else if (t < 0.3) {
        w.gp = 0.5; w.to(GA_BAR_HIT, 3400); a.leanDir = dir; a.lean.p = 0.14; a.low = 0;
        const k = ease.in(clamp((t - 0.14) / 0.08)); A.place({ x: from.x + dx * 18 * k, y: from.y + dy * 18 * k });
      }
      if (t > 0.2) once("haft", () => {
        const g = w.grip(), B = b.at, m = A.sc({ x: (g.x + B.x) / 2, y: (g.y + B.y) / 2 });
        fx.ring(m.x, m.y, A.elev, { r: 10, life: 0.24, w: 5, grow: 56, hit: true });
        b.react.white = 0.8; b.sx.v -= 6; b.sy.v += 5;
        b.react.retreat = null; b.ox.v += dx * 620; b.oy.v += dy * 620; b.react.stagger = { t: 0, amp: 0.12, dir, twist: 0 };
        dustAt(A, { x: B.x, y: B.y + R * 0.5 }, calm() ? 2 : 7, 0.7); a.sx.v -= 3; a.sy.v += 3;
        A.stop(0.07); A.shake(4);
      });
      // Обратный перехват — к концу древка, секира в покой
      if (t > 0.38) { w.gp = lerp(0.5, G0, ease.inOut(clamp((t - 0.38) / 0.2))); w.twistT = 0; w.to(IDLE, 220); }
      if (t > 0.6) w.gp = null;
    } else {
      a.low = Math.max(0, a.low - dt * 4);
      if (t > 0.2) w.to(IDLE, 220);
    }
    if (t > 0.45) { spring(A.ax, home.x, 90, 17, dt); spring(A.ay, home.y, 90, 17, dt); a.lean.p = 0; a.low = 0; }
    if (t > 1.1) { finish(A); w.release(); return false; }
    return true;
  };
}

/** Таран: разбег с древком поперёк, толчок проходит всегда — и с того же хода колун (его решает бросок) */
function ram(A) {
  const a = A.a, b = A.b, w = a.rig, dir = A.dir, dx = A.dx, dy = A.dy, from = A.pos, B = b.home;
  const reach = { x: B.x - dx * (R * 2.05 + A.gap), y: B.y - dy * (R * 2.05 + A.gap) }, TC = 0.16, TG = 0.3;
  w.sweep = -1; w.faceLock = w.face = dir; a.spin = 0;
  let time = 0, phase = "crouch";
  A.task = () => {
    time = A.time;
    // Хват на середине древка — секира поперёк груди
    w.gp = lerp(w.K.grip, 0.5, clamp(time / TC)); w.twistT = 0.55;
    w.to(GA_BAR, 900);
    if (phase === "crouch") {
      const k = clamp(time / TC); a.squash = 0.14 * k; a.leanDir = dir; a.lean.p = -0.05 * k;
      if (time >= TC) phase = "run";
      return true;
    }
    if (phase === "run") {
      const k = clamp((time - TC) / TG), e = ease.in(k);
      A.place({ x: lerp(from.x, reach.x, e), y: lerp(from.y, reach.y, e) }); a.squash = -0.08; a.leanDir = dir; a.lean.p = 0.16;
      a.hop = 4 * Math.abs(Math.sin(k * Math.PI * 3));
      if (Math.random() < 0.5) { const p = A.pos; dustAt(A, { x: p.x - dx * R * 0.5, y: p.y + R * 0.5 }, 1, 0.4); }
      if (k >= 1) {
        phase = "shove"; a.hop = 0; a.squash = 0;
        b.react.retreat = { t: 0, dur: 0.4, dist: 46, dir }; b.react.stagger = { t: 0, amp: 0.12, dir, twist: 0 };
        b.react.white = 0.5; b.sx.v -= 5; b.sy.v += 4;
        const c = A.sc({ x: B.x - dx * R, y: B.y - dy * R });
        fx.ring(c.x, c.y, A.elev, { r: 10, life: 0.25, w: 5, grow: 50, hit: true }); feet(A, calm() ? 3 : 10, 0.8);
        A.stop(0.08); A.shake(5);
        w.ext.v += 200;
        // С того же хода — колун: древко из поперечного хвата перехватывается к концу
        A.later(0.1, () => { w.gp = null; chop(A, { ram: true }); });
        return false;
      }
    }
    return true;
  };
}

/** Приёмы секиры по стилю */
export function greataxe(A, style) {
  ({ lunge: momentum, heavy: chop, sneak: hook, leap: ram }[style] ?? momentum)(A);
}
