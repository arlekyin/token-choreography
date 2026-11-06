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
import { Overlay, Reactions } from "./attack/react.mjs";
import { wounds } from "./gore/gore.mjs";

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
    // Бой
    this.shift = { x: 0, y: 0 }; // где токен в атаке относительно своего места, px макета (подход, отскок)
    this.duck = 0;         // присел (0…1): меньше и темнее
    this.low = 0;          // пригнулся, крадётся (0…1)
    this.spin = 0;         // поворот токена вместе с оружием (раскрутка секирой), рад
    this.hide = 0;         // почти не виден (стрелок в укрытии, призрак): 0…1
    this.freeze = 0;       // стоп-кадр удара, с
    this.act = null;       // идущая атака этого токена (он бьёт)
    this.rig = null;       // оружие в руке (WeaponRig), пока идёт атака или защита
    this.rig2 = null;      // второе оружие в левой руке (второй кинжал)
    this.shield = null;    // щит (ShieldRig); без оружия он же и rig
    this.view = null;      // где токен виден сейчас (центр меша без подскока), px макета: за ним идёт оружие
    this.faceAt = 0;       // когда в последний раз выбирали, куда смотрит оружие в руках
    this.react = new Reactions();
    this.flash = null;     // Overlay: белый/красный
    this.shade = null;     // Overlay: тень приседа
  }

  /** Центр токена на сцене в пикселях макета (без искажений) */
  get home() {
    const c = this.token.document.getCenterPoint(), u = this.u;
    return { x: c.x / u, y: c.y / u };
  }

  /** Где токен виден, px макета: своё место, сдвиг атаки и толчки (как a.x.p + a.ox.p в макете) */
  get at() {
    const h = this.home;
    return { x: h.x + this.shift.x + this.ox.p, y: h.y + this.shift.y + this.oy.p };
  }

  /** Атаке нужен мелкий шаг времени: жёсткие пружины оружия на 1/60 с разлетаются */
  get fine() {
    // Оружие в руках в покое (held) — мягкие пружины, обычного шага хватает
    return !!(this.act || this.rig2 || this.react.busy || (this.rig && !this.rig.held) || (this.shield && !this.shield.held));
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
    if (this.act || this.rig || this.rig2 || this.shield || this.react.busy || this.freeze > 0 || this.duck > 1e-3 || this.low > 1e-3
      || Math.abs(this.spin) > 1e-3 || this.hide > 1e-3 || Math.abs(this.shift.x) > 0.05 || Math.abs(this.shift.y) > 0.05) return true;
    const rest = s => Math.abs(s.v) < 1e-3;
    return Math.abs(this.sx.p - 1) > 1e-3 || Math.abs(this.sy.p - 1) > 1e-3 || Math.abs(this.lean.p) > 1e-3
      || Math.abs(this.ox.p) > 0.05 || Math.abs(this.oy.p) > 0.05 || !rest(this.sx) || !rest(this.sy)
      || !rest(this.ox) || !rest(this.oy) || this.squash !== 0 || Math.abs(this.bank) > 1e-3 || Math.abs(this.rot) > 1e-3
      || Math.abs(this.sway) > 0.05;
  }

  /** Шаг времени: ход, парение, пружины */
  update(dt, time) {
    // Стоп-кадр удара: оба участника замирают на миг
    if (this.freeze > 0) { this.freeze = Math.max(0, this.freeze - dt); return; }
    if (this.act && this.act.update(dt) === false) this.act = null;
    if (this.rig?.held || this.shield?.held) this.#holdFace(dt);
    this.rig?.update(dt);
    if (this.rig?.done) { if (this.shield === this.rig) this.shield = null; this.rig.destroy(); this.rig = null; }
    if (this.shield && this.shield !== this.rig) { this.shield.update(dt); if (this.shield.done) { this.shield.destroy(); this.shield = null; } }
    this.rig2?.update(dt);
    if (this.rig2?.done) { this.rig2.destroy(); this.rig2 = null; }
    const held = this.react.update(this, dt);
    // Состояние «Полёт» включили или сняли между ходами — взлёт или посадка на месте
    if (!this.motion && !this.act && this.token.document) {
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
    if (!held) {
      spring(this.ox, 0, 420, 20, dt);
      spring(this.oy, 0, 420, 20, dt);
    }
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
      sort: m.sort, alpha: m.alpha,
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
      m.alpha = b.alpha;
      if (m.sort !== b.sort) { m.sort = b.sort; canvas.primary.sortDirty = true; }
    }
    if (!t.destroyed) t.position.set(b.tx, b.ty);
    this.applied = false;
    wounds.follow(t);
  }

  /** Наложить свои искажения на меш и контейнер токена */
  apply() {
    const t = this.token, m = t.mesh, b = this.base;
    if (!m || m.destroyed || !b) return;
    const u = this.u, z = this.z;

    // Сдвиг: свой путь относительно логического положения Foundry, проскальзывание, перенос веса
    let dx = (this.ox.p + this.shift.x) * u, dy = (this.oy.p + this.shift.y) * u;
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
    // Присел или пригнулся — меньше (как heightScale в макете)
    const k = 1 + hz - 0.252 * this.duck - 0.05 * this.low;
    let M = rotation(this.rot + this.bank + this.spin);
    M = mul(M, [k, 0, 0, k]);
    const ld = this.leanDir, l = this.lean.p, ev = this.react.evSq;
    M = mul(M, mul(rotation(ld), mul([(1 + l) * (1 - 0.12 * ev), 0, 0, (1 - l * 0.5) * (1 + 0.06 * ev)], rotation(-ld))));
    M = mul(M, [this.sx.p, 0, 0, this.sy.p]);
    // Свой поворот и масштаб Foundry: R(rotation) · skew · S(scale)
    const B = pixiMatrix(b.rotation, b.skx, b.sky, b.sx, b.sy);
    const F = mul(M, B);
    setFromMatrix(m, F);
    m.position.set(b.x + dx, b.y + dy);
    this.view = { x: (b.x + dx) / u, y: (b.y + dy + this.hop * u * Math.sqrt(z)) / u };
    m.alpha = b.alpha * (1 - 0.55 * this.hide);
    // Летящий — слоем выше стоящих на той же высоте
    const sort = this.aloft ? b.sort + 1e7 : b.sort;
    if (m.sort !== sort) { m.sort = sort; canvas.primary.sortDirty = true; }
    // Рамка, полоски и имя идут вместе с токеном
    t.position.set(b.tx + dx, b.ty + dy);
    this.applied = true;
    this.#updateShadow(dx, dy);
    this.#updateOverlays(m);
    wounds.follow(t);
    this.rig?.render();
    this.rig2?.render();
    if (this.shield && this.shield !== this.rig) this.shield.render();
  }

  /**
   * Оружие в руках вне атаки смотрит на ближайшего соседа (сначала — на чужих), как в макете; раз в 0,3 с.
   * Никого рядом нет — туда, куда смотрел
   */
  #holdFace(dt) {
    this.faceAt -= dt;
    if (this.faceAt > 0) return;
    this.faceAt = 0.3;
    const me = this.token, c = me.document.getCenterPoint(), disp = me.document.disposition, far = (canvas.dimensions?.size ?? 100) * 8;
    let best = null, bestD = Infinity;
    for (const o of canvas.tokens?.placeables ?? []) {
      if (o === me || !o.visible || o.document.hidden) continue;
      const p = o.document.getCenterPoint(), d = Math.hypot(p.x - c.x, p.y - c.y) * (o.document.disposition === disp ? 2 : 1);
      if (d < bestD && d < far) { bestD = d; best = p; }
    }
    if (!best) return;
    const f = Math.atan2(best.y - c.y, best.x - c.x);
    for (const r of [this.rig, this.shield]) if (r?.held) r.faceLock = f;
  }

  /** Вспышки поверх меша: белым при ударе, красным — рана; тень, когда присел или пригнулся */
  #updateOverlays(m) {
    const r = this.react, seen = this.token.visible && m.visible;
    const dark = Math.max(0.42 * this.duck, 0.3 * this.low);
    if (seen && dark > 0.01) (this.shade ??= new Overlay(0x0a0e1e)).follow(m, dark, 0.2);
    else this.shade?.hide();
    // Сильнейший отлив: белая вспышка удара, краснота раны, яд/холод/оцепенение
    const white = Math.min(1, r.white), red = r.red * 0.4, glow = r.glow();
    let best = white > 0.01 && white >= red ? { color: 0xffffff, alpha: white } : red > 0.01 ? { color: 0xc01818, alpha: red } : null;
    if (glow && (!best || glow.alpha > best.alpha)) best = glow;
    if (seen && best) {
      this.flash ??= new Overlay(0xffffff);
      this.flash.setColor(best.color); this.flash.follow(m, best.alpha, 0.3);
    } else this.flash?.hide();
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

  /** Атака прервана (токен перерисован, сцена закрыта): всё боевое — сразу в покой */
  cancelCombat() {
    const act = this.act;
    this.act = null;
    act?.cancel();
    this.rig?.destroy(); this.rig = null;
    this.rig2?.destroy(); this.rig2 = null;
    if (this.shield && !this.shield.gfx.destroyed) this.shield.destroy();
    this.shield = null;
    this.react.clear(this);
    this.shift.x = this.shift.y = 0;
    this.spin = 0; this.hide = 0;
    this.freeze = 0;
    this.flash?.hide(); this.shade?.hide();
  }

  destroy() {
    this.restore();
    if (this.shadow && !this.shadow.destroyed) this.shadow.destroy();
    this.shadow = null;
    this.motion = null;
    this.cancelCombat();
    this.flash?.destroy(); this.shade?.destroy();
    this.flash = this.shade = null;
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
