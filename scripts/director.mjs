/**
 * Один общий такт на все токены: после того как Foundry применила свои обновления токенов (OBJECTS) и до
 * пересчёта основной группы (PRIMARY). Токены без движения и без парения в такте не участвуют.
 */

import { fx } from "./fx/layer.mjs";

class Director {
  /** @type {Set<import("./visual.mjs").TokenVisual>} */
  #awake = new Set();
  #time = 0;
  #fn = null;

  start() {
    this.stop();
    fx.attach();
    this.#fn = this.#tick.bind(this);
    canvas.app.ticker.add(this.#fn, undefined, PIXI.UPDATE_PRIORITY.OBJECTS - 1);
    // Токены рисуются раньше, чем запускается такт: парящих разбудить сейчас
    for (const t of canvas.tokens?.placeables ?? []) if (t._choreo?.hover) this.wake(t._choreo);
  }

  stop() {
    if (this.#fn) canvas.app?.ticker?.remove(this.#fn);
    this.#fn = null;
    for (const v of this.#awake) v.destroy();
    this.#awake.clear();
    fx.detach();
  }

  wake(vis) { if (this.#fn) this.#awake.add(vis); }
  forget(vis) { this.#awake.delete(vis); }

  #tick() {
    // Реальное время (Foundry двигает документ по нему же), но пружины считаются шагами не крупнее 1/60 с
    const dt = Math.min(0.25, canvas.app.ticker.deltaMS / 1000);
    const n = Math.max(1, Math.ceil(dt * 60)), sub = dt / n;
    for (const v of this.#awake) {
      const t = v.token;
      if (!t || t.destroyed || !t.mesh || t.mesh.destroyed) { this.#awake.delete(v); continue; }
      try {
        // Значения Foundry снимаются только с неискажённого меша
        if (!v.applied) v.capture();
        for (let i = 0; i < n; i++) v.update(sub, this.#time + sub * (i + 1));
        if (v.busy) v.apply();
        else { v.restore(); v.destroy(); this.#awake.delete(v); }
      } catch (err) {
        console.error("token-choreography |", err);
        v.restore();
        this.#awake.delete(v);
      }
    }
    this.#time += dt;
    fx.update(dt);
  }
}

export const director = new Director();
