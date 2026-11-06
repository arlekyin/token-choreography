/**
 * Колющее оружие: рапира и кинжал (приёмы rp и dg макета). Удар — укол: рука вперёд раньше ноги, тело догоняет; остриё
 * входит в цель (клинок уходит под токен цели), держится миг и выходит с кровью. По броне остриё соскальзывает
 * с искрами. Промах — цель уходит с линии в начале выпада (пригнуться под укол нельзя — уходит вбок) или парирует.
 *
 * Рапира: укол (выпад), финт (исподтишка), связка (с замахом), флеш (наскок).
 * Кинжал: тычок (выпад и наскок), в спину (исподтишка), захват и удар (с замахом).
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, ease, lerp } from "../util.mjs";
import { ARM, GUARD, IDLE, PUSH, R } from "./weapon.mjs";
import { evade, readyCounter } from "./melee.mjs";

const calm = () => prefs.calm;

/** Где встать, чтобы остриё на полном выпаде вошло в цель на depth за ближний край */
const standFor = (K, depth) => ARM + 22 + K.len * K.grip + R - depth;
/** Точка на линии атаки на расстоянии d (+ разница размеров) от цели */
const at = (A, d) => { const B = A.b.home; return { x: B.x - A.dx * (d + A.gap), y: B.y - A.dy * (d + A.gap) }; };
/** Расстояние до цели за вычетом разницы размеров */
const distOf = A => { const B = A.b.home, H = A.home; return Math.hypot(B.x - H.x, B.y - H.y) - A.gap; };
/** Поза руки: клинок на цель */
const aimAt = (A, ha, ext, off = 0) => A.a.rig.aim(A.pos, A.B, ha, ext, off);
const tipIn = A => { const tp = A.a.rig.tip(), B = A.B; return Math.hypot(tp.x - B.x, tp.y - B.y) < R * 0.95 * A.b.z; };

/** Промах: цель уходит с линии в начале выпада */
function dodgeLine(A) {
  const d = A.dodge === "duck" ? "side" : A.dodge, b = A.b;
  if (d === "side") b.react.dodge = { kind: "side", dir: A.dir + Math.PI / 2 * A.rng.sign(), t: 0 };
  if (d === "back") b.react.dodge = { kind: "back", dir: A.dir, t: 0 };
}

/** Укол вошёл: цель вздрагивает и сжимается, не отлетает; кровь — на входе, сквозной — и с другой стороны */
function pierceHit(A, power, through) {
  const a = A.a, b = A.b, dir = A.dir, dx = A.dx, dy = A.dy, B = b.home, e = b.token.document.elevation;
  power *= A.sizeK;
  const ex = A.sc({ x: B.x - dx * R * 0.9 * b.z, y: B.y - dy * R * 0.9 * b.z });
  a.rig.pierce = true;
  A.stop(Math.min(0.14, 0.045 + 0.03 * power));
  b.react.white = 0.9; b.react.red = Math.min(1, 0.45 + 0.2 * power);
  b.ox.v += dx * 140 * power; b.oy.v += dy * 140 * power; b.sx.v += 4; b.sy.v -= 5;
  b.react.stagger = { t: 0, amp: 0.05 * power, dir, twist: A.rng.range(-0.15, 0.15) };
  fx.ring(ex.x, ex.y, e, { r: 4, life: 0.18, w: 2.5, grow: 26, hit: true });
  fx.blood(ex.x, ex.y, e, dir + Math.PI, 3, A);
  if (through) {
    const out = A.sc({ x: B.x + dx * R * 1.1 * b.z, y: B.y + dy * R * 1.1 * b.z });
    fx.blood(out.x, out.y, e, dir, Math.round(8 * power), A);
    fx.ring(out.x, out.y, e, { r: 4, life: 0.2, w: 2.5, grow: 30, hit: true });
  }
  A.shake(1.5 * power);
}

/** Клинок выходит из цели — брызги на атакующего */
function withdraw(A, n) {
  const w = A.a.rig;
  if (!w?.pierce) return;
  const B = A.B, p = A.sc({ x: B.x - A.dx * R * 0.9 * A.b.z, y: B.y - A.dy * R * 0.9 * A.b.z });
  fx.blood(p.x, p.y, A.b.token.document.elevation, A.dir + Math.PI, n, A);
  A.later(0.12, () => { w.pierce = false; });
}

/** По броне: остриё соскальзывает вбок с искрами */
function glanceOff(A, side) {
  const b = A.b, tp = A.sc(A.a.rig.tip()), e = b.token.document.elevation;
  fx.sparks(tp.x, tp.y, e, A.dir + Math.PI, calm() ? 4 : 10); fx.clash(tp.x, tp.y, e);
  b.react.ringFlash = 1; b.react.white = 0.4; b.ox.v += A.dx * 160; b.oy.v += A.dy * 160;
  A.stop(0.05);
  A.a.rig.to(aimAt(A, -0.1, 18, side * R * 1.5), 2600);
}

/** Выпад: рука вперёд раньше ноги, тело догоняет; на контакте — исход. o: dur, to, off, ext, power, through, onContact */
function thrustStep(A, o) {
  const a = A.a, w = a.rig;
  let from;
  return {
    dur: o.dur,
    start() { from = A.pos; if (A.miss && A.dodge !== "parry") dodgeLine(A); },
    fn(k) {
      const e = ease.in(clamp((k - 0.2) / 0.8));
      A.place({ x: lerp(from.x, o.to.x, e), y: lerp(from.y, o.to.y, e) });
      a.leanDir = A.dir; a.lean.p = 0.15 * k; a.squash = -0.12 * e;
      if (!A.done) w.to(aimAt(A, -0.12, o.ext ?? 22, o.off ?? 0), 4200);
      if (A.done) return;
      // Парирование: клинок защитника встречает остриё на подходе
      if (A.miss && A.dodge === "parry" && A.b.rig && k > 0.55) {
        A.done = "parry"; evade(A, A.dir, "parry", "sneak", false); A.ax.v = A.ay.v = 0; this.cut = true; o.onContact?.("parry"); return;
      }
      if (!A.miss && tipIn(A)) {
        if (A.glance) { A.done = "glance"; glanceOff(A, (o.off ?? 0) < 0 ? -1 : 1); this.cut = true; }
        else { A.done = "hit"; pierceHit(A, o.power ?? 1, o.through); }
        o.onContact?.(A.done);
      }
    },
    end() {
      if (A.done) return;
      // Не дотянулся по расчёту, а бросок попал — укол всё равно входит
      if (!A.miss) { A.done = A.glance ? "glance" : "hit"; if (A.glance) glanceOff(A, 1); else pierceHit(A, o.power ?? 1, o.through); o.onContact?.(A.done); return; }
      A.done = "miss"; readyCounter(A, A.counterAt ?? 0.3); o.onContact?.("miss");
    }
  };
}

/** Назад в меру (домой), клинок — в покой */
function recover(A, dur = 0.26) {
  let from;
  return {
    dur,
    start() { from = A.pos; },
    fn(k) {
      const e = ease.out(k);
      A.place({ x: lerp(from.x, A.home.x, e), y: lerp(from.y, A.home.y, e) });
      A.a.lean.p = -0.05 * (1 - k); A.a.squash = 0;
      if (k > 0.5) A.a.rig.to(IDLE, 300);
    }
  };
}

/** Хвост после контакта: попадание — клинок держится миг, выходит с кровью; затем назад в меру */
function after(A, hold = 0.09, n = 6) {
  return [
    { dur: A.done === "hit" ? hold : 0.06, fn() { if (A.done === "hit") A.a.squash = -0.1; }, end() { if (A.done === "hit") withdraw(A, n); } },
    recover(A)
  ];
}

/** Общий конец */
function finish(A) {
  const a = A.a;
  A.place(A.home); A.ax.v = A.ay.v = 0;
  a.squash = 0; a.lean.p = 0; a.low = 0;
  if (a.rig) { a.rig.pierce = false; a.rig.flen = 1; a.rig.twistT = 0; a.rig.to(IDLE, 260); }
}

/** Последний шаг, который достраивает хвост, когда исход уже известен */
const then = (steps, fn) => ({ dur: 0, end() { steps.push(...fn()); } });

/* ---------- Рапира ---------- */

/** Укол — стоккада: короткий сбор в стойку (остриё на цель), выпад; сразу назад в меру */
function rpLunge(A) {
  const a = A.a, K = a.rig.K, depth = A.crit ? R * 0.95 : R * 0.6, S = standFor(K, depth);
  const windD = clamp(distOf(A), S + 40, S + 90);
  let from;
  const steps = [
    {
      dur: 0.14 * A.rng.range(0.9, 1.15), start() { from = A.pos; },
      fn(k) { const e = ease.out(k), w = at(A, windD); A.place({ x: lerp(from.x, w.x, e), y: lerp(from.y, w.y, e) }); a.squash = 0.08 * e; a.leanDir = A.dir; a.lean.p = -0.05 * e; a.rig.to(aimAt(A, 0.55, -6), 900); }
    },
    thrustStep(A, { dur: 0.14, to: at(A, S), power: A.crit ? 1.5 : 1 })
  ];
  steps.push(then(steps, () => after(A)));
  A.seq(steps, () => finish(A));
}

/** Финт: ложный укол в одну сторону — цель закрывает её; остриё обводит под её клинком — укол в другой бок */
function rpFeint(A) {
  const a = A.a, b = A.b, K = a.rig.K, side = A.rng.sign(), S = standFor(K, R * 0.55) + 6;
  const windD = clamp(distOf(A), S + 30, S + 70);
  let from, fooled = false;
  const steps = [
    { dur: 0.1, start() { from = A.pos; }, fn(k) { const w = at(A, windD), e = ease.out(k); A.place({ x: lerp(from.x, w.x, e), y: lerp(from.y, w.y, e) }); a.rig.to(aimAt(A, 0.5, -6), 900); } },
    // Ложный укол: полвыпада в бок цели, ногой — только притоп
    {
      dur: 0.16,
      start() { a.sy.v += 3; a.sx.v -= 2; const p = A.sc(A.pos); fx.dust(p.x, p.y + R * 0.6 * A.u, A.elev, calm() ? 1 : 3, 0.4); },
      fn(k) {
        a.rig.to(aimAt(A, 0.15, 10, side * R * 0.8), 3000); a.leanDir = A.dir; a.lean.p = 0.07 * k;
        if (k > 0.45 && !fooled) {
          fooled = true;
          if (b.rig) { b.rig.faceLock = A.dir + Math.PI; b.rig.to({ ...GUARD, ha: GUARD.ha - side * 0.55, ba: GUARD.ba + side * 0.3 }, 1600); }
          b.leanDir = A.dir + Math.PI / 2 * -side; b.lean.p = 0.06; b.sx.v -= 2;
        }
      }
    },
    // Обвод: остриё ныряет под клинок цели по дуге и выходит с другой стороны
    { dur: 0.12, fn(k) { const g = Math.PI * k; a.rig.to(aimAt(A, 0.1 - 0.1 * Math.sin(g), 4 - 8 * Math.sin(g), side * R * 0.8 * Math.cos(g)), 3600); } },
    thrustStep(A, { dur: 0.13, to: at(A, S), off: -side * R * 0.45, power: A.crit ? 1.4 : 0.95 })
  ];
  steps.push(then(steps, () => {
    b.lean.p = 0;
    if (b.rig && A.done !== "parry") A.later(0.3, () => b.rig?.to(IDLE, 400));
    return after(A);
  }));
  A.seq(steps, () => finish(A));
}

/** Связка: клинки сходятся, рапира уводит клинок цели с линии — укол вдоль него насквозь. Без оружия у цели — долгий сбор */
function rpBind(A) {
  const a = A.a, b = A.b, K = a.rig.K, S = Math.max(R * 2.1, standFor(K, R * 2.6) - 12), bindD = S + 118;
  let from;
  const steps = [{
    dur: 0.2,
    start() { from = A.pos; if (b.rig) { b.rig.faceLock = A.dir + Math.PI; b.rig.to(GUARD, 1400); } },
    fn(k) {
      const e = ease.inOut(k), w = at(A, bindD);
      A.place({ x: lerp(from.x, w.x, e), y: lerp(from.y, w.y, e) }); a.squash = 0.1 * e;
      a.rig.to(aimAt(A, 0.45, 0, b.rig ? R * 0.5 : 0), 1200);
      if (!b.rig) { a.ox.p = Math.sin(k * 60) * 1.2 * k; a.react.white = 0.2 * k * Math.abs(Math.sin(k * 30)); }
    }
  }];
  if (b.rig) steps.push(
    // Клинки сходятся: искра на скрещении
    {
      dur: 0.12,
      start() { const m = A.sc(b.rig.mid()), e = b.token.document.elevation; fx.clash(m.x, m.y, e); fx.sparks(m.x, m.y, e, A.dir + Math.PI, calm() ? 2 : 5); },
      fn() { a.rig.to(aimAt(A, 0.3, 8, R * 0.35), 2000); }
    },
    // Давит: клинок цели уходит с линии наружу, цель отклоняется
    {
      dur: 0.16,
      start() { b.rig.to({ ...PUSH, ha: PUSH.ha + 0.7, ba: PUSH.ba + 0.9 }, 900); b.lean.p = -0.06; b.leanDir = A.dir; },
      fn(k) { a.rig.to(aimAt(A, 0.15, 12, R * 0.35 * (1 - k)), 2400); A.place(at(A, bindD - 14 * k)); }
    });
  steps.push(thrustStep(A, { dur: 0.17, to: at(A, S), ext: 34, through: true, power: A.crit ? 2 : 1.5 }));
  steps.push(then(steps, () => {
    if (b.rig && A.done !== "parry") A.later(0.35, () => { b.rig?.to(IDLE, 300); b.lean.p = 0; });
    return after(A, 0.16, 10);
  }));
  A.seq(steps, () => finish(A));
}

/** Флеш: разбег с вытянутым клинком, укол на ходу — пробегает мимо цели, разворачивается и возвращается обходом */
function rpFleche(A) {
  const a = A.a, b = A.b, K = a.rig.K, side = A.rng.sign(), B = b.home;
  const px = Math.cos(A.dir + side * Math.PI / 2), py = Math.sin(A.dir + side * Math.PI / 2);
  const S = standFor(K, R * 0.55), g = A.gap;
  const pass = { x: B.x + px * (R * 2.9 + g) + A.dx * R * 1.3, y: B.y + py * (R * 2.9 + g) + A.dy * R * 1.3 };
  const wide = { x: B.x + px * (R * 3.3 + g) - A.dx * R * 0.2, y: B.y + py * (R * 3.3 + g) - A.dy * R * 0.2 };
  const startD = Math.max(distOf(A), S + 70);
  const face = () => { const p = A.pos; a.rig.faceLock = Math.atan2(B.y - p.y, B.x - p.x); };
  const dust = n => { const p = A.sc(A.pos); fx.dust(p.x, p.y + R * 0.6 * A.u, A.elev, n, 0.5); };
  let from;
  const steps = [
    { dur: 0.1, start() { from = A.pos; }, fn(k) { const w = at(A, startD); A.place({ x: lerp(from.x, w.x, ease.out(k)), y: lerp(from.y, w.y, ease.out(k)) }); a.squash = 0.1 * k; a.rig.to(aimAt(A, -0.1, 18), 1600); a.leanDir = A.dir; a.lean.p = 0.1 * k; } },
    thrustStep(A, { dur: 0.2, to: at(A, S), power: A.crit ? 1.5 : 1.1, onContact: d => { if (d === "parry") a.react.recoil = null; } })
  ];
  // С той стороны, где у цели оружие, мимо не пробежать — после укола отскок наискось назад, прочь от клинка
  if (b.rig && side === -1) {
    A.counterAt = 0.04;
    steps.push(then(steps, () => {
      let f2;
      const s0 = at(A, S), out = { x: s0.x + px * R * 1.4 - A.dx * R * 1.1, y: s0.y + py * R * 1.4 - A.dy * R * 1.1 };
      return [
        {
          dur: 0.22, start() { f2 = A.pos; if (A.done === "hit") withdraw(A, 7); },
          fn(k) { const e = ease.out(k); A.place({ x: lerp(f2.x, out.x, e), y: lerp(f2.y, out.y, e) }); a.hop = 14 * Math.sin(k * Math.PI); face(); a.rig.to(aimAt(A, 0.45, -4), 900); a.lean.p = -0.08 * (1 - k); a.squash = 0; },
          end() { a.hop = 0; dust(calm() ? 2 : 5); a.sx.v -= 3; a.sy.v += 3; }
        },
        { dur: 0.12 },
        { dur: 0.36, start() { f2 = A.pos; a.rig.to(IDLE, 500); }, fn(k) { const e = ease.inOut(k); A.place({ x: lerp(f2.x, A.home.x, e), y: lerp(f2.y, A.home.y, e) }); face(); } }
      ];
    }));
    return A.seq(steps, () => finish(A));
  }
  // Пробегает мимо: клинок выходит, тело уходит по дуге за цель; обратно — обходом, не сквозь цель
  steps.push(then(steps, () => {
    let f2;
    return [
      {
        dur: 0.26, start() { f2 = A.pos; if (A.done === "hit") withdraw(A, 7); },
        fn(k) {
          const e = ease.out(k), m = { x: lerp(f2.x, wide.x, e), y: lerp(f2.y, wide.y, e) };
          A.place({ x: lerp(m.x, lerp(wide.x, pass.x, e), e), y: lerp(m.y, lerp(wide.y, pass.y, e), e) });
          a.rig.faceLock = Math.atan2(pass.y - wide.y, pass.x - wide.x) * k + A.dir * (1 - k);
          a.rig.to(IDLE, 500); a.lean.p = 0.12 * (1 - k); a.squash = 0;
          if (Math.random() < 0.4) dust(1);
        }
      },
      { dur: 0.14, start() { dust(calm() ? 2 : 6); a.sx.v -= 3; a.sy.v += 3; }, fn() { face(); } },
      {
        dur: 0.5, start() { f2 = A.pos; },
        fn(k) {
          const e = ease.inOut(k), m1 = { x: lerp(f2.x, wide.x, e), y: lerp(f2.y, wide.y, e) }, m2 = { x: lerp(wide.x, A.home.x, e), y: lerp(wide.y, A.home.y, e) };
          A.place({ x: lerp(m1.x, m2.x, e), y: lerp(m1.y, m2.y, e) }); face();
          if (Math.random() < 0.2) dust(1);
        }
      }
    ];
  }));
  A.seq(steps, () => finish(A));
}

/* ---------- Кинжал ---------- */

/** Тычок: подшаг вплотную и короткий быстрый укол — клинок входит и выходит */
function dgPlain(A) {
  const a = A.a, K = a.rig.K, S = standFor(K, A.crit ? R * 0.75 : R * 0.45);
  let from;
  const steps = [
    { dur: 0.1, start() { from = A.pos; }, fn(k) { const w = at(A, S + 16), e = ease.out(k); A.place({ x: lerp(from.x, w.x, e), y: lerp(from.y, w.y, e) }); a.rig.to(aimAt(A, 0.45, -6), 1400); a.leanDir = A.dir; a.lean.p = 0.05; } },
    thrustStep(A, { dur: 0.07, to: at(A, S), power: A.crit ? 1.2 : 0.8, ext: 18 })
  ];
  steps.push(then(steps, () => after(A, 0.05, 4)));
  A.seq(steps, () => finish(A));
}

/** В спину: в обход за спину пригнувшись — обратный хват, удар сверху вниз; кровь сильнее */
function dgBack(A) {
  const a = A.a, b = A.b, w = a.rig, side = A.rng.sign(), B = b.home, D = R * 2.15 + A.gap;
  const a0 = Math.atan2(A.home.y - B.y, A.home.x - B.x), a1 = a0 + side * 2.1;
  const around = k => { const an = lerp(a0, a1, k); return { x: B.x + Math.cos(an) * D, y: B.y + Math.sin(an) * D }; };
  const aimBack = () => { const p = A.pos; A.dir = Math.atan2(B.y - p.y, B.x - p.x); A.dx = Math.cos(A.dir); A.dy = Math.sin(A.dir); w.faceLock = A.dir; };
  const steps = [
    { dur: 0.34, fn(k) { const p = around(ease.inOut(k)); A.place(p); a.low = Math.min(1, k * 2); aimBack(); w.to(IDLE, 400); } },
    // Обратный хват: клинок вниз — сверху короткий; рука вверх
    { dur: 0.1, start() { w.flen = 0.45; w.to({ ha: -0.25, ba: Math.PI - 0.35, ext: -2 }, 1600); if (A.miss) dodgeLine(A); } },
    {
      dur: 0.07, start() { w.to({ ha: -0.05, ba: Math.PI - 0.1, ext: 20 }, 5200); a.lean.p = 0.12; a.leanDir = A.dir; },
      end() {
        const tp = A.sc(w.tip()), e = b.token.document.elevation;
        if (A.miss) { A.done = "miss"; readyCounter(A, 0.3); return; }
        if (A.glance) { A.done = "glance"; fx.sparks(tp.x, tp.y, e, A.dir + Math.PI, calm() ? 4 : 9); b.react.ringFlash = 1; b.react.white = 0.4; return; }
        A.done = "hit"; pierceHit(A, A.crit ? 1.8 : 1.4, false); w.pierce = false;
        const c = A.sc(B); fx.blood(c.x, c.y, e, A.dir, 6, A); b.react.sink = { t: 0 };
      }
    },
    {
      dur: 0.14, start() {
        if (A.done === "hit") { const c = A.sc(B); fx.blood(c.x, c.y, b.token.document.elevation, A.dir + Math.PI, 4, A); }
        w.to({ ha: -0.25, ba: Math.PI - 0.35, ext: 0 }, 1200);
      }
    },
    {
      dur: 0.4, start() { w.flen = 1; w.to(IDLE, 500); },
      fn(k) { const e = ease.inOut(k), p = around(1 - e); A.place({ x: lerp(p.x, A.home.x, e * e), y: lerp(p.y, A.home.y, e * e) }); a.low = 1 - e; aimBack(); }
    }
  ];
  A.seq(steps, () => finish(A));
}

/** Захват и удар: левая хватает цель и тянет на себя, кинжал по рукоять, проворот — и толчок прочь */
function dgGrab(A) {
  const a = A.a, b = A.b, K = a.rig.K, S = standFor(K, R * 0.9);
  let from;
  const steps = [
    { dur: 0.14, start() { from = A.pos; }, fn(k) { const w = at(A, S + 6), e = ease.inOut(k); A.place({ x: lerp(from.x, w.x, e), y: lerp(from.y, w.y, e) }); a.rig.to({ ha: 0.9, ba: -0.2, ext: -6 }, 1200); a.lean.p = 0.08; a.leanDir = A.dir; } },
    { dur: 0.1, start() { if (!A.miss) { grabHand(A); b.react.retreat = { t: 0, dur: 0.18, dist: 10, dir: A.dir + Math.PI, sharp: true }; } } },
    thrustStep(A, { dur: 0.08, to: at(A, S), power: A.crit ? 1.6 : 1.2, ext: 20 })
  ];
  steps.push(then(steps, () => [
    {
      dur: 0.18,
      start() {
        if (A.done !== "hit") return;
        a.rig.twistT = 0.9; b.sx.v -= 4; b.sy.v += 4;
        const B = b.home, p = A.sc({ x: B.x - A.dx * R * 0.6, y: B.y - A.dy * R * 0.6 });
        fx.blood(p.x, p.y, b.token.document.elevation, A.dir + Math.PI, 4, A);
      },
      end() { a.rig.twistT = 0; }
    },
    {
      dur: 0.08,
      start() {
        if (A.done !== "hit") return;
        withdraw(A, 6);
        b.react.retreat = { t: 0, dur: 0.28, dist: 34, dir: A.dir, sharp: true };
        b.react.stagger = { t: 0, amp: 0.1, dir: A.dir, twist: 0.2 };
      }
    },
    recover(A, 0.3)
  ]));
  A.seq(steps, () => finish(A));
}

/** Левая рука держит цель: кулак у её края */
function grabHand(A) {
  const g = new PIXI.Graphics(), u = A.u, b = A.b, e = b.token.document.elevation;
  fx.add(g, 0.55, k => {
    const B = b.at, d = A.dir, rb = R * b.z * 0.9;
    const p = A.sc({ x: B.x - Math.cos(d) * rb + Math.cos(d - 1.57) * R * 0.35, y: B.y - Math.sin(d) * rb + Math.sin(d - 1.57) * R * 0.35 });
    g.clear();
    g.lineStyle({ width: 1.4 * u, color: 0x2d2118, alpha: k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2 });
    g.beginFill(0xc9a27c, k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2);
    g.drawCircle(p.x, p.y, R * 0.17 * u);
    g.endFill();
  }, { elevation: e });
}

/** Колющие приёмы по стилю; false — у вида своих приёмов нет */
export function thrust(A, style) {
  const moves = A.a.rig.K.moves;
  if (moves === "rapier") ({ lunge: rpLunge, sneak: rpFeint, heavy: rpBind, leap: rpFleche }[style] ?? rpLunge)(A);
  else if (moves === "dagger") ({ lunge: dgPlain, sneak: dgBack, heavy: dgGrab, leap: dgPlain }[style] ?? dgPlain)(A);
  else return false;
  return true;
}

/** Нужен ли этому приёму клинок цели (финт и связка показывают её защиту и при попадании) */
export const thrustNeedsDefender = (kind, style) => kind === "rapier" && (style === "sneak" || style === "heavy");
