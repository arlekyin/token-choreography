/**
 * Стряхнуть кровь с оружия, когда герой в бою долго ничего не делает (по умолчанию 5 минут). Оружие появляется
 * у руки на время жеста. Жест — по виду оружия:
 *  клинок      — неторопливо выносит клинок вперёд (кончик перед токеном), резкий возврат в покой; кровь слетает
 *                по инерции — назад и вбок от ведущей руки;
 *  дробящее    — навершие выносится вперёд, тяжёлый удар о землю, сгустки шлёпаются у навершия, пыль;
 *  древковое   — подтягивает оружие, стук древком о землю, наконечник дрожит, капли осыпаются вокруг.
 * Стряхивание снимает в первую очередь свежий слой крови.
 *
 * Жест идёт как атака токена (vis.act): в такт, с мелким шагом времени. Документы не меняются.
 */

import { director } from "../director.mjs";
import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, ease, lerp, wrapAngle } from "../util.mjs";
import { rigOf } from "../attack/kinds.mjs";
import { IDLE, WeaponRig, weaponTexture } from "../attack/weapon.mjs";
import { styleOf, shed, pickFluid } from "./blade.mjs";
import { spray, dropSize } from "./spray.mjs";
import { decals, seededRnd } from "./decals.mjs";

const LEAD = 0.3;   // оружие появляется у руки
const DUR = { blade: 1.5, blunt: 1.7, pole: 1.6 };

export class Flourish {
  /**
   * @param {import("../visual.mjs").TokenVisual} vis
   * @param {object} s     пятно оружия (blade.mjs)
   * @param {WeaponRig} rig
   */
  constructor(vis, s, rig) {
    this.a = vis; this.s = s; this.rig = rig;
    this.style = styleOf(s.kind);
    this.dur = DUR[this.style];
    this.t = -LEAD;
    this.r = seededRnd(`${vis.token.document.id}:${s.layers.map(x => x.amt.toFixed(3)).join()}`);
    this.arc = [];
    this.snapped = false; this.tinged = false;
    this.ended = false;
    this.lvl = s.gore;
    // Где клинок в покое относительно взгляда: оружие у ведущей руки, клинок вбок-назад
    rig.flick = 0; rig.push = 0;
    this.rel = wrapAngle(rig.grip().a - rig.face);
    this.fwd = 0.35 - this.rel;
  }

  get u() { return this.a.u; }
  get elev() { return this.a.token.document.elevation; }
  rnd(a, b) { return a + this.r() * (b - a); }

  /** Точка макета → сцена */
  sc(p) { return { x: p.x * this.u, y: p.y * this.u }; }

  update(dt) {
    if (this.ended) return false;
    this.t += dt;
    if (this.a.token.destroyed) { this.finish(); return false; }
    if (this.t < 0) return true;
    const k = clamp(this.t / this.dur);
    if (this.style === "blunt") this.#blunt(k);
    else if (this.style === "pole") this.#pole(k);
    else this.#blade(k);
    if (k >= 1) { this.finish(); return false; }
    return true;
  }

  /** Клинок: вперёд — пауза — резкий возврат с проскоком — дрожь */
  #blade(k) {
    const rig = this.rig, fwd = this.fwd, over = Math.sign(-fwd) * 0.12;
    const OUT = 0.45, WAIT = 0.52, SNAP = 0.56, SETTLE = 0.68;
    rig.flick = k < OUT ? fwd * ease.inOut(k / OUT)
      : k < WAIT ? fwd
      : k < SNAP ? lerp(fwd, over, ease.in((k - WAIT) / (SNAP - WAIT)))
      : k < SETTLE ? over * Math.cos((k - SNAP) / (SETTLE - SNAP) * Math.PI * 1.5) * (1 - (k - SNAP) / (SETTLE - SNAP))
      : 0;
    if (k >= WAIT && !this.snapped) this.arc.push(rig.tip());
    if (k >= SNAP && !this.snapped) {
      this.snapped = true;
      this.a.freeze = Math.max(this.a.freeze, prefs.calm ? 0.04 : 0.08);
      fx.shake(2);
      // Куда летит кровь: по ходу острия и наружу вдоль клинка — назад и вбок от руки
      const g = rig.grip(), tp = rig.tip(), last = this.arc.at(-2) ?? g;
      const tx = tp.x - last.x, ty = tp.y - last.y, tl = Math.hypot(tx, ty) || 1;
      const dx = tx / tl * 0.8 + Math.cos(g.a), dy = ty / tl * 0.8 + Math.sin(g.a), dir = Math.atan2(dy, dx);
      const n = Math.round((prefs.calm ? 8 : 14) + 16 * this.lvl);
      for (let i = 0; i < n; i++) {
        const along = Math.pow(this.r(), 0.5), v = lerp(60, 260, along) * this.rnd(0.8, 1.15), a = dir + this.rnd(-0.18, 0.18);
        spray.launch(lerp(g.x, tp.x, along), lerp(g.y, tp.y, along), this.elev, Math.cos(a) * v, Math.sin(a) * v, 12, this.rnd(50, 110),
          dropSize(this.r) * (0.45 + 0.5 * this.lvl) * (0.7 + 0.7 * along), pickFluid(this.s, this.r), this.r());
      }
      shed(this.s, 0.3);
    }
    if (k >= SETTLE && !this.tinged) { this.tinged = true; const p = this.sc(rig.tip()); fx.clash(p.x, p.y, this.elev); }
  }

  /** Дробящее: навершие вперёд и вверх — тяжёлый удар о землю — отскок — спокойный возврат */
  #blunt(k) {
    const rig = this.rig, fwd = this.fwd;
    const RAISE = 0.45, SLAM = 0.52, REB = 0.64;
    rig.flick = k < RAISE ? fwd * 0.55 * ease.inOut(k / RAISE) : k < REB ? fwd * 0.62 : fwd * 0.62 * (1 - ease.inOut((k - REB) / (1 - REB)));
    rig.push = k < RAISE ? -8 * ease.inOut(k / RAISE) : k < SLAM ? lerp(-8, 10, ease.in((k - RAISE) / (SLAM - RAISE)))
      : k < REB ? 10 - 4 * Math.sin((k - SLAM) / (REB - SLAM) * Math.PI) : 10 * (1 - ease.inOut((k - REB) / (1 - REB)));
    if (k >= SLAM && !this.snapped) {
      this.snapped = true;
      this.a.freeze = Math.max(this.a.freeze, prefs.calm ? 0.035 : 0.07);
      fx.shake(3);
      const tp = rig.tip();
      for (let i = 0, m = Math.round(3 + 4 * this.lvl); i < m; i++) {
        const a = this.rnd(0, 6.283), d = this.rnd(2, 14);
        decals.splat(tp.x + Math.cos(a) * d, tp.y + Math.sin(a) * d, this.elev, pickFluid(this.s, this.r), a, this.rnd(2, 4.5) * (0.6 + this.lvl), this.r, { alpha: 0.85, sats: 2, stretch: 1.1 });
      }
      const p = this.sc(tp);
      fx.dust(p.x, p.y, this.elev, prefs.calm ? 3 : 7, 0.8);
      fx.ring(p.x, p.y, this.elev, { r: 6, life: 0.25, w: 3, grow: 26 });
      shed(this.s, 0.45);
    }
  }

  /** Древковое: подтянуть — стук древком — наконечник дрожит, капли осыпаются вокруг */
  #pole(k) {
    const rig = this.rig, fwd = this.fwd;
    const LIFT = 0.4, STAMP = 0.46, SHIVER = 0.8;
    rig.push = k < LIFT ? -12 * ease.inOut(k / LIFT) : k < STAMP ? lerp(-12, 0, ease.in((k - LIFT) / (STAMP - LIFT))) : 0;
    rig.flick = k < STAMP ? fwd * 0.12 * ease.inOut(Math.min(1, k / LIFT))
      : k < SHIVER ? fwd * 0.12 * (1 - (k - STAMP) / (SHIVER - STAMP)) + 0.1 * Math.sin((k - STAMP) * this.dur * 55) * Math.pow(1 - (k - STAMP) / (SHIVER - STAMP), 2)
      : 0;
    if (k >= STAMP && !this.snapped) {
      this.snapped = true;
      this.a.freeze = Math.max(this.a.freeze, prefs.calm ? 0.025 : 0.05);
      fx.shake(1.5);
      const g = rig.grip(), tp = rig.tip();
      for (let i = 0, n = Math.round((prefs.calm ? 6 : 12) + 12 * this.lvl); i < n; i++) {
        const along = 0.7 + 0.3 * this.r(), a = this.rnd(0, 6.283), v = this.rnd(25, 85);
        spray.launch(lerp(g.x, tp.x, along), lerp(g.y, tp.y, along), this.elev, Math.cos(a) * v, Math.sin(a) * v, 14, this.rnd(20, 60),
          dropSize(this.r) * (0.45 + 0.5 * this.lvl), pickFluid(this.s, this.r), this.r());
      }
      const p = this.sc(tp);
      fx.clash(p.x, p.y, this.elev);
      shed(this.s, 0.5);
    }
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    this.rig.flick = 0; this.rig.push = 0;
    // Оружие было в руках (бой) — снова в руки, иначе убрать
    if (this.wasHeld) { this.rig.held = true; this.rig.k = 260; this.rig.to(IDLE, 260); }
    else this.rig.release();
    this.s.last = Date.now();
    this.s.flourishing = false;
  }

  cancel() { this.finish(); }
}

/** Начать жест у токена: оружие из пятна, взгляд — куда бил в последний раз */
export async function startFlourish(token, s) {
  const vis = token.choreo;
  // Оружие уже в руках (держит в бою) — жест делается им же
  const inHand = vis.rig?.held && !vis.rig.leaving && vis.rig.K?.kind === s.kind ? vis.rig : null;
  if (vis.act || vis.motion || (vis.rig && !inHand)) return false;
  s.flourishing = true;
  if (inHand) {
    inHand.held = false; inHand.k = 120;
    vis.act = new Flourish(vis, s, inHand);
    vis.act.wasHeld = true;
    director.wake(vis);
    return true;
  }
  try {
    const K = rigOf(s.kind), tex = await weaponTexture(K);
    if (vis.act || vis.rig || token.destroyed) { s.flourishing = false; return false; }
    const rig = new WeaponRig(vis, K, tex, { two: s.two, face: s.face });
    rig.k = 120;
    vis.rig = rig;
    vis.act = new Flourish(vis, s, rig);
    director.wake(vis);
    return true;
  } catch (err) {
    s.flourishing = false;
    console.error("token-choreography | стряхивание", err);
    return false;
  }
}
