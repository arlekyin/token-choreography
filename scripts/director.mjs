/**
 * Один общий такт на все токены: после того как Foundry применила свои обновления токенов (OBJECTS) и до
 * пересчёта основной группы (PRIMARY). Токены без движения и без парения в такте не участвуют.
 */

import { fx } from "./fx/layer.mjs";
import { goreUpdate, goreClear } from "./gore/gore.mjs";

class Director {
  /** @type {Set<import("./visual.mjs").TokenVisual>} */
  #awake = new Set();
  #time = 0;
  #fn = null;
  /** Замедление времени — только для раскадровок в проверках (ход Foundry идёт по реальному времени) */
  timeScale = 1;
  /** Сколько ещё времени можно прожить (для пошаговой раскадровки); Infinity — без ограничения */
  budget = Infinity;

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
    goreClear();
    fx.detach();
  }

  wake(vis) { if (this.#fn) this.#awake.add(vis); }
  forget(vis) { this.#awake.delete(vis); }

  #tick() {
    // Реальное время (Foundry двигает документ по нему же), но пружины считаются шагами не крупнее 1/60 с
    // В атаке — шаги по 5 мс, как в макете: жёсткие пружины оружия на крупном шаге разлетаются
    const dt = Math.min(Math.min(0.25, canvas.app.ticker.deltaMS / 1000) * this.timeScale, this.budget);
    this.budget -= dt;
    for (const v of this.#awake) {
      const t = v.token;
      if (!t || t.destroyed || !t.mesh || t.mesh.destroyed) { this.#awake.delete(v); continue; }
      try {
        // Значения Foundry снимаются только с неискажённого меша
        if (!v.applied) v.capture();
        const n = Math.max(1, Math.ceil(v.fine ? dt / 0.005 : dt * 60)), sub = dt / n;
        for (let i = 0; i < n; i++) v.update(sub, this.#time + sub * (i + 1));
        if (v.busy) v.apply();
        else { v.restore(); v.destroy(); this.#awake.delete(v); }
      } catch (err) {
        console.error("token-choreography |", err);
        v.cancelCombat();
        v.restore();
        this.#awake.delete(v);
      }
    }
    this.#time += dt;
    fx.update(dt);
    goreUpdate(dt);
  }
}

export const director = new Director();
