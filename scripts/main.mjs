/**
 * Token Choreography — анимации боя и движения токенов для dnd5e.
 * Точка входа: настройки, класс токена, общий такт на сцене.
 */

import { MODULE_ID, prefs, registerSettings } from "./settings.mjs";
import { choreographTokenClass } from "./token.mjs";
import { director } from "./director.mjs";
import { fx } from "./fx/layer.mjs";
import { registerAttacks, testing } from "./attack/play.mjs";
import { registerHeld } from "./attack/held.mjs";
import { registerGore, cleanGround, wounds } from "./gore/gore.mjs";
import { spray } from "./gore/spray.mjs";
import { decals } from "./gore/decals.mjs";
import { stainOf } from "./gore/blade.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerAttacks();
  registerHeld();
  registerGore();
});

// Класс токена дополняется после init всех пакетов: система (dnd5e) и другие модули уже поставили свой
Hooks.once("setup", () => {
  prefs.refresh();
  CONFIG.Token.objectClass = choreographTokenClass(CONFIG.Token.objectClass);
  game.modules.get(MODULE_ID).api = { director, fx, prefs, testing, cleanGround, gore: { spray, decals, stainOf, wounds } };
});

Hooks.on("canvasReady", () => director.start());
Hooks.on("canvasTearDown", () => director.stop());
