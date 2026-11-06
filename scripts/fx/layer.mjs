/**
 * Свой слой эффектов на земле: следы, пыль, кольца, трещины и тени летящих.
 *
 * Слой — несколько контейнеров в основной группе холста (canvas.primary), по одному на высоту: эффект лежит на
 * той же высоте, что и токен (на балконе — на балконе), и сортируется сразу под токенами (TOKENS − 1). Так тень
 * летящего ложится под всеми стоящими, а туман войны и зрение закрывают эффекты так же, как сами токены.
 * Токены Foundry слой не трогает.
 */

import { prefs } from "../settings.mjs";
import { rnd } from "../util.mjs";
import { spray, goreK } from "../gore/spray.mjs";
import { decals } from "../gore/decals.mjs";

/** Размер клетки макета: все величины эффектов заданы в пикселях макета (клетка 100) */
export const MOCK_GRID = 100;

class FxLayer {
  /** @type {Map<number, PIXI.Container>} */
  #grounds = new Map();
  #tex = null;
  #dust = [];
  #prints = [];
  #rings = [];
  #cracks = [];
  /** Прочие короткие эффекты боя: {display, age, life, step(k, dt, e)} */
  #misc = [];
  #shake = 0;
  #shakeOffset = { x: 0, y: 0 };
  active = false;

  /** Множитель от пикселей макета к пикселям сцены */
  get u() { return (canvas.dimensions?.size ?? MOCK_GRID) / MOCK_GRID; }

  attach() {
    this.detach();
    this.#tex ??= makeTextures();
    this.active = true;
  }

  detach() {
    for (const c of this.#grounds.values()) if (!c.destroyed) c.destroy({ children: true });
    this.#grounds.clear();
    this.#dust = []; this.#prints = []; this.#rings = []; this.#cracks = []; this.#misc = [];
    this.#restoreShake();
    this.#shake = 0;
    this.active = false;
  }

  /** Контейнер земли на высоте elevation (создаётся по требованию) */
  ground(elevation = 0) { return this.#layer(elevation, -1); }

  /** Контейнер над токенами на высоте elevation: вспышки ударов, искры, оружие в руке */
  over(elevation = 0) { return this.#layer(elevation, 50); }

  #layer(elevation, shift) {
    const e = Math.round((elevation || 0) * 100) / 100, key = `${e}:${shift}`;
    let c = this.#grounds.get(key);
    if (c && !c.destroyed) return c;
    c = new PIXI.Container();
    c.eventMode = "none";
    c.elevation = e;
    c.sortLayer = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS.TOKENS + shift;
    c.sort = 0;
    c.zIndex = 0;
    canvas.primary.addChild(c);
    canvas.primary.sortDirty = true;
    this.#grounds.set(key, c);
    return c;
  }

  /** Спрайт тени (им управляет сам токен) */
  makeShadow() {
    const s = new PIXI.Sprite(this.#tex.shadow);
    s.anchor.set(0.5);
    s.eventMode = "none";
    s.tint = 0x0a0e1e;
    return s;
  }

  /** Облачко пыли: n частиц, r — сила разлёта (как в макете) */
  dust(x, y, elevation, n, r = 1) {
    if (!this.active || n <= 0) return;
    const u = this.u, g = this.ground(elevation);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.283), s = rnd(20, 70) * r * u;
      const sprite = new PIXI.Sprite(this.#tex.dot);
      sprite.anchor.set(0.5);
      sprite.tint = 0xaa9678;
      sprite.position.set(x, y);
      g.addChild(sprite);
      this.#dust.push({ sprite, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.5, life: rnd(0.4, 0.7), age: 0, size: rnd(6, 12) * r * u });
    }
  }

  /** Расходящееся кольцо: пыль (взлёт, посадка) — на земле; удар — светлое, над токенами */
  ring(x, y, elevation, { r = 30, life = 0.4, w = 4, grow = 60, hit = false } = {}) {
    if (!this.active) return;
    const u = this.u, gfx = new PIXI.Graphics();
    gfx.position.set(x, y);
    (hit ? this.over(elevation) : this.ground(elevation)).addChild(gfx);
    this.#rings.push({ gfx, r: r * u, life, w: w * u, grow: grow * u, age: 0, color: hit ? 0xfff4dc : 0xd2c3a0, alpha: hit ? 0.75 : 0.55 });
  }

  /**
   * Кровь у точки удара (px сцены): n — сколько, A — атака (её A.gore: вид раны, доля ПЗ, жидкость, зерно).
   * Брызги, пятна, лужи — gore/spray.mjs и gore/decals.mjs
   */
  blood(x, y, elevation, dir, n, A) {
    spray.blood(x, y, elevation, dir, n, A);
  }

  /** Искры: n чёрточек разлетаются от точки встречи металла */
  sparks(x, y, elevation, dir, n) {
    if (!this.active || n <= 0) return;
    const u = this.u, gfx = new PIXI.Graphics(), list = [];
    for (let i = 0; i < n; i++) {
      const a = dir + rnd(-1.1, 1.1), v = rnd(180, 480);
      list.push({ x: 0, y: 0, vx: Math.cos(a) * v * u, vy: Math.sin(a) * v * u, life: rnd(0.12, 0.28) });
    }
    gfx.position.set(x, y);
    this.over(elevation).addChild(gfx);
    this.#misc.push({ display: gfx, age: 0, life: 0.3, step: (k, dt, e) => {
      gfx.clear();
      for (const p of list) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        const q = e.age / p.life;
        if (q >= 1) continue;
        gfx.lineStyle({ width: (2.2 * (1 - q) + 0.5) * u, color: 0xffecaa, alpha: 1 - q });
        gfx.moveTo(p.x, p.y); gfx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      }
    } });
  }

  /** Метка удара: короткий светлый клин по направлению удара */
  mark(x, y, elevation, dir, crit) {
    if (!this.active) return;
    const u = this.u, gfx = new PIXI.Graphics();
    gfx.position.set(x, y);
    gfx.rotation = dir;
    this.over(elevation).addChild(gfx);
    this.#misc.push({ display: gfx, age: 0, life: 0.22, step: k => {
      const L = (crit ? 70 : 46) * (0.6 + k * 0.6) * u, w = (crit ? 10 : 6) * (1 - k) * u;
      gfx.clear();
      gfx.beginFill(crit ? 0xffd27a : 0xfff6e0, 1 - k);
      gfx.drawPolygon([-L * 0.3, 0, L * 0.5, -w, L, 0, L * 0.5, w]);
      gfx.endFill();
    } });
  }

  /** Звон клинка о клинок: короткая звезда из четырёх линий */
  clash(x, y, elevation) {
    if (!this.active) return;
    const u = this.u, gfx = new PIXI.Graphics();
    gfx.position.set(x, y);
    this.over(elevation).addChild(gfx);
    this.#misc.push({ display: gfx, age: 0, life: 0.2, step: k => {
      gfx.clear();
      gfx.lineStyle({ width: 3 * u, color: 0xfff3c8, alpha: 1 - k });
      const L = (14 + 26 * (1 - Math.pow(1 - k, 3))) * u;
      for (let i = 0; i < 4; i++) {
        const an = i * Math.PI / 4 + 0.3;
        gfx.moveTo(-Math.cos(an) * L, -Math.sin(an) * L); gfx.lineTo(Math.cos(an) * L, Math.sin(an) * L);
      }
    } });
  }

  /** Росчерк промаха (без оружия): дуга воздуха перед атакующим */
  whiff(x, y, elevation, dir) {
    if (!this.active) return;
    const u = this.u, gfx = new PIXI.Graphics();
    gfx.position.set(x - Math.cos(dir) * 30 * u, y - Math.sin(dir) * 30 * u);
    this.over(elevation).addChild(gfx);
    this.#misc.push({ display: gfx, age: 0, life: 0.25, step: k => {
      const a0 = dir - 0.9 + k * 0.3, a1 = dir + 0.9 + k * 0.3, r = 46 * u;
      gfx.clear();
      gfx.lineStyle({ width: 3 * u, color: 0xfffaeb, alpha: (1 - k) * 0.7, cap: "round" });
      gfx.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
      gfx.arc(0, 0, r, a0, a1);
    } });
  }

  /** Облачко пыли кольцом вокруг (присел под удар) */
  puff(x, y, elevation, radius, n) {
    if (!this.active || n <= 0) return;
    const u = this.u, g = this.ground(elevation);
    for (let i = 0; i < n; i++) {
      const an = (i / n) * 6.283 + rnd(-0.2, 0.2), v = rnd(60, 110) * u;
      const s = new PIXI.Sprite(this.#tex.dot);
      s.anchor.set(0.5); s.tint = 0xcdbe9b;
      s.position.set(x + Math.cos(an) * radius, y + Math.sin(an) * radius);
      g.addChild(s);
      const size = rnd(9, 15) * u, vx = Math.cos(an) * v, vy = Math.sin(an) * v;
      this.#misc.push({ display: s, age: 0, life: rnd(0.45, 0.7), step: (k, dt) => {
        s.x += vx * dt * (1 - k); s.y += vy * dt * (1 - k);
        s.width = s.height = size * (0.7 + k * 0.8) * 2;
        s.alpha = (1 - k) * 0.55;
      } });
    }
  }

  /** Клубы дыма (чёрный порох): n клубов уходят по dir, растут и тают; size, spd — в px макета */
  smoke(x, y, elevation, dir, n, spd, size, life) {
    if (!this.active || n <= 0) return;
    const u = this.u, g = this.over(elevation);
    for (let i = 0; i < n; i++) {
      const a = dir + rnd(-0.35, 0.35), v = spd * rnd(0.4, 1.2) * u, s = new PIXI.Sprite(this.#tex.dot);
      const shade = rnd(0.82, 0.95), c = Math.round(205 * shade);
      s.anchor.set(0.5); s.tint = (c << 16) | (c << 8) | (c - 5);
      s.position.set(x + rnd(-3, 3) * u, y + rnd(-3, 3) * u);
      g.addChild(s);
      const q = { vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: size * rnd(0.6, 1) * u, grow: size * rnd(1.2, 2.2) * u, life: life * rnd(0.8, 1.2) };
      this.#misc.push({ display: s, age: 0, life: q.life, step: (k, dt) => {
        s.x += q.vx * dt; s.y += q.vy * dt;
        q.vx *= Math.pow(0.08, dt); q.vy = q.vy * Math.pow(0.08, dt) - 6 * u * dt;
        q.r += q.grow * dt * (1 - k);
        s.width = s.height = q.r * 2;
        s.alpha = (k < 0.06 ? k / 0.06 : 1 - (k - 0.06) / 0.94) * 0.62;
      } });
    }
  }

  /** Мягкий свет (вспышка выстрела на земле): радиус r px макета, гаснет за life */
  glow(x, y, elevation, r, life, color = 0xffc86e, alpha = 0.45) {
    if (!this.active) return;
    const s = new PIXI.Sprite(this.#tex.dot);
    s.anchor.set(0.5); s.tint = color; s.position.set(x, y);
    s.width = s.height = r * 2 * this.u;
    s.blendMode = PIXI.BLEND_MODES.ADD;
    this.over(elevation).addChild(s);
    this.#misc.push({ display: s, age: 0, life, step: k => { s.alpha = alpha * (1 - k); } });
  }

  /** Свой короткий эффект с кадром step(k, dt, e): челюсти, когти и т.п. */
  add(display, life, step, { over = true, elevation = 0 } = {}) {
    if (!this.active) { display.destroy(); return; }
    (over ? this.over(elevation) : this.ground(elevation)).addChild(display);
    this.#misc.push({ display, age: 0, life, step });
  }

  /** Снаряд (общий выстрел, пока у стрелкового оружия нет своей анимации); glob — комок плевка по дуге */
  projectile(from, to, elevation, { speed = 1400, glob = false, onArrive } = {}) {
    if (!this.active) { onArrive?.(); return; }
    const u = this.u, gfx = new PIXI.Graphics(), dir = Math.atan2(to.y - from.y, to.x - from.x);
    const dur = Math.max(0.08, Math.hypot(to.x - from.x, to.y - from.y) / (speed * u));
    gfx.rotation = dir;
    if (glob) {
      gfx.lineStyle({ width: 1.5 * u, color: 0x4c5e12 }); gfx.beginFill(0xb8d23a);
      gfx.drawEllipse(0, 0, 8 * u, 6 * u); gfx.endFill();
    } else {
      gfx.lineStyle({ width: 2 * u, color: 0xffffff, alpha: 0.25 }); gfx.moveTo(-90 * u, 0); gfx.lineTo(-36 * u, 0);
      gfx.lineStyle({ width: 3 * u, color: 0xe8dcc0 }); gfx.moveTo(-34 * u, 0); gfx.lineTo(0, 0);
      gfx.lineStyle(0); gfx.beginFill(0xcfd3d6); gfx.drawPolygon([4 * u, 0, -6 * u, -4 * u, -6 * u, 4 * u]); gfx.endFill();
    }
    gfx.position.set(from.x, from.y);
    this.over(elevation).addChild(gfx);
    let arrived = false;
    this.#misc.push({ display: gfx, age: 0, life: dur + 0.25, step: (k, dt, e) => {
      const q = Math.min(1, e.age / dur), h = glob ? Math.sin(q * Math.PI) * 40 * u : 0;
      gfx.position.set(from.x + (to.x - from.x) * q, from.y + (to.y - from.y) * q - h);
      if (q >= 1 && !arrived) { arrived = true; onArrive?.(); }
      if (q >= 1) gfx.alpha = Math.max(0, 1 - (e.age - dur) / 0.25);
    } });
  }

  /**
   * След ноги: dir — направление шага, side — левая/правая (±1), z — размер существа в клетках, vis — кто идёт.
   * Прошёл через лужу — несколько шагов кровавых следов (цвета лужи, что сверху): они остаются на земле
   */
  print(x, y, elevation, dir, side, z = 1, vis = null) {
    if (!this.active) return;
    const u = this.u, nx = -Math.sin(dir), ny = Math.cos(dir), off = 14 * u * Math.max(0.5, z);
    if (vis && goreK() > 0) {
      const wade = decals.poolAt(x / u, y / u, 22 * Math.max(0.5, z));
      if (wade) { vis.bloodySteps = 7; vis.stepFluid = wade.fl; }
      if (vis.bloodySteps > 0) {
        vis.bloodySteps--;
        decals.print((x + nx * side * off) / u, (y + ny * side * off) / u, elevation, dir, Math.max(0.5, z), vis.bloodySteps / 7, vis.stepFluid);
        return;
      }
    }
    if (!prefs.footprints) return;
    const s = new PIXI.Sprite(this.#tex.print);
    s.anchor.set(0.5);
    s.tint = 0x1e1810;
    s.position.set(x + nx * side * off, y + ny * side * off);
    s.rotation = dir;
    // В текстуре овал 32×18 — вдвое крупнее следа макета
    s.scale.set(0.5 * z * u, 0.5 * z * u);
    this.ground(elevation).addChild(s);
    this.#prints.push({ sprite: s, age: 0, life: 3 });
  }

  /** Трещины в земле от тяжёлого удара; гаснут через несколько секунд */
  crack(x, y, elevation, scale = 1) {
    if (!this.active) return;
    const u = this.u * scale, gfx = new PIXI.Graphics();
    for (let i = 0; i < 6; i++) {
      let ang = rnd(0, 6.283), px = 0, py = 0;
      gfx.lineStyle({ width: rnd(1.5, 3) * u, color: 0x1e160e, alpha: 0.6, cap: "round" });
      gfx.moveTo(px, py);
      for (let j = 0; j < 4; j++) {
        ang += rnd(-0.5, 0.5); px += Math.cos(ang) * 16 * u; py += Math.sin(ang) * 16 * u;
        gfx.lineTo(px, py);
      }
    }
    gfx.position.set(x, y);
    this.ground(elevation).addChild(gfx);
    this.#cracks.push({ gfx, age: 0, life: 6 });
  }

  /** Тряска экрана (в пикселях макета); не накапливается — берётся наибольшая */
  shake(amount) {
    if (!prefs.shake) return;
    this.#shake = Math.max(this.#shake, amount);
  }

  update(dt) {
    if (!this.active) return;
    for (const p of this.#dust) {
      p.age += dt;
      p.sprite.x += p.vx * dt; p.sprite.y += p.vy * dt;
      p.vx *= Math.pow(0.93, dt * 200); p.vy *= Math.pow(0.93, dt * 200);
      const k = p.age / p.life, size = p.size * (0.6 + k) * 2;
      p.sprite.width = p.sprite.height = size;
      p.sprite.alpha = (1 - k) * 0.35;
    }
    this.#dust = sweep(this.#dust, p => p.sprite);
    for (const f of this.#prints) { f.age += dt; f.sprite.alpha = (1 - f.age / f.life) * 0.32; }
    this.#prints = sweep(this.#prints, f => f.sprite);
    for (const q of this.#rings) {
      q.age += dt;
      const k = q.age / q.life;
      q.gfx.clear();
      q.gfx.lineStyle({ width: q.w * (1 - k) + 0.5, color: q.color, alpha: (1 - k) * q.alpha });
      q.gfx.drawCircle(0, 0, q.r + q.grow * k);
    }
    this.#rings = sweep(this.#rings, q => q.gfx);
    for (const c of this.#cracks) { c.age += dt; c.gfx.alpha = Math.min(1, (c.life - c.age) / 1.5); }
    this.#cracks = sweep(this.#cracks, c => c.gfx);
    for (const e of this.#misc) {
      e.age += dt;
      if (e.age < e.life && !e.display.destroyed) e.step?.(e.age / e.life, dt, e);
    }
    this.#misc = sweep(this.#misc, e => e.display);
    // Пустые контейнеры не держим
    for (const [key, c] of this.#grounds) {
      if (c.destroyed) this.#grounds.delete(key);
      else if (!c.children.length) { c.destroy(); this.#grounds.delete(key); }
    }
    this.#updateShake(dt);
  }

  /** Сдвиг сцены на кадр: прошлый сдвиг снимается, новый ставится — панорама и размер окна не сбиваются */
  #updateShake(dt) {
    this.#restoreShake();
    if (this.#shake <= 0.05 || !prefs.shake) { this.#shake = 0; return; }
    const a = this.#shake * this.u * (canvas.stage.scale.x || 1);
    this.#shakeOffset = { x: rnd(-a, a), y: rnd(-a, a) };
    canvas.stage.position.x += this.#shakeOffset.x;
    canvas.stage.position.y += this.#shakeOffset.y;
    this.#shake = Math.max(0, this.#shake - dt * 40);
  }

  #restoreShake() {
    if (!this.#shakeOffset.x && !this.#shakeOffset.y) return;
    if (canvas.stage && !canvas.stage.destroyed) {
      canvas.stage.position.x -= this.#shakeOffset.x;
      canvas.stage.position.y -= this.#shakeOffset.y;
    }
    this.#shakeOffset = { x: 0, y: 0 };
  }
}

/** Убрать отжившие эффекты (age ≥ life) вместе с их графикой */
function sweep(list, display) {
  return list.filter(e => {
    if (e.age < e.life) return true;
    const d = display(e);
    if (!d.destroyed) d.destroy();
    return false;
  });
}

/** Текстуры эффектов рисуются один раз на Canvas2D */
function makeTextures() {
  const make = (w, h, draw) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    return PIXI.Texture.from(c);
  };
  // Мягкая точка (пыль): белая, цвет — через tint
  const dot = make(64, 64, (l, w) => {
    const g = l.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.6, "rgba(255,255,255,.75)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    l.fillStyle = g; l.fillRect(0, 0, w, w);
  });
  // След: овал 16×9 пикселей макета, края чуть мягче
  const print = make(40, 24, l => {
    l.filter = "blur(1px)";
    l.fillStyle = "#fff";
    l.beginPath(); l.ellipse(20, 12, 16, 9, 0, 0, 7); l.fill();
  });
  // Тень: плотная в середине, размытый край; размер задаёт токен
  const shadow = make(128, 128, (l, w) => {
    const g = l.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.7, "rgba(255,255,255,.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    l.fillStyle = g; l.fillRect(0, 0, w, w);
  });
  return { dot, print, shadow };
}

export const fx = new FxLayer();
