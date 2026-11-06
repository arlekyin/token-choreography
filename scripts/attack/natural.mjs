/**
 * Атаки монстров без оружия (natAttack макета): удар телом, укус, когти.
 * Исход: попадание (сила по разнице размеров), по броне (глухой лязг, искры), промах — цель уходит заранее,
 * блок оружием — монстра отбрасывает. Остальные виды (щупальце, жало, касание) пока показываются ими же.
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { ease, lerp } from "../util.mjs";
import { GUARD, IDLE, PUSH, R } from "./weapon.mjs";
import { readyCounter } from "./melee.mjs";
import { shieldHit, useShield } from "./shield.mjs";

const calm = () => prefs.calm;

/** Где встать для удара: на расстоянии d (+ разница размеров) от цели по линии атаки */
const touchAt = (A, d) => { const B = A.b.home; return { x: B.x - A.dx * (d + A.gap), y: B.y - A.dy * (d + A.gap) }; };
/** Ближний край цели */
const edgeOf = (A, k = 0.85) => { const B = A.B; return { x: B.x - A.dx * R * A.b.z * k, y: B.y - A.dy * R * A.b.z * k }; };

/** Возврат на место (rpRecover макета) */
function recover(A, dur = 0.26) {
  let from;
  return {
    dur,
    start() { from = A.pos; },
    fn(k) { const e = ease.out(k); A.place({ x: lerp(from.x, A.home.x, e), y: lerp(from.y, A.home.y, e) }); A.a.lean.p = -0.05 * (1 - k); A.a.squash = 0; }
  };
}

/** Промах: цель уходит с линии в начале броска. Под удар телом не нырнуть — только в сторону */
function natDodge(A, kind) {
  const b = A.b, d = A.dodge === "duck" && kind === "slam" ? "side" : A.dodge;
  if (d === "duck") b.react.dodge = { kind: "duck", dir: A.dir, t: 0 };
  else if (d === "parry" && b.rig) { b.rig.faceLock = A.dir + Math.PI; b.rig.to(GUARD, 2200); }
  else if (d === "back") b.react.dodge = { kind: "back", dir: A.dir, t: 0 };
  else b.react.dodge = { kind: "side", dir: A.dir + Math.PI / 2 * A.rng.sign(), t: 0 };
}

/** Исход природной атаки; onHit(сила) — своё у каждого вида */
function natResolve(A, kind, at, p, onHit) {
  const a = A.a, b = A.b, e = b.token.document.elevation;
  p *= A.sizeK;
  const c = A.sc(at);
  if (A.miss && A.dodge === "parry" && b.rig) {
    // Блок: монстра отбрасывает назад от клинка
    if (useShield(A)) shieldHit(A, A.dir, p);
    else { fx.clash(c.x, c.y, e); fx.sparks(c.x, c.y, e, A.dir + Math.PI, Math.round((calm() ? 4 : 10) * p)); }
    A.later(0.04, () => b.rig?.to(PUSH, 3000));
    if (p > 1.05) { b.react.retreat = { t: 0, dur: 0.24, dist: 9 * p * p, dir: A.dir, sharp: true }; b.react.stagger = { t: 0, amp: 0.05 * p, dir: A.dir, twist: 0 }; }
    b.react.ringFlash = 0.5;
    A.stop(0.07);
    a.ox.v -= A.dx * 260; a.oy.v -= A.dy * 260;
    A.later(0.35, () => b.rig?.to(IDLE, 300));
    return "miss";
  }
  if (A.miss) {
    const p0 = A.sc(A.pos);
    fx.whiff(p0.x + A.dx * R * 1.2 * A.u, p0.y + A.dy * R * 1.2 * A.u, e, A.dir);
    readyCounter(A, 0.3);
    return "miss";
  }
  if (A.glance) {
    fx.sparks(c.x, c.y, e, A.dir + Math.PI, calm() ? 3 : 8);
    b.react.ringFlash = 1; b.react.white = 0.4;
    b.ox.v += A.dx * 150 * p; b.oy.v += A.dy * 150 * p;
    A.stop(0.05);
    a.ox.v -= A.dx * 200; a.oy.v -= A.dy * 200;
    return "glance";
  }
  const pp = p * (A.crit ? 1.5 : 1);
  A.stop(Math.min(0.14, 0.05 + 0.03 * pp));
  b.react.white = 0.9; b.react.red = 0.5 + 0.2 * pp;
  b.sx.v -= 4 * pp; b.sy.v += 4 * pp;
  b.react.stagger = { t: 0, amp: 0.06 * pp, dir: A.dir, twist: A.rng.range(-0.3, 0.3) * pp };
  A.shake(2 * pp);
  onHit?.(pp, c, e);
  return "hit";
}

/**
 * @param {import("./attack.mjs").Attack} A
 * @param {"slam"|"bite"|"claw"} kind
 */
export function natural(A, kind) {
  const a = A.a, b = A.b, steps = [];
  let from;
  if (kind === "slam") {
    // Удар телом: тяжёлый сбор — перевалистый рывок — удар корпусом: цель отлетает, туша отскакивает
    steps.push({
      dur: 0.32, start() { from = A.pos; },
      fn(k) {
        const e = ease.inOut(k);
        a.squash = 0.14 * e; a.leanDir = A.dir; a.lean.p = -0.1 * e;
        A.place({ x: from.x - A.dx * 8 * e, y: from.y - A.dy * 8 * e });
        a.rot = Math.sin(k * Math.PI * 2) * 0.06;
      }
    });
    steps.push({
      dur: 0.17, start() { from = A.pos; a.rot = 0; if (A.miss) natDodge(A, kind); },
      fn(k) { const e = ease.in(k), w = touchAt(A, R * 2.02); A.place({ x: lerp(from.x, w.x, e), y: lerp(from.y, w.y, e) }); a.squash = -0.16 * e; a.lean.p = 0.16; },
      end() {
        const at = edgeOf(A);
        const o = natResolve(A, kind, at, 1.4, (pp, c, e) => {
          b.react.retreat = { t: 0, dur: 0.3, dist: 30 * pp, dir: A.dir, sharp: true };
          fx.ring(c.x, c.y, e, { r: 8, life: 0.3, w: 6, grow: 60 * pp, hit: true });
          fx.dust(c.x, c.y + R * 0.3 * A.u, e, calm() ? 3 : 10, 0.9);
        });
        a.squash = 0.1; a.sx.v += 6; a.sy.v -= 4;
        if (o === "miss") { a.react.overrun = { t: 0, dir: A.dir }; a.react.stagger = { t: 0, amp: A.fumble ? 0.18 : 0.12, dir: A.dir }; }
        else { a.ox.v -= A.dx * 260; a.oy.v -= A.dy * 260; }
      }
    });
    steps.push({ dur: 0.2 }, recover(A, 0.4));
  } else if (kind === "bite") {
    // Укус: сжался — бросок — челюсти смыкаются на цели; крит — вцепился и треплет
    let out = null;
    steps.push({
      dur: 0.14, start() { from = A.pos; },
      fn(k) { a.squash = 0.14 * k; a.leanDir = A.dir; a.lean.p = -0.08 * k; A.place({ x: from.x - A.dx * 6 * k, y: from.y - A.dy * 6 * k }); }
    });
    steps.push({
      dur: 0.12, start() { from = A.pos; if (A.miss) natDodge(A, kind); },
      fn(k) { const e = ease.in(k), w = touchAt(A, R * 2.05); A.place({ x: lerp(from.x, w.x, e), y: lerp(from.y, w.y, e) }); a.squash = -0.14 * e; a.lean.p = 0.14; },
      end() {
        const at = edgeOf(A);
        jaws(A, at, A.miss);
        out = natResolve(A, kind, at, 1, (pp, c, e) => fx.blood(c.x, c.y, e, A.dir, Math.round(4 * pp), A));
      }
    });
    // Треплет: на крите — дёргает цель из стороны в сторону, держа зубами
    steps.push({
      dur: 0.36,
      fn(k) {
        if (out !== "hit" || !A.crit) return;
        const s = Math.sin(k * Math.PI * 4) * 9 * (1 - k), px = -A.dy, py = A.dx;
        b.ox.p = px * s; b.oy.p = py * s; a.ox.p = px * s * 0.6; a.oy.p = py * s * 0.6;
      },
      end() { if (out === "hit" && A.crit) { b.ox.p = b.oy.p = 0; a.ox.p = a.oy.p = 0; } }
    });
    steps.push(recover(A, 0.28));
  } else {
    // Когти: замах — бросок — взмах наискось, второй крест-накрест
    let out = null;
    steps.push({ dur: 0.12, fn(k) { a.squash = 0.12 * k; a.leanDir = A.dir; a.lean.p = -0.06 * k; } });
    for (const [i, tilt] of [[0, 0.55], [1, -0.55]]) {
      steps.push({
        dur: i ? 0.1 : 0.12, start() { from = A.pos; if (!i && A.miss) natDodge(A, kind); },
        fn(k) { const e = ease.in(k), w = touchAt(A, R * (i ? 2.15 : 2.1)); A.place({ x: lerp(from.x, w.x, e), y: lerp(from.y, w.y, e) }); a.squash = -0.1 * e; a.lean.p = 0.12; a.rot = (i ? -1 : 1) * 0.2 * e; },
        end() {
          const B = A.B, at = { x: B.x - A.dx * R * 0.25, y: B.y - A.dy * R * 0.25 }, c = A.sc(at), e = b.token.document.elevation;
          claws(A, at, A.dir + Math.PI / 2 + tilt, A.miss, A.glance);
          if (!i) out = natResolve(A, kind, at, 0.8, (pp, c2, e2) => fx.blood(c2.x, c2.y, e2, A.dir + tilt, Math.round(3 * pp), A));
          else if (out === "hit") { A.stop(0.05); b.react.white = 0.8; b.react.stagger = { t: 0, amp: 0.07, dir: A.dir, twist: -0.3 }; fx.blood(c.x, c.y, e, A.dir - tilt, 3, A); }
          else if (out === "glance") fx.sparks(c.x, c.y, e, A.dir + Math.PI, calm() ? 2 : 6);
        }
      });
    }
    steps.push({ dur: 0.1, fn() { a.rot = 0; } }, recover(A, 0.3));
  }
  A.seq(steps, () => { a.rot = 0; A.place(A.home); A.ax.v = A.ay.v = 0; a.squash = 0; a.lean.p = 0; });
}

/** Челюсти: раскрыты — смыкаются за первые 30% — держатся — тают; мимо — бледнее */
function jaws(A, at, air) {
  const u = A.u, c = A.sc(at), g = new PIXI.Graphics(), sc = Math.sqrt(A.a.z);
  g.position.set(c.x, c.y);
  g.rotation = A.dir + Math.PI / 2;
  fx.add(g, 0.5, k => {
    const close = Math.min(1, k / 0.3), open = (1 - ease.in(close)) * 13, al = (k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45) * (air ? 0.55 : 0.95);
    g.clear();
    for (const sgn of [-1, 1]) {
      const y0 = sgn * (open + 3), m = u * sc;
      g.lineStyle({ width: 3.5 * m, color: 0xfffaeb, alpha: al });
      g.moveTo(-16 * m, (y0 + sgn * 6) * m); g.quadraticCurveTo(0, (y0 - sgn * 2) * m, 16 * m, (y0 + sgn * 6) * m);
      g.lineStyle(0);
      for (let i = -2; i <= 2; i++) {
        const x = i * 6, y = y0 - sgn * 0.5 + sgn * Math.abs(i) * 1.2;
        g.beginFill(0xfffaeb, al);
        g.drawPolygon([(x - 2.4) * m, y * m, x * m, (y - sgn * 6) * m, (x + 2.4) * m, y * m]);
        g.endFill();
      }
    }
  }, { elevation: A.b.token.document.elevation });
}

/** Три разреза когтями: прорисовываются за первые 25%, затем тают */
function claws(A, at, ang, air, grey) {
  const u = A.u, c = A.sc(at), g = new PIXI.Graphics(), m = u * Math.sqrt(A.a.z);
  g.position.set(c.x, c.y);
  g.rotation = ang;
  const color = grey ? 0xd7dee6 : 0xfff8eb;
  fx.add(g, 0.45, k => {
    const draw = Math.min(1, k / 0.25), al = (k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55) * (air ? 0.45 : 0.95);
    g.clear();
    for (let i = -1; i <= 1; i++) {
      const L = 30 - Math.abs(i) * 5, y = i * 8;
      g.lineStyle({ width: (3.4 - Math.abs(i) * 0.6) * m, color, alpha: al, cap: "round" });
      g.moveTo(-L * m, (y - 3) * m); g.lineTo((-L + 2 * L * draw) * m, (y + 3 * (2 * draw - 1)) * m);
    }
  }, { elevation: A.b.token.document.elevation });
}
