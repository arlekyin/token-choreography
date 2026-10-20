/**
 * Настройки модуля. «Анимации токенов» — общая для мира (решает Мастер), остальные — у каждого свои:
 * кому-то тряска экрана и мелькание мешают, а другим за столом — нет.
 */

export const MODULE_ID = "token-choreography";

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function registerSettings() {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, {
    name: `TCHOREO.Settings.${key}.name`,
    hint: `TCHOREO.Settings.${key}.hint`,
    config: true,
    type: Boolean,
    onChange: () => prefs.refresh(),
    ...data
  });
  reg("enabled", { scope: "world", default: true });
  // Если в системе включено «уменьшить движение» — по умолчанию спокойно
  reg("calm", { scope: "client", default: reducedMotion() });
  reg("noShake", { scope: "client", default: reducedMotion() });
  reg("footprints", { scope: "client", default: true });
}

/** Текущие настройки одним объектом: читаются каждый кадр, поэтому без лишних обращений к game.settings */
export const prefs = {
  enabled: true,
  calm: false,
  noShake: false,
  footprints: true,
  refresh() {
    for (const key of ["enabled", "calm", "noShake", "footprints"]) this[key] = game.settings.get(MODULE_ID, key);
    // Спокойные эффекты сами по себе без тряски
    this.shake = !this.calm && !this.noShake;
  }
};
