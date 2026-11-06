/**
 * Оружие в руке токена (как w в макете): картинка клинка на конце руки. Вид сверху: токен смотрит на врага (face),
 * правое плечо — справа от взгляда, рука от плеча под углом ha, клинок — по руке с поворотом кисти ba,
 * ext — насколько вытянута рука. Позы задаются целью, к которой тянутся пружины; жёсткость k — резкость движения.
 *
 * Оружие видно только в бою: появляется на замахе и уходит после удара. Рисуется над токенами, его тень — рядом.
 * Все величины — пиксели макета (клетка 100), на сцену — множителем u.
 */

import { fx } from "../fx/layer.mjs";
import { clamp, lerp, sp, spring, wrapAngle } from "../util.mjs";
import { SPRITES, spritePath } from "./kinds.mjs";
import { stainOf, bloodiedTexture } from "../gore/blade.mjs";
import { goreK } from "../gore/spray.mjs";

export const R = 44;
/** Куда падает свет (тени поднятого оружия) */
const LIGHT = 0.7;
export const SHOULDER = R * 0.55, ARM = R * 0.72;

/* ---------- Позы (из макета) ---------- */

export const ARMPOSE = {
  idle: { ha: 0.75, ba: 0.7, ext: 0 },
  wind: { ha: 2.25, ba: 0.35, ext: -2 },
  strike: { ha: -0.6, ba: -0.25, ext: 10 }
};
/** Тычок: замах — рука у бедра сзади, клинок вперёд; удар — рука выброшена вперёд и чуть внутрь */
export const ARMTHRUST = { wind: { ha: 2.5, ba: -2.5, ext: -6 }, strike: { ha: -0.3, ba: 0.18, ext: 16 } };
/** Двумя руками: рукоять у середины груди, дуга шире и тяжелее */
export const ARMPOSE2 = { wind: { ha: 2.6, ba: 0.45, ext: -2 }, strike: { ha: -1.25, ba: -0.35, ext: 12 } };
/** Двуручная секира: рубящий наискось (врубается в землю на промахе) и с кругом над головой */
export const GA_CLEAVE = { wind: { ha: 2.3, ba: 0.9, ext: -4 }, strike: { ha: -0.45, ba: -0.05, ext: 14 }, follow: { ha: -1.25, ba: -0.3, ext: 10 }, bury: true };
export const GA_OVER = { wind: { ha: 2.65, ba: 0.15, ext: -2 }, strike: { ha: 0.05, ba: -0.05, ext: 14 }, whirl: true, bury: true };
for (const [P, kind, sweep] of [[ARMPOSE, "slash", -1], [ARMPOSE2, "slash", -1], [ARMTHRUST, "thrust", 0],
  [GA_CLEAVE, "slash", -1], [GA_OVER, "chop", 0]]) Object.assign(P, { kind, sweep });

export const IDLE = ARMPOSE.idle;
/** Защита: рука перед собой, клинок поперёк; отбив — клинок резко наружу */
export const GUARD = { ha: 0.05, ba: -1.35, ext: 4 };
export const PUSH = { ha: 0.45, ba: -0.2, ext: 14 };

export class WeaponRig {
  /**
   * @param {import("../visual.mjs").TokenVisual} vis
   * @param {object} K     вид оружия (rigOf): src, len, grip, two
   * @param {PIXI.Texture} texture
   */
  constructor(vis, K, texture, { two = false, face = 0, left = false } = {}) {
    this.vis = vis;
    this.K = K;
    this.meta = SPRITES[K.src] ?? { w: texture.width, h: texture.height, haftX: 0.5 };
    this.two = !left && (two || !!K.two);
    /** Левая рука (второй кинжал): плечо слева, углы зеркальны, картинка зеркальна */
    this.left = left;
    this.flen = 1;        // видимая длина клинка (обратный хват — сверху короче)
    this.twist = 0; this.twistT = 0; // поворот вокруг рукояти: 0 — плашмя, 1 — ребром (проворот кинжала)
    this.pierce = false;  // клинок в цели — рисуется под токенами, остриё «уходит» в цель
    this.gone = false;    // оружие брошено — не рисуется
    this.phi = null;      // удар сверху: подъём в вертикальной плоскости взгляда (0 — вперёд у земли, π/2 — стоймя)
    this.gp = null;       // хват не у конца: доля высоты картинки (перехват на середину древка)
    this.flick = 0;       // доворот клинка (стряхивание крови), рад
    this.push = 0;        // сдвиг вдоль древка (стук древком), px макета
    this.ha = sp(IDLE.ha); this.ba = sp(IDLE.ba); this.ext = sp(0);
    this.T = { ...IDLE };
    this.k = 260;
    this.face = face;
    this.faceLock = face;
    this.sweep = -1;
    this.trail = [];
    this.lastTip = null;
    this.show = 0;        // видимость 0…1
    this.leaving = false; // убирается
    this.done = false;
    this.main = new PIXI.Sprite(texture);
    this.shadow = new PIXI.Sprite(texture);
    this.shadow.tint = 0x0a0e1e;
    this.trailGfx = new PIXI.Graphics();
    // Кровь на оружии — копия картинки с подтёками поверх неё (gore/blade.mjs)
    this.gore = new PIXI.Sprite(texture);
    this.baseTexture = texture;
    for (const s of [this.shadow, this.main, this.gore]) { s.eventMode = "none"; s.anchor.set(this.meta.haftX, K.grip); }
  }

  /** К позе с жёсткостью k */
  to(pose, k) { this.T = { ha: pose.ha, ba: pose.ba, ext: pose.ext }; if (k) this.k = k; }

  /** Убрать оружие (плавно) */
  release() { this.leaving = true; }

  /** Масштаб по высоте: подскок — больше, присед — меньше (heightScale макета) */
  get hs() {
    const v = this.vis, z = v.z;
    return z * (1 + (v.hop + v.alt) / (260 * z)) - 0.252 * v.duck - 0.05 * v.low;
  }

  /** Где рукоять и куда смотрит клинок, px макета */
  grip() {
    const v = this.vis, at = v.view ?? v.at, f = this.face + v.spin, hs = this.hs, s = this.left ? -1 : 1;
    if (this.phi != null) {
      // Сверху видна проекция: длина — |cos φ|, руки — от спины до вытянутых вперёд; поднятое — крупнее
      const up = Math.sin(this.phi), fwd = Math.cos(this.phi), reach = (ARM * 1.15 + this.ext.p) * (0.2 + 0.7 * fwd);
      const cx = at.x, cy = at.y - v.hop, sh = f + Math.PI / 2, S0 = SHOULDER * 0.25;
      return {
        x: cx + (Math.cos(f) * reach + Math.cos(sh) * S0) * hs,
        y: cy + (Math.sin(f) * reach + Math.sin(sh) * S0) * hs,
        a: fwd >= 0 ? f : f + Math.PI, hs: hs * (1 + 0.22 * up), fl: Math.max(0.12, Math.abs(fwd)), up
      };
    }
    const S0 = this.two ? SHOULDER * 0.25 : SHOULDER;
    const cx = at.x, cy = at.y - v.hop, sh = f + s * Math.PI / 2, aa = f + s * this.ha.p;
    const L = (this.two ? ARM * 1.15 : ARM) + this.ext.p, a = aa + s * this.ba.p + this.flick, push = this.push * hs;
    return {
      x: cx + (Math.cos(sh) * S0 + Math.cos(aa) * L) * hs + Math.cos(a) * push,
      y: cy + (Math.sin(sh) * S0 + Math.sin(aa) * L) * hs + Math.sin(a) * push,
      a, hs
    };
  }

  /** Кончик клинка, px макета */
  tip() {
    const g = this.grip(), L = this.K.len * (this.gp ?? this.K.grip) * g.hs * this.flen * (g.fl ?? 1);
    return { x: g.x + Math.cos(g.a) * L, y: g.y + Math.sin(g.a) * L };
  }

  /**
   * Поза руки, при которой клинок смотрит в точку цели (rpAim макета); off — сдвиг поперёк линии, в бок цели.
   * from — где атакующий (px макета), to — центр цели
   */
  aim(from, to, ha, ext, off = 0) {
    const f = this.faceLock, s = this.left ? -1 : 1, hs = this.hs, sh = f + s * Math.PI / 2, L = ARM + ext;
    const gx = from.x + (Math.cos(sh) * SHOULDER + Math.cos(f + s * ha) * L) * hs;
    const gy = from.y + (Math.sin(sh) * SHOULDER + Math.sin(f + s * ha) * L) * hs;
    const tx = to.x + Math.cos(f + Math.PI / 2) * off, ty = to.y + Math.sin(f + Math.PI / 2) * off;
    return { ha, ba: s * (Math.atan2(ty - gy, tx - gx) - f - s * ha), ext };
  }

  /** Середина клинка (там его встречает чужой клинок при парировании) */
  mid() {
    const g = this.grip(), L = this.K.len * this.K.grip * 0.45 * g.hs;
    return { x: g.x + Math.cos(g.a) * L, y: g.y + Math.sin(g.a) * L };
  }

  update(dt) {
    // Взгляд поворачивается плавно (короткий путь)
    this.face += wrapAngle(this.faceLock - this.face) * clamp(dt * 8);
    const zeta = 2 * Math.sqrt(this.k) * 0.8;
    spring(this.ha, this.T.ha, this.k, zeta, dt);
    spring(this.ba, this.T.ba, this.k, zeta, dt);
    spring(this.ext, this.T.ext, this.k, zeta, dt);
    this.twist += (this.twistT - this.twist) * clamp(dt * 12);
    this.show = this.leaving ? Math.max(0, this.show - dt / 0.18) : Math.min(1, this.show + dt / 0.1);
    if (this.leaving && this.show <= 0) this.done = true;
    // След кончика при быстром движении
    const tip = this.tip(), last = this.lastTip;
    this.lastTip = tip;
    if (last && dt > 0 && Math.hypot(tip.x - last.x, tip.y - last.y) / dt > 700) {
      if (!this.trail.length) this.trail.push({ ...last, age: 0 });
      this.trail.push({ ...tip, age: 0 });
    }
    for (const q of this.trail) q.age += dt;
    this.trail = this.trail.filter(q => q.age < 0.12).slice(-14);
  }

  /** Поставить картинки по текущей позе (после искажений токена) */
  render() {
    const v = this.vis, t = v.token, u = v.u;
    const seen = t.visible && t.mesh?.visible && this.show > 0.01 && !this.gone;
    // Клинок в цели — под токенами: остриё скрыто телом цели
    const parent = this.pierce || this.held ? fx.ground(t.document.elevation) : fx.over(t.document.elevation);
    // Кровь на этом оружии у этого токена
    const st = this.K.kind && goreK() > 0 ? stainOf(t.document.id, this.K.kind) : null;
    const bloody = st && st.gore > 0.02 ? bloodiedTexture(this.baseTexture, this.K.src, this.K.kind, st) : null;
    for (const d of [this.trailGfx, this.shadow, this.main, this.gore]) {
      if (!seen || (d === this.gore && !bloody)) { d.parent?.removeChild(d); continue; }
      if (d.parent !== parent) parent.addChild(d);
    }
    if (!seen) return;
    if (bloody && this.gore.texture !== bloody) this.gore.texture = bloody;
    const g = this.grip(), M = this.meta, k = this.K.len / M.h * g.hs * u, fl = (g.fl ?? 1) * this.flen, up = g.up ?? 0;
    // Ведущая сторона картинки: лезвие слева — зеркалим, когда удар идёт по часовой (и наоборот)
    const cw = this.sweep > 0, mirror = this.left ? -1 : (M.bladeLeft ? cw : (M.bladeRight && !cw)) ? -1 : 1;
    // Поворот вокруг рукояти: сверху лезвие сужается поперёк в cos угла раз
    const wx = Math.max(0.08, Math.cos(this.twist * Math.PI / 2));
    const gy = this.gp ?? this.K.grip;
    // Поднятое оружие: тень отходит дальше и вытягивается по свету, а не по ракурсу
    const lightA = g.a + wrapAngle(LIGHT - g.a) * up;
    for (const [s, ox, oy, alpha, sh] of [[this.shadow, 4 + 24 * up, 6 + 16 * up, 0.3 * (1 - 0.35 * up), true], [this.main, 0, 0, 1, false]]) {
      if (s.anchor.y !== gy) s.anchor.set(M.haftX, gy);
      s.position.set((g.x + ox) * u, (g.y + oy) * u);
      s.rotation = (sh ? lightA : g.a) + Math.PI / 2;
      s.scale.set(k * mirror * wx, k * (sh ? lerp(fl, 1, up) : fl));
      s.alpha = alpha * this.show;
    }
    if (bloody) {
      const s = this.gore, m = this.main;
      if (s.anchor.y !== m.anchor.y || s.anchor.x !== m.anchor.x) s.anchor.copyFrom(m.anchor);
      s.position.copyFrom(m.position); s.rotation = m.rotation; s.scale.copyFrom(m.scale); s.alpha = m.alpha;
    }
    // След: светлая полоса за кончиком
    const gfx = this.trailGfx, tr = this.trail;
    gfx.clear();
    for (let i = 1; i < tr.length; i++) {
      const q = tr[i], o = tr[i - 1], a = (1 - q.age / 0.12) * (i / tr.length);
      gfx.lineStyle({ width: (14 * a + 1) * u, color: 0xfff8e6, alpha: a * 0.6 * this.show, cap: "round" });
      gfx.moveTo(o.x * u, o.y * u); gfx.lineTo(q.x * u, q.y * u);
    }
  }

  destroy() {
    for (const d of [this.trailGfx, this.shadow, this.main, this.gore]) if (!d.destroyed) d.destroy();
  }
}

/** Загрузить картинку оружия (кэш Foundry) */
export async function weaponTexture(K) {
  return foundry.canvas.loadTexture(spritePath(K.src));
}
