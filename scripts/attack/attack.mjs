/**
 * Одна атака: кто (a) бьёт кого (b), исход броска и общий генератор случайности.
 *
 * Атака идёт в такте атакующего (TokenVisual.update → act.update). Положение атакующего — пружины ax/ay в пикселях
 * макета (как a.x в макете); из них каждый шаг ставится его сдвиг (shift) относительно места Foundry.
 * Документы токенов не меняются.
 */

import { director } from "../director.mjs";
import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, sp } from "../util.mjs";
import { R } from "./weapon.mjs";

export class Attack {
  /**
   * @param {TokenVisual} a  атакующий
   * @param {TokenVisual} b  цель
   * @param {object} o  result: hit|crit|glance|miss, fumble, rng, dodge
   */
  constructor(a, b, { result, fumble = false, rng }) {
    this.a = a; this.b = b;
    this.result = result;
    this.miss = result === "miss";
    this.crit = result === "crit";
    this.glance = result === "glance";
    this.fumble = fumble;
    this.rng = rng;
    this.time = 0;
    this.home = a.home;
    this.ax = sp(this.home.x); this.ay = sp(this.home.y);
    const B = b.home;
    this.dir = Math.atan2(B.y - this.home.y, B.x - this.home.x);
    this.dx = Math.cos(this.dir); this.dy = Math.sin(this.dir);
    this.task = null;
    this.laters = [];
    this.ended = false;
    this.onEnd = null;
  }

  get u() { return this.a.u; }
  /** Где цель (её место и толчки), px макета */
  get B() { return this.b.at; }
  /** Насколько дальше стоять от цели, чем двум средним (края больших — дальше от центра) */
  get gap() { return R * (this.a.z - 1) + R * (this.b.z - 1); }
  /** Сила удара по разнице размеров: великан отбрасывает человека, гоблин по великану — тот лишь вздрагивает */
  get sizeK() { return clamp(Math.pow(this.a.z / this.b.z, 0.75), 0.3, 2.8); }

  /** Начать: атакующий и цель — в такт */
  start() {
    this.a.act = this;
    director.wake(this.a); director.wake(this.b);
  }

  later(sec, fn) { this.laters.push({ at: this.time + sec, fn }); }

  /** Стоп-кадр удара: оба замирают */
  stop(sec) {
    const s = sec * (prefs.calm ? 0.5 : 1);
    this.a.freeze = Math.max(this.a.freeze, s);
    this.b.freeze = Math.max(this.b.freeze, s);
  }

  shake(amount) { if (!prefs.calm) fx.shake(amount); }

  /** Точка макета → сцена */
  sc(p) { const u = this.u; return { x: p.x * u, y: p.y * u }; }
  get elev() { return this.a.token.document.elevation; }

  /** Шаг атаки; false — кончилась */
  update(dt) {
    this.time += dt;
    director.wake(this.b);
    // Предохранитель: атака не дольше 8 с своего времени (токен перерисовали, цель пропала)
    if (this.time > 8 || this.b.token.destroyed) { this.task = null; this.laters = []; }
    if (this.task && this.task(dt) === false) this.task = null;
    const due = this.laters.filter(l => l.at <= this.time);
    if (due.length) { this.laters = this.laters.filter(l => l.at > this.time); for (const l of due) l.fn(); }
    const a = this.a, h = this.home;
    a.shift.x = this.ax.p - h.x; a.shift.y = this.ay.p - h.y;
    if (!this.task && !this.laters.length) { this.finish(); return false; }
    return true;
  }

  /** Конец: атакующий на месте, оружие убрано */
  finish() {
    if (this.ended) return;
    this.ended = true;
    const a = this.a;
    a.shift.x = a.shift.y = 0;
    a.squash = 0; a.lean.p = 0; a.low = 0; a.hop = 0; a.rot = 0; a.spin = 0; a.hide = 0;
    a.rig?.release(); a.rig2?.release();
    this.b.rig?.release(); this.b.shield?.release();
    this.onEnd?.();
  }

  /** Прервать (токен перерисован или убран): оба — сразу в покой */
  cancel() {
    this.task = null; this.laters = [];
    this.finish();
  }

  /** Шаги по очереди (seq макета): {dur, start(), fn(k, dt, t), end(), cut} */
  seq(steps, done) {
    let i = 0, t = 0;
    steps[0]?.start?.();
    this.task = dt => {
      t += dt;
      while (i < steps.length) {
        const S = steps[i];
        S.fn?.(clamp(t / S.dur), dt, t);
        if (t >= S.dur || S.cut) { S.end?.(); t = S.cut ? 0 : t - S.dur; i++; steps[i]?.start?.(); continue; }
        return true;
      }
      done?.();
      return false;
    };
  }

  /** Поставить атакующего в точку макета */
  place(p) { this.ax.p = p.x; this.ay.p = p.y; }
  get pos() { return { x: this.ax.p, y: this.ay.p }; }
}
