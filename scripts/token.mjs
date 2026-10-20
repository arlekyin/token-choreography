/**
 * Дополнение к классу токена (поверх того, что поставила система, — у dnd5e это Token5e).
 *
 * Встроенная анимация хода Foundry остаётся: она двигает документ по точкам, обновляет зрение, свет, регионы
 * и линейку. Отсюда ей подсказывается длительность каждого отрезка (по нашей раскладке хода), а картинка —
 * сжатие, наклон, путь со скруглёнными поворотами, полёт — накладывается поверх её отрисовки.
 */

import { prefs } from "./settings.mjs";
import { TokenVisual } from "./visual.mjs";
import { Motion } from "./motion/motion.mjs";
import { director } from "./director.mjs";
import { FLY_ALT } from "./util.mjs";

export function choreographTokenClass(Base) {
  return class ChoreographedToken extends Base {
    /** @type {TokenVisual|undefined} */
    _choreo;
    /** @type {Motion|null} План хода на время обновления (Foundry зовёт animate синхронно) */
    _choreoPlan = null;

    get choreo() {
      return this._choreo ??= new TokenVisual(this);
    }

    /** @override */
    async _draw(options) {
      await super._draw(options);
      // После перерисовки меш новый: старые значения Foundry недействительны
      if (this._choreo) { this._choreo.applied = false; this._choreo.base = null; }
      this.#syncHover(true);
    }

    /** @override */
    _onUpdate(changed, options, userId) {
      this._choreoPlan = null;
      // Выбранный способ хода мог смениться вместе с ходом: в воздухе ли токен — до раскладки хода
      if ("movementAction" in changed) this.#syncHover(false);
      try { this.#planMovement(options); }
      catch (err) { console.error("token-choreography | план хода", err); this._choreoPlan = null; }
      try { super._onUpdate(changed, options, userId); }
      finally { this._choreoPlan = null; }
    }

    #planMovement(options) {
      if (!prefs.enabled || !canvas.ready || options.animate === false) return;
      const movement = options._movement?.[this.document.id];
      if (!movement?.passed?.waypoints?.length) return;
      const explicit = options.animation?.movementSpeed;
      if (explicit !== undefined && !(explicit < 1e6)) return; // заданная длительность 0 — мгновенно
      if (options.animation?.duration === 0) return;
      const vis = this.choreo, running = vis.motion;
      const motion = Motion.plan(vis, movement, {
        continuing: !!running,
        startAloft: running ? running.endAloft : vis.aloft,
        explicitSpeed: explicit
      });
      if (!motion) return;
      this._choreoPlan = motion;
      vis.startMotion(motion);
      director.wake(vis);
    }

    /** @override */
    animate(to, options = {}) {
      const plan = this._choreoPlan;
      if (plan && options.chain && (options.name === this.movementAnimationName)) {
        options = { ...options, duration: plan.durationTo(this.document, to) };
      }
      return super.animate(to, options);
    }

    /** @override */
    stopAnimation(options) {
      super.stopAnimation(options);
      this._choreo?.cancelMotion();
    }

    /** @override */
    _applyRenderFlags(flags) {
      const vis = this._choreo;
      vis?.restore();
      super._applyRenderFlags(flags);
      if (!vis || this.destroyed) return;
      vis.capture();
      if (vis.busy) { vis.apply(); director.wake(vis); }
    }

    /** @override */
    _onApplyStatusEffect(statusId, active) {
      super._onApplyStatusEffect(statusId, active);
      const s = CONFIG.specialStatusEffects;
      if ((statusId === s.FLY) || (statusId === s.HOVER)) this.#syncHover(false);
    }

    /**
     * В воздухе между ходами: состояние dnd5e «Полёт»/«Парение» или выбранный способ хода «Полёт».
     * Летящий после хода не садится; садится, когда игрок сменил способ хода на ходьбу (или снял состояние)
     */
    #syncHover(instant) {
      if (!prefs.enabled) return;
      const s = CONFIG.specialStatusEffects, doc = this.document;
      const status = !!(doc?.hasStatusEffect(s.FLY) || doc?.hasStatusEffect(s.HOVER));
      const on = status || doc?.movementAction === "fly";
      const vis = this.choreo;
      vis.statusHover = status;
      // Сменили способ хода не на полёт (или сняли состояние) — висеть после прошлого полёта больше незачем
      if (!on) vis.keepAloft = false;
      if (vis.hover === on) { director.wake(vis); return; }
      vis.hover = on;
      if (instant) { vis.alt = on ? FLY_ALT : 0; vis.aloft = on; }
      director.wake(vis);
    }

    /** @override */
    _destroy(options) {
      if (this._choreo) { director.forget(this._choreo); this._choreo.destroy(); this._choreo = undefined; }
      super._destroy(options);
    }
  };
}
