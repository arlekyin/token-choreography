/**
 * Token Choreography — анимации боя и движения токенов для dnd5e.
 * Точка входа: настройки, класс токена, общий такт на сцене.
 */

import { MODULE_ID, prefs, registerSettings } from "./settings.mjs";
import { choreographTokenClass } from "./token.mjs";
import { director } from "./director.mjs";
import { fx } from "./fx/layer.mjs";

Hooks.once("init", () => {
  registerSettings();
});

// Класс токена дополняется после init всех пакетов: система (dnd5e) и другие модули уже поставили свой
Hooks.once("setup", () => {
  prefs.refresh();
  CONFIG.Token.objectClass = choreographTokenClass(CONFIG.Token.objectClass);
  game.modules.get(MODULE_ID).api = { director, fx, prefs };
});

Hooks.on("canvasReady", () => director.start());
Hooks.on("canvasTearDown", () => director.stop());
