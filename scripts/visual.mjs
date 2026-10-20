/**
 * Внешний вид токена поверх Foundry: сдвиг, подскок, высота полёта, сжатие, наклон, крен, тень.
 *
 * Токен Foundry не подменяется. Его меш и контейнер Foundry ставит как обычно (положение, размер, поворот —
 * из TokenDocument); после этого здесь к ним добавляются свои искажения, а перед следующим обновлением Foundry
 * они снимаются (restore), чтобы Foundry видела свои значения. Документ не меняется никогда.
 */

import { fx, MOCK_GRID } from "./fx/layer.mjs";
import { clamp, spring, sp, FLY_ALT } from "./util.mjs";
import { Motion } from "./motion/motion.mjs";
import { LandLeg, TakeoffLeg } from "./motion/legs.mjs";
import { SmoothPath } from "./motion/path.mjs";

export class TokenVisual {
  /** @param {Token} token */
  constructor(token) {
    this.token = token;
    this.phase = Math.random() * 6.283;
    // Пружины: масштаб по осям, наклон, сдвиг (проскальзывание)
    this.sx = sp(1); this.sy = sp(1); this.lean = sp(0); this.ox = sp(0); this.oy = sp(0);
    this.squash = 0;       // цель сжатия: + шире и ниже, − выше и уже
    this.leanT = 0;        // цель наклона вперёд
    this.leanDir = 0;      // куда наклон (рад)
    this.hop = 0;          // подскок, px макета (вверх по экрану)
    this.alt = 0;          // высота полёта, px макета (крупнее, тень отходит)
    this.bank = 0;         // крен в повороте, рад
    this.rot = 0;          // покачивание корпусом, рад
    this.sway = 0;         // перенос веса вбок, px макета
    this.path = null;      // {x, y} — где токен на своём пути (центр), когда идёт ход
    this.hover = false;    // в воздухе между ходами: состояние «Полёт»/«Парение» или способ хода «Полёт»
    this.keepAloft = false; // прошлый ход кончился в полёте — висит, пока не сменят способ хода
    this.aloft = false;    // сейчас в воздухе (для слоя и тени)
    this.motion = null;    // текущий ход (Motion)
    this.base = null;      // значения Foundry до искажений
    this.applied = false;
    this.shadow = null;
  }

  /** Размер существа в клетках: от размера токена, не от картинки */
  get z() {
    const d = this.token.document;
    return Math.max(0.25, Math.min(d.width, d.height));
  }

  get u() { return (canvas.dimensions?.size ?? MOCK_GRID) / MOCK_GRID; }

  /** Есть ли что показывать: ход, пружины не успокоились, парит */
  get busy() {
    if (this.motion || this.hover || this.keepAloft || this.alt > 0.05 || this.hop > 0.05) return true;
    const rest = s => Math.abs(s.v) < 1e-3;
    return Math.abs(this.sx.p - 1) > 1e-3 || Math.abs(this.sy.p - 1) > 1e-3 || Math.abs(this.lean.p) > 1e-3
      || Math.abs(this.ox.p) > 0.05 || Math.abs(this.oy.p) > 0.05 || !rest(this.sx) || !rest(this.sy)
      || !rest(this.ox) || !rest(this.oy) || this.squash !== 0 || Math.abs(this.bank) > 1e-3 || Math.abs(this.rot) > 1e-3
      || Math.abs(this.sway) > 0.05;
  }

  /** Шаг времени: ход, парение, пружины */
  update(dt, time) {
    // Состояние «Полёт» включили или сняли между ходами — взлёт или посадка на месте
    if (!this.motion && this.token.document) {
      if (this.hover && this.alt < FLY_ALT * 0.6) this.motion = this.#inPlace(TakeoffLeg);
      else if (!this.hover && !this.keepAloft && this.alt > 6) this.motion = this.#inPlace(LandLeg);
    }
    if (this.motion) {
      if (this.motion.update(this, dt) === false) this.motion = null;
    }
    else if (this.hover || this.keepAloft) {
      // Парение: покачивание и лёгкое «дыхание» взмахов
      this.alt = FLY_ALT + Math.sin(time * 2.4 + this.phase) * 3.5;
      this.sx.p = 1 + 0.015 * Math.max(0, Math.sin(time * 4.8 + this.phase));
      this.aloft = true;
    }
    else {
      this.alt = Math.max(0, this.alt - dt * 200);
      this.aloft = this.alt > 6;
    }
    const sq = this.squash;
    spring(this.sx, sq ? 1 + sq : 1, 500, 13, dt);
    spring(this.sy, sq ? 1 - sq * 0.8 : 1, 500, 13, dt);
    spring(this.lean, this.leanT, 300, 16, dt);
    spring(this.ox, 0, 420, 20, dt);
    spring(this.oy, 0, 420, 20, dt);
  }

  /** Взлёт или посадка там, где токен стоит */
  #inPlace(LegClass) {
    const c = this.token.document.getCenterPoint();
    return Motion.single(new LegClass(new SmoothPath([{ x: c.x, y: c.y }], 0), { u: this.u, z: this.z }));
  }

  /** Начать ход; если идёт прошлый — встать за ним в очередь */
  startMotion(motion) {
    if (this.motion) this.motion.append(motion);
    else this.motion = motion;
  }

  /** Ход прерван (остановка Foundry, перенос без анимации): сразу к настоящему положению */
  cancelMotion() {
    if (!this.motion) return;
    this.motion = null;
    this.path = null;
    this.hop = 0; this.sway = 0; this.bank = 0; this.rot = 0;
    const up = this.hover || this.keepAloft;
    this.alt = up ? FLY_ALT : 0;
    this.aloft = up;
  }

  /** Запомнить значения Foundry (после её обновления) */
  capture() {
    const t = this.token, m = t.mesh;
    if (!m || m.destroyed) { this.base = null; return; }
    this.base = {
      x: m.position.x, y: m.position.y,
      sx: m.scale.x, sy: m.scale.y,
      rotation: m.rotation, skx: m.skew.x, sky: m.skew.y,
      sort: m.sort,
      tx: t.position.x, ty: t.position.y
    };
  }

  /** Вернуть Foundry её значения */
  restore() {
    if (!this.applied || !this.base) { this.applied = false; return; }
    const t = this.token, m = t.mesh, b = this.base;
    if (m && !m.destroyed) {
      m.position.set(b.x, b.y);
      m.scale.set(b.sx, b.sy);
      m.rotation = b.rotation;
      m.skew.set(b.skx, b.sky);
      if (m.sort !== b.sort) { m.sort = b.sort; canvas.primary.sortDirty = true; }
    }
    if (!t.destroyed) t.position.set(b.tx, b.ty);
    this.applied = false;
  }

  /** Наложить свои искажения на меш и контейнер токена */
  apply() {
    const t = this.token, m = t.mesh, b = this.base;
    if (!m || m.destroyed || !b) return;
    const u = this.u, z = this.z;

    // Сдвиг: свой путь относительно логического положения Foundry, проскальзывание, перенос веса
    let dx = this.ox.p * u, dy = this.oy.p * u;
    if (this.path) {
      const c = t.document.getCenterPoint();
      dx += this.path.x - c.x;
      dy += this.path.y - c.y;
    }
    const swayPx = this.sway * u * z;
    dx += -Math.sin(this.leanDir) * swayPx;
    dy += Math.cos(this.leanDir) * swayPx - this.hop * u * Math.sqrt(z);

    // Матрица искажения в осях сцены: крен → рост от высоты → наклон вдоль движения → сжатие
    const hz = (this.hop + this.alt) / (260 * Math.sqrt(z));
    const k = 1 + hz;
    let M = rotation(this.rot + this.bank);
    M = mul(M, [k, 0, 0, k]);
    const ld = this.leanDir, l = this.lean.p;
    M = mul(M, mul(rotation(ld), mul([1 + l, 0, 0, 1 - l * 0.5], rotation(-ld))));
    M = mul(M, [this.sx.p, 0, 0, this.sy.p]);
    // Свой поворот и масштаб Foundry: R(rotation) · skew · S(scale)
    const B = pixiMatrix(b.rotation, b.skx, b.sky, b.sx, b.sy);
    const F = mul(M, B);
    setFromMatrix(m, F);
    m.position.set(b.x + dx, b.y + dy);
    // Летящий — слоем выше стоящих на той же высоте
    const sort = this.aloft ? b.sort + 1e7 : b.sort;
    if (m.sort !== sort) { m.sort = sort; canvas.primary.sortDirty = true; }
    // Рамка, полоски и имя идут вместе с токеном
    t.position.set(b.tx + dx, b.ty + dy);
    this.applied = true;
    this.#updateShadow(dx, dy);
  }

  /** Тень летящего и прыгающего: на земле, отходит по свету, бледнеет и сжимается с высотой */
  #updateShadow(dx, dy) {
    const t = this.token, u = this.u, z = this.z, alt = this.alt + this.hop;
    // Подскок шага (до 3 px) тени не даёт — только прыжок и полёт
    const show = alt > 3 && t.visible && t.mesh?.visible;
    if (!show) { this.#dropShadow(); return; }
    const d = t.document, ground = Math.min(d.elevation, canvas.level?.elevation?.bottom ?? d.elevation);
    if (!this.shadow || this.shadow.destroyed) this.shadow = fx.makeShadow();
    const parent = fx.ground(ground);
    if (this.shadow.parent !== parent) parent.addChild(this.shadow);
    const c = d.getCenterPoint(), R = 44 * u * z;
    const sh = clamp(1 - this.hop / (140 * z) - this.alt / 220, 0.45, 1);
    // В воздухе тень отходит вниз-вправо (свет сверху-слева); у прыжка остаётся почти под токеном
    const away = this.alt * Math.sqrt(z);
    this.shadow.position.set(
      c.x + dx + (5 * z + away * 0.85) * u,
      c.y + dy + this.hop * u * Math.sqrt(z) + (8 * z + away * 0.75) * u
    );
    this.shadow.width = 2.2 * R * sh;
    this.shadow.height = 2.2 * R * 0.9 * sh;
    this.shadow.alpha = 0.35 * clamp(alt / 10, 0, 1) * clamp(1 - this.hop / 140, 0.4, 1);
  }

  #dropShadow() {
    if (this.shadow && !this.shadow.destroyed) this.shadow.parent?.removeChild(this.shadow);
  }

  destroy() {
    this.restore();
    if (this.shadow && !this.shadow.destroyed) this.shadow.destroy();
    this.shadow = null;
    this.motion = null;
  }
}

/* ---------- Матрицы 2×2: [a, b, c, d] — x' = a·x + c·y, y' = b·x + d·y (как у PIXI) ---------- */

const rotation = r => [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r)];
function mul(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3]
  ];
}
function pixiMatrix(r, kx, ky, sx, sy) {
  return [Math.cos(r + ky) * sx, Math.sin(r + ky) * sx, -Math.sin(r - kx) * sy, Math.cos(r - kx) * sy];
}
/** Разложить матрицу в масштаб и скос PIXI при нулевом повороте */
function setFromMatrix(obj, [a, b, c, d]) {
  obj.rotation = 0;
  obj.scale.set(Math.hypot(a, b), Math.hypot(c, d));
  obj.skew.set(Math.atan2(c, d), Math.atan2(b, a));
}
