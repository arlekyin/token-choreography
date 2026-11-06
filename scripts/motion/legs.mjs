/**
 * Части хода («ноги»): ходьба, полёт, прыжок, лазание, взлёт и посадка на месте.
 *
 * Каждая часть знает своё время: pre — подготовка на месте (присед, взлёт), dur — само движение по пути,
 * post — то, что видно уже после прихода (проскальзывание, посадка). Foundry двигает токен «по-настоящему»
 * за pre + dur, а post — только картинка. frame(vis, lt, dt) ставит внешний вид на момент lt от начала части.
 * Поведение перенесено из макета tools/mockups/token-anim (moveFluid, moveFly, moveJump, moveClimb).
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, ease, lerp, wrapAngle, trapezoid, FLY_ALT } from "../util.mjs";

/** Общая основа: путь, время, перевод доли пути во время (для длительностей Foundry) */
class Leg {
  aloft = false;
  pre = 0;
  dur = 0;
  post = 0;
  constructor(path) { this.path = path; }
  get length() { return this.pre + this.dur + this.post; }
  /** Доля пути к моменту tt движения (0…dur) */
  progress(tt) { return this.dur > 0 ? clamp(tt / this.dur) : 1; }
  /** Когда (от начала части) пройдена доля f пути — обратная к progress */
  timeAt(f) {
    if (f <= 0) return this.pre;
    if (f >= 1 || this.dur <= 0) return this.pre + this.dur;
    let a = 0, b = this.dur;
    for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (this.progress(m) < f) a = m; else b = m; }
    return this.pre + b;
  }
  /** Точка пути к моменту lt */
  posAt(lt) { return this.path.at(this.progress(lt - this.pre) * this.path.total); }
  frame() {}
  /** Видно ли эффекты этого токена текущему игроку */
  static seen(vis) { return vis.token.visible && vis.token.mesh?.visible; }
  static elev(vis) { return vis.token.document.elevation; }
}

/* ---------------- Ходьба ---------------- */

export class WalkLeg extends Leg {
  /**
   * @param {SmoothPath} path
   * @param {object} o  z — размер в клетках, u — px сцены на px макета, speed — множитель скорости,
   *                    crouch — присед перед стартом, prints/dust — следы и пыль (у плывущего нет)
   */
  constructor(path, { z, u, grid, speed = 1, crouch = true, prints = true, dust = true }) {
    super(path);
    this.z = z; this.u = u; this.prints = prints; this.dustOn = dust;
    const cells = path.total2 / grid;
    // Крейсерская скорость (px макета/с): на длинном пути быстрее; крупные тяжелее, мелкие семенят
    this.cruise = (470 + 40 * Math.min(6, cells)) * (z >= 2 ? 0.78 : z < 1 ? 1.25 : 1) * speed;
    this.dur = path.total / (this.cruise * u) + 0.2;
    this.ramp = Math.min(0.22, this.dur * 0.3);
    this.pre = crouch ? 0.08 : 0;
    this.post = 0.25;
    // Шаг — примерно клетка
    this.STRIDE = 92 * (z < 1 ? 0.45 : z >= 2 ? 0.8 + 0.25 * z : 1) * u;
    this.stride = 0; this.foot = 1; this.lastD = 0; this.prevDir = path.dir0; this.stopped = false;
  }

  progress(tt) { return trapezoid(tt, this.dur, this.ramp); }

  frame(vis, lt, dt) {
    const z = this.z, path = this.path;
    // Подготовка: присед и перенос веса назад
    if (lt < this.pre) {
      const k = lt / this.pre, s = Math.sin(k * Math.PI);
      vis.sy.p = 1 - 0.07 * s; vis.sx.p = 1 + 0.05 * s;
      vis.leanDir = this.prevDir; vis.lean.p = -0.05 * s;
      vis.path = path.at(0);
      return;
    }
    const tt = lt - this.pre;
    if (tt < this.dur) {
      const d = this.progress(tt) * path.total, pos = path.at(d);
      vis.path = pos;
      const step = Math.max(dt, 1e-4);
      const v = (pos.d2 - this.lastD) / step / this.u; // px макета/с
      this.lastD = pos.d2;
      // Крен внутрь поворота по угловой скорости
      const turn = wrapAngle(pos.dir - this.prevDir); this.prevDir = pos.dir;
      vis.bank = lerp(vis.bank, clamp(turn / step * 0.09, -0.3, 0.3), clamp(dt * 12));
      // Шаги — ритм по пройденному, а не по клеткам
      const spd = clamp(v / this.cruise);
      this.stride += v * this.u * dt;
      const ph = (this.stride / this.STRIDE) % 1, sw = Math.sin((this.stride / this.STRIDE) * Math.PI);
      vis.hop = (z < 1 ? 3 : z >= 3 ? 0.8 : 1.6) * Math.abs(Math.sin(ph * Math.PI)) * spd;
      vis.rot = z >= 2 ? sw * 0.03 * spd : 0;
      vis.sway = sw * 1.4 * spd;
      vis.sy.p = 1 + 0.008 * Math.sin(ph * Math.PI) * spd;
      vis.sx.p = 1 - 0.006 * Math.sin(ph * Math.PI) * spd;
      vis.leanDir = pos.dir; vis.lean.p = 0.09 * spd;
      if (this.stride >= this.STRIDE) {
        this.stride -= this.STRIDE; this.foot = -this.foot;
        this.#step(vis, pos);
      }
      return;
    }
    // Остановка: проскальзывание вперёд с перелётом, пыль из-под ног
    const pos = path.at(path.total);
    vis.path = pos;
    if (!this.stopped) {
      this.stopped = true;
      vis.hop = 0; vis.sway = 0; vis.bank = 0; vis.rot = 0;
      vis.ox.v += Math.cos(pos.dir) * 90; vis.oy.v += Math.sin(pos.dir) * 90;
      vis.sx.v -= 3; vis.sy.v += 2.2; vis.lean.v += 1.6;
      if (this.dustOn && Leg.seen(vis)) {
        const R = 44 * this.u;
        fx.dust(pos.x + Math.cos(pos.dir) * R * 0.3, pos.y + R * 0.6 * z, Leg.elev(vis), prefs.calm ? 1 : 5, 0.5);
      }
    }
  }

  #step(vis, pos) {
    if (!Leg.seen(vis)) return;
    const z = this.z, R = 44 * this.u, e = Leg.elev(vis);
    if (this.prints) fx.print(pos.x, pos.y, e, pos.dir, this.foot, z, vis);
    if (!this.dustOn) return;
    if (z >= 3) {
      // Огромные и громадные: тяжёлый шаг, земля дрожит
      fx.shake(1.2 * (z - 2));
      fx.dust(pos.x - Math.sin(pos.dir) * this.foot * R * z * 0.4, pos.y + R * z * 0.5, e, prefs.calm ? 2 : 5, 0.5 * z);
    }
    else if (!prefs.calm && Math.random() < 0.35) {
      fx.dust(pos.x - Math.cos(pos.dir) * R * 0.5 * z, pos.y + R * 0.6 * z, e, 1, 0.35 * Math.max(1, z));
    }
  }
}

/* ---------------- Полёт ---------------- */

export class FlyLeg extends Leg {
  aloft = true;
  constructor(path, { u, speed = 1 }) {
    super(path);
    this.u = u;
    this.cruise = 560 * speed;
    this.dur = path.total / (this.cruise * u) + 0.25;
    this.ramp = Math.min(0.3, this.dur * 0.35);
    this.beat = 0; this.lastD = 0; this.prevDir = path.dir0; this.ended = false;
  }

  progress(tt) { return trapezoid(tt, this.dur, this.ramp); }

  frame(vis, lt, dt) {
    const path = this.path;
    vis.aloft = true;
    if (lt >= this.dur) {
      vis.path = path.at(path.total);
      if (!this.ended) { this.ended = true; vis.bank = 0; vis.lean.p = 0; vis.sx.p = 1; vis.sy.p = 1; vis.alt = FLY_ALT; }
      return;
    }
    const d = this.progress(lt) * path.total, pos = path.at(d), step = Math.max(dt, 1e-4);
    const v = (pos.d2 - this.lastD) / step / this.u;
    this.lastD = pos.d2;
    vis.path = pos;
    // Крен в поворотах сильнее, чем у пешего
    const turn = wrapAngle(pos.dir - this.prevDir); this.prevDir = pos.dir;
    vis.bank = lerp(vis.bank, clamp(turn / step * 0.14, -0.45, 0.45), clamp(dt * 10));
    // Взмахи: на разгоне чаще и сильнее, в крейсере реже
    const spd = clamp(v / this.cruise);
    this.beat += dt * (2.4 + 1.6 * (1 - spd) * (lt < this.ramp ? 1 : 0.3));
    const ph = this.beat % 1, down = Math.max(0, Math.sin(ph * 6.283));
    vis.alt = FLY_ALT + Math.sin(ph * 6.283) * 5;
    vis.sx.p = 1 + 0.04 * down; vis.sy.p = 1 - 0.015 * down;
    vis.leanDir = pos.dir; vis.lean.p = 0.12 * spd;
    vis.hop = 0; vis.sway = 0; vis.rot = 0;
  }
}

/** Взлёт на месте: присед, тяжёлые взмахи, пыль кольцом */
export class TakeoffLeg extends Leg {
  aloft = true;
  constructor(path, { u, z }) {
    super(path);
    this.u = u; this.z = z;
    this.pre = 0.56;
    this.blast = false;
  }
  frame(vis, lt) {
    vis.path = this.path.at(0);
    vis.hop = 0;
    if (lt < 0.14) { vis.squash = 0.12 * (lt / 0.14); vis.alt = 0; return; }
    const k = clamp((lt - 0.14) / 0.42);
    vis.squash = k >= 1 ? 0 : -0.06 * (1 - k);
    vis.alt = FLY_ALT * ease.out(k) + Math.sin(k * Math.PI * 3) * 4 * (1 - k);
    vis.aloft = vis.alt > 6;
    if (!this.blast) {
      this.blast = true;
      if (Leg.seen(vis)) {
        const p = vis.path, R = 44 * this.u * this.z, e = Leg.elev(vis);
        fx.ring(p.x, p.y + R * 0.2, e, { r: 35 * this.z, life: 0.45, w: 4, grow: 70 * Math.max(1, this.z * 0.7) });
        fx.dust(p.x, p.y + R * 0.5, e, prefs.calm ? 3 : 12, Math.max(1, this.z * 0.7));
      }
    }
  }
}

/** Посадка на месте: взмахи реже, тень сходится с токеном, удар о землю, пыль кольцом */
export class LandLeg extends Leg {
  constructor(path, { u, z }) {
    super(path);
    this.u = u; this.z = z;
    this.pre = 0.38;
    this.post = 0.2;
    this.a0 = null; this.down = false;
  }
  frame(vis, lt) {
    vis.path = this.path.at(0);
    this.a0 ??= Math.max(vis.alt, FLY_ALT * 0.5);
    if (lt < this.pre) {
      vis.alt = this.a0 * (1 - ease.in(lt / this.pre));
      vis.aloft = vis.alt > 6;
      vis.bank *= 0.9; vis.lean.p *= 0.9;
      return;
    }
    vis.alt = 0; vis.aloft = false;
    if (!this.down) {
      this.down = true;
      vis.squash = 0.14;
      if (Leg.seen(vis)) {
        const p = vis.path, R = 44 * this.u * this.z, e = Leg.elev(vis);
        fx.dust(p.x, p.y + R * 0.5, e, prefs.calm ? 3 : 10, 0.9 * Math.max(1, this.z * 0.7));
        fx.ring(p.x, p.y + R * 0.2, e, { r: 31 * this.z, life: 0.35, w: 3, grow: 50 * Math.max(1, this.z * 0.7) });
      }
    }
    const r = lt - this.pre;
    vis.squash = r > 0.15 ? 0 : 0.14 * Math.max(0, 1 - r / 0.15);
  }
}

/* ---------------- Прыжок ---------------- */

export class JumpLeg extends Leg {
  /**
   * Одна высокая дуга через весь путь. Приземление тем тяжелее, чем длиннее прыжок и крупнее существо;
   * крошечные приземляются мягко. arc — доля высоты дуги (у падения дуги почти нет)
   */
  constructor(path, { z, u, crouch = true, arc = 1, speed = 1 }) {
    super(path);
    this.z = z; this.u = u;
    const D = path.total2 / u; // px макета
    this.D = D;
    this.dur = (0.32 + D / 900) / Math.max(0.5, speed);
    this.H = (22 + D * 0.14) * arc;
    this.pre = crouch ? 0.14 : 0;
    // Сила приземления
    const p = clamp(D / 300, 0.3, 1.4) * (z < 1 ? Math.pow(z, 1.8) : Math.pow(z, 1.2));
    this.p = p;
    this.sq = 0.14 + 0.14 * Math.min(p, 1.4);
    this.hold = 0.18 + 0.14 * Math.min(p, 2);
    this.post = this.hold + 0.08;
    this.jumped = false; this.landed = false;
  }

  progress(tt) { return this.dur > 0 ? ease.inOut(clamp(tt / this.dur)) : 1; }

  frame(vis, lt) {
    const path = this.path, dir = path.dir0;
    if (lt < this.pre) {
      const k = lt / this.pre;
      vis.squash = 0.16 * k; vis.leanDir = dir; vis.lean.p = -0.05 * k;
      vis.path = path.at(0);
      return;
    }
    const tt = lt - this.pre;
    if (tt < this.dur) {
      const k = clamp(tt / this.dur);
      if (!this.jumped) {
        this.jumped = true;
        vis.squash = -0.08;
        if (this.pre && Leg.seen(vis)) {
          const p0 = path.at(0), R = 44 * this.u;
          fx.dust(p0.x, p0.y + R * 0.5 * this.z, Leg.elev(vis), prefs.calm ? 1 : 4, 0.6);
        }
      }
      const pos = path.at(this.progress(tt) * path.total);
      vis.path = pos;
      vis.alt = this.H * Math.sin(k * Math.PI);
      vis.aloft = vis.alt > 6;
      vis.leanDir = pos.dir; vis.lean.p = 0.1 * (1 - k);
      return;
    }
    const to = path.at(path.total);
    vis.path = to;
    vis.alt = 0; vis.aloft = false;
    if (!this.landed) { this.landed = true; this.#land(vis, to); }
    const r = tt - this.dur;
    vis.squash = r > this.hold ? 0 : this.sq * Math.max(0, 1 - r / this.hold);
    vis.leanDir = to.dir;
    vis.lean.p = this.p > 0.6 ? 0.1 * Math.max(0, 1 - r / this.hold) : 0;
  }

  #land(vis, to) {
    const z = this.z, p = this.p, u = this.u, R = 44 * u, dir = to.dir;
    vis.squash = this.sq;
    vis.ox.v += Math.cos(dir) * 140 * Math.min(p, 1.4);
    vis.oy.v += Math.sin(dir) * 140 * Math.min(p, 1.4);
    if (!Leg.seen(vis)) return;
    const e = Leg.elev(vis), calm = prefs.calm;
    fx.dust(to.x, to.y + R * 0.5 * z, e, Math.round((calm ? 2 : 4) + 8 * Math.min(p, 3)), (0.5 + 0.5 * Math.min(p, 3)) * Math.max(0.6, z));
    if (p > 0.6) {
      fx.ring(to.x, to.y + R * 0.2 * z, e, {
        r: z >= 2 ? 45 * z : 31 * z, life: 0.35 + 0.1 * Math.min(p, 3), w: 3 + 3 * Math.min(p, 2),
        grow: (40 + 60 * Math.min(p, 2)) * Math.max(1, z * 0.7)
      });
      fx.shake(Math.min(14, 3 * p * p));
    }
    if (p > 0.9 && !calm) {
      fx.crack(to.x, to.y + R * 0.3, e, Math.max(1, z * 0.6));
      if (z >= 2) {
        const n = 2 + Math.floor(z);
        for (let i = 0; i < n; i++) {
          const an = i / n * 6.283 + 0.4;
          fx.crack(to.x + Math.cos(an) * R * z * 1.15, to.y + Math.sin(an) * R * z * 1.15, e);
        }
      }
    }
  }
}

/* ---------------- Лазание ---------------- */

export class ClimbLeg extends Leg {
  /** Медленно, рывками: перехват и подтягивание, токен покачивается из стороны в сторону, без пыли */
  constructor(path, { u, speed = 1 }) {
    super(path);
    this.u = u;
    this.PULL = 40 * u * Math.max(0.6, speed);
    this.TP = 0.22; this.TH = 0.12;
    const n = Math.max(1, Math.ceil(path.total / this.PULL));
    this.dur = n * (this.TP + this.TH) - this.TH;
  }

  progress(tt) {
    const cyc = tt % (this.TP + this.TH), n = Math.floor(tt / (this.TP + this.TH));
    const k = cyc < this.TP ? ease.inOut(cyc / this.TP) : 1;
    return this.path.total > 0 ? clamp((n * this.PULL + k * this.PULL) / this.path.total) : 1;
  }

  frame(vis, lt) {
    if (lt >= this.dur) {
      vis.path = this.path.at(this.path.total);
      vis.sway = 0; vis.lean.p = 0; vis.sy.p = 1;
      return;
    }
    const cyc = lt % (this.TP + this.TH), inPull = cyc < this.TP, n = Math.floor(lt / (this.TP + this.TH));
    const hand = n % 2 ? -1 : 1, k = inPull ? ease.inOut(cyc / this.TP) : 1;
    const pos = this.path.at(this.progress(lt) * this.path.total);
    vis.path = pos;
    vis.sway = hand * 3 * Math.sin(Math.min(1, cyc / this.TP) * Math.PI);
    vis.leanDir = pos.dir; vis.lean.p = inPull ? 0.06 : -0.02;
    vis.sy.p = 1 + (inPull ? 0.03 * Math.sin(k * Math.PI) : 0);
    vis.hop = 0;
  }
}

/* ---------------- Мгновенно (телепорт) ---------------- */

export class InstantLeg extends Leg {
  frame(vis) { vis.path = this.path.at(this.path.total); }
}
