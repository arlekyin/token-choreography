/**
 * Реакции токена в бою (как в кадре макета): уклон вбок, отскок, присед, отпрыгивание от ответного удара,
 * отступ от толчка, провал вперёд после промаха, оседание под тяжёлым ударом, шатание; вспышки белым и красным.
 *
 * Всё в пикселях макета и на TokenVisual: ox/oy — сдвиг, hop — подскок, duck/low — присел, rot — покачивание.
 * Вспышка — копия картинки токена, залитая цветом, ровно поверх меша (сам меш Foundry не трогается).
 */

import { clamp, ease } from "../util.mjs";
import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";

/** Состояние реакций одного токена */
export class Reactions {
  dodge = null;    // {kind: side|back|duck, dir, t, small}
  evade = null;    // {dir, t} — отпрыгивает от ответного удара
  retreat = null;  // {dir, dist, dur, t, sharp}
  overrun = null;  // {dir, t} — провалился вперёд
  sink = null;     // {t} — осел под тяжёлым ударом
  recoil = null;   // {t} — подпрыгнул от отбитого клинка
  stagger = null;  // {amp, dir, twist, t}
  numb = null;     // {t, dur} — оцепенел (удар в точку): мелкая дрожь, голубой отлив
  tint = null;     // {t, dur, color, a, fizz} — яд, кислота, холод: цветной отлив, шипит
  white = 0; red = 0; ringFlash = 0;
  evSq = 0;

  get busy() {
    return !!(this.dodge || this.evade || this.retreat || this.overrun || this.sink || this.recoil || this.stagger || this.numb || this.tint)
      || this.white > 0.01 || this.red > 0.01 || this.ringFlash > 0.01;
  }

  /**
   * Шаг реакций. Возвращает true, если сдвиг задан прямо (пружина сдвига в этот шаг не тянет).
   * @param {import("../visual.mjs").TokenVisual} t
   */
  update(t, dt) {
    let held = false;
    const D = this.dodge;
    if (D) {
      D.t += dt;
      const dur = D.kind === "back" ? 0.45 : D.kind === "duck" ? 0.55 : 0.34;
      const k = D.t < 0 ? 0 : Math.sin(clamp(D.t / dur) * Math.PI);
      if (D.kind === "duck") {
        // Присед: быстро вниз, держит, выпрямляется с небольшим перелётом
        t.duck = D.t < 0.1 ? ease.out(D.t / 0.1) : D.t < 0.38 ? 1 : 1 - ease.inOut(clamp((D.t - 0.38) / 0.17));
        t.ox.p = t.oy.p = 0;
        if (!D.dust && D.t > 0.06) {
          D.dust = 1;
          const c = t.token.document.getCenterPoint();
          fx.puff(c.x, c.y, t.token.document.elevation, 44 * 0.95 * t.u * t.z, prefs.calm ? 6 : 14);
        }
        if (D.t > 0.5 && !D.pop) { D.pop = 1; t.sy.v -= 4; t.sx.v += 3; }
      } else if (D.kind === "back") {
        const d = 34 * k;
        t.ox.p = Math.cos(D.dir) * d; t.oy.p = Math.sin(D.dir) * d;
        t.hop = 16 * Math.sin(clamp(D.t / (dur * 0.5)) * Math.PI) * (D.t < dur * 0.5 ? 1 : 0);
        t.leanDir = D.dir; t.lean.p = -0.06 * k;
      } else {
        const d = (D.small ? 14 : 26) * k;
        t.ox.p = Math.cos(D.dir) * d; t.oy.p = Math.sin(D.dir) * d;
        t.leanDir = D.dir; t.lean.p = 0.06 * k;
      }
      held = true;
      if (D.t > dur) { this.dodge = null; t.lean.p = 0; t.duck = 0; if (!t.act) t.hop = 0; }
    }
    this.white = Math.max(0, this.white - dt * 6);
    this.red = Math.max(0, this.red - dt * 1.8);
    this.ringFlash = Math.max(0, this.ringFlash - dt * 3);
    const O = this.overrun;
    if (O) {
      O.t += dt;
      if (O.t < 0.2) { t.ox.p += Math.cos(O.dir) * 160 * dt * (1 - O.t / 0.2); t.oy.p += Math.sin(O.dir) * 160 * dt * (1 - O.t / 0.2); }
      else this.overrun = null;
    }
    const S = this.sink;
    if (S) {
      S.t += dt;
      t.duck = 0.55 * Math.sin(clamp(S.t / 0.4) * Math.PI);
      if (S.t > 0.4) { this.sink = null; t.duck = 0; }
    }
    const E = this.evade;
    if (E) {
      // Отпрыгивает на полклетки: сдвиг задаётся прямо, чтобы пружина возврата не съела уход
      E.t += dt;
      const k = clamp(E.t / 0.32), arc = Math.sin(k * Math.PI);
      const back = 80 * Math.sin(Math.min(1, E.t / 0.2) * Math.PI / 2) * (1 - ease.inOut(clamp((E.t - 0.6) / 0.35)));
      t.ox.p = Math.cos(E.dir) * back; t.oy.p = Math.sin(E.dir) * back; t.ox.v = t.oy.v = 0;
      t.hop = 16 * arc; t.leanDir = E.dir + Math.PI; t.lean.p = -0.12 * arc;
      this.evSq = arc;
      held = true;
      if (E.t > 0.95) { this.evade = null; t.hop = 0; this.evSq = 0; t.lean.p = 0; }
    }
    const Rt = this.retreat;
    if (Rt) {
      Rt.t += dt;
      const k = clamp(Rt.t / Rt.dur);
      const back = (Rt.sharp ? 1 - Math.pow(1 - k, 3) : Math.sin(k * Math.PI * 0.5)) * Rt.dist * (1 - clamp((Rt.t - Rt.dur) / 0.5));
      t.ox.p = Math.cos(Rt.dir) * back + Math.sin(Rt.t * 13) * 2 * (1 - k); t.oy.p = Math.sin(Rt.dir) * back; t.ox.v = t.oy.v = 0;
      t.leanDir = Rt.dir; t.lean.p = -0.05 * (1 - k);
      held = true;
      if (Rt.t > Rt.dur + 0.5) { this.retreat = null; t.lean.p = 0; }
    }
    const Rc = this.recoil;
    if (Rc) {
      Rc.t += dt;
      t.hop = 16 * Math.sin(clamp(Rc.t / 0.3) * Math.PI);
      if (Rc.t > 0.3) { this.recoil = null; t.hop = 0; }
    }
    // Шатание после удара: затухающее покачивание и разворот по ходу клинка
    const St = this.stagger;
    if (St) {
      St.t += dt;
      t.rot = Math.sin(St.t * 22) * St.amp * Math.exp(-St.t * 5)
        + (St.twist ?? 0) * Math.sin(Math.min(1, St.t / 0.12) * Math.PI / 2) * Math.exp(-St.t * 3);
      if (St.t > 0.8) { this.stagger = null; t.rot = 0; }
    }
    const N = this.numb;
    if (N) {
      N.t += dt;
      this.stagger = null; t.rot = 0; t.ox.p = Math.sin(N.t * 90) * 0.7; held = true;
      if (N.t > N.dur) { this.numb = null; t.ox.p = 0; }
    }
    const Tn = this.tint;
    if (Tn) {
      Tn.t += dt;
      // Шипит: пузырьки поднимаются над целью
      if (Tn.fizz && Math.random() < dt * 15) {
        const c = t.token.document.getCenterPoint(), r = 44 * 0.7 * t.u * t.z;
        fx.dust(c.x + (Math.random() * 2 - 1) * r, c.y + (Math.random() * 2 - 1) * r, t.token.document.elevation, 1, 0.3);
      }
      if (Tn.t > Tn.dur) this.tint = null;
    }
    return held;
  }

  /** Цветной отлив сейчас: {color, alpha} или null */
  glow() {
    let best = null;
    const put = (color, alpha) => { if (alpha > 0.01 && (!best || alpha > best.alpha)) best = { color, alpha }; };
    if (this.numb) { const q = this.numb, k = Math.min(1, q.t / 0.08) * (1 - clamp((q.t - q.dur + 0.25) / 0.25)); put(0x9cc4ff, k * (0.32 + 0.1 * Math.sin(q.t * 18))); }
    if (this.tint) { const q = this.tint, k = Math.min(1, q.t / 0.1) * (1 - clamp((q.t - q.dur + 0.3) / 0.3)); put(q.color, k * (q.a ?? 0.4) * (0.8 + 0.2 * Math.sin(q.t * 14))); }
    return best;
  }

  clear(t) {
    this.dodge = this.evade = this.retreat = this.overrun = this.sink = this.recoil = this.stagger = this.numb = this.tint = null;
    this.white = this.red = this.ringFlash = this.evSq = 0;
    t.duck = 0; t.low = 0;
  }
}

/* ---------- Вспышка поверх токена ---------- */

const ColorMatrix = () => PIXI.ColorMatrixFilter ?? PIXI.filters.ColorMatrixFilter;

/** Копия картинки токена, залитая одним цветом (белый удар, красная рана, тень приседа) */
export class Overlay {
  constructor(color) {
    this.sprite = new PIXI.Sprite();
    this.sprite.eventMode = "none";
    const f = new (ColorMatrix())();
    const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
    // Цвет заливки при сохранённой прозрачности картинки
    f.matrix = [0, 0, 0, 0, r, 0, 0, 0, 0, g, 0, 0, 0, 0, b, 0, 0, 0, 1, 0];
    this.sprite.filters = [f];
    this.filter = f;
    this.color = color;
  }

  setColor(color) {
    if (color === this.color) return;
    this.color = color;
    const m = this.filter.matrix;
    m[4] = ((color >> 16) & 255) / 255; m[9] = ((color >> 8) & 255) / 255; m[14] = (color & 255) / 255;
    this.filter.matrix = m;
  }

  /** Встать ровно на меш токена (после наложения искажений) */
  follow(mesh, alpha, above) {
    const s = this.sprite;
    if (!mesh || mesh.destroyed || alpha <= 0.01 || !mesh.visible || !mesh.texture) { this.hide(); return; }
    if (s.parent !== canvas.primary) canvas.primary.addChild(s);
    if (s.texture !== mesh.texture) s.texture = mesh.texture;
    s.anchor.copyFrom(mesh.anchor);
    s.position.copyFrom(mesh.position);
    s.scale.copyFrom(mesh.scale);
    s.skew.copyFrom(mesh.skew);
    s.rotation = mesh.rotation;
    s.alpha = alpha * mesh.alpha;
    const sort = mesh.sort + above;
    if (s.elevation !== mesh.elevation || s.sort !== sort) {
      s.elevation = mesh.elevation;
      s.sortLayer = mesh.sortLayer;
      s.sort = sort;
      s.zIndex = mesh.zIndex;
      canvas.primary.sortDirty = true;
    }
    s.visible = true;
  }

  hide() {
    if (this.sprite.parent) this.sprite.parent.removeChild(this.sprite);
  }

  destroy() {
    this.hide();
    if (!this.sprite.destroyed) this.sprite.destroy();
  }
}
