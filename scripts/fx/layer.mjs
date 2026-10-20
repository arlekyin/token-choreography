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
    this.#dust = []; this.#prints = []; this.#rings = []; this.#cracks = [];
    this.#restoreShake();
    this.#shake = 0;
    this.active = false;
  }

  /** Контейнер земли на высоте elevation (создаётся по требованию) */
  ground(elevation = 0) {
    const key = Math.round((elevation || 0) * 100) / 100;
    let c = this.#grounds.get(key);
    if (c && !c.destroyed) return c;
    c = new PIXI.Container();
    c.eventMode = "none";
    c.elevation = key;
    c.sortLayer = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS.TOKENS - 1;
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

  /** Расходящееся кольцо пыли (взлёт, посадка, тяжёлое приземление) */
  ring(x, y, elevation, { r = 30, life = 0.4, w = 4, grow = 60 } = {}) {
    if (!this.active) return;
    const u = this.u, gfx = new PIXI.Graphics();
    gfx.position.set(x, y);
    this.ground(elevation).addChild(gfx);
    this.#rings.push({ gfx, r: r * u, life, w: w * u, grow: grow * u, age: 0 });
  }

  /** След ноги: dir — направление шага, side — левая/правая (±1), z — размер существа в клетках */
  print(x, y, elevation, dir, side, z = 1) {
    if (!this.active || !prefs.footprints) return;
    const u = this.u, nx = -Math.sin(dir), ny = Math.cos(dir), off = 14 * u * Math.max(0.5, z);
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
      q.gfx.lineStyle({ width: q.w * (1 - k) + 0.5, color: 0xd2c3a0, alpha: (1 - k) * 0.55 });
      q.gfx.drawCircle(0, 0, q.r + q.grow * k);
    }
    this.#rings = sweep(this.#rings, q => q.gfx);
    for (const c of this.#cracks) { c.age += dt; c.gfx.alpha = Math.min(1, (c.life - c.age) / 1.5); }
    this.#cracks = sweep(this.#cracks, c => c.gfx);
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
