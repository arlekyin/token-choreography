/**
 * Оружие в руках вне атаки (как в макете): в бою боец держит своё надетое оружие — оно лежит у него под рукой
 * (под токеном, рукоять прячется за край) и смотрит на ближайшего противника; в атаке оно же и бьёт.
 *
 * Когда держать: по умолчанию — пока токен в идущем бою. Кнопка на панели токена (HUD) достаёт или убирает оружие
 * насовсем (флаг токена — виден всем клиентам); правый клик по кнопке возвращает «как в бою».
 * Что держать: первое надетое оружие ближнего боя, иначе стрелковое; у персонажа без оружия — кулаки.
 * Монстры с природными атаками ничего не держат.
 */

import { MODULE_ID, prefs } from "../settings.mjs";
import { director } from "../director.mjs";
import { WKINDS, chooseAnimation, rigOf } from "./kinds.mjs";
import { IDLE, WeaponRig, weaponTexture } from "./weapon.mjs";
import { FistRig } from "./fists.mjs";
import { BowRig } from "./bow.mjs";
import { GunRig, XbowRig } from "./firearms.mjs";
import { ShieldRig } from "./shield.mjs";

const FLAG = "armed";

/** Ключ оружия: одно и то же оружие в руках и в атаке — один и тот же прибор, без смены картинки */
export function rigKey(choice) {
  if (!choice) return null;
  if (choice.family === "fist") return "fist";
  if (choice.family === "melee") return `m:${choice.kind}:${choice.two ? 1 : 0}:${choice.left ? 1 : 0}`;
  if (choice.kind === "thrown") return `m:${choice.sprite}:0:0`;
  if (choice.family === "ranged") return `r:${choice.kind}`;
  return null;
}

/** Сделать прибор оружия под выбор атаки (или null — показывать нечего) */
export async function makeRig(vis, choice, face) {
  let rig = null;
  if (choice.family === "melee") {
    const K = rigOf(choice.kind);
    rig = new WeaponRig(vis, K, await weaponTexture(K), { two: choice.two, face, left: choice.left });
  } else if (choice.family === "fist") rig = new FistRig(vis, { face });
  else if (choice.kind === "thrown") {
    const K = rigOf(choice.sprite);
    rig = new WeaponRig(vis, K, await weaponTexture(K), { face });
  } else if (choice.family === "ranged") {
    if (choice.kind === "bow") rig = new BowRig(vis, { face });
    else {
      const K = WKINDS[choice.kind];
      if (K) rig = new (K.xbow ? XbowRig : GunRig)(vis, K, await weaponTexture(K), { face });
    }
  }
  if (rig) rig.key = rigKey(choice);
  return rig;
}

/** Опустить оружие в покой */
export function rest(rig) {
  if (!rig) return;
  if (rig instanceof FistRig) rig.guard();
  else if (rig instanceof BowRig) rig.to({ tag: "idle" });
  else if (rig instanceof WeaponRig) { rig.to(IDLE, 260); rig.pierce = false; rig.gone = false; rig.flen = 1; rig.twistT = 0; rig.phi = null; rig.gp = null; }
  else rig.to(IDLE);
}

/** Держит ли токен оружие: флаг токена, а без него — пока токен в идущем бою */
export function isArmed(token) {
  const f = token.document?.getFlag(MODULE_ID, FLAG);
  if (f === true || f === false) return f;
  return !!(game.combat?.started && token.document?.inCombat);
}

/** Что держать: надетое оружие (ближний бой, затем стрелковое); у персонажа без оружия — кулаки */
export function heldChoice(token) {
  const actor = token.actor;
  if (!actor) return null;
  let ranged = null;
  for (const item of actor.items) {
    if (item.type !== "weapon" || !item.system.equipped) continue;
    const act = item.system.activities?.getByType?.("attack")?.[0];
    if (!act) continue;
    const c = chooseAnimation(item, act, null);
    if (c?.family === "melee") return c;
    if (c?.family === "ranged" && c.kind !== "spit" && !ranged) ranged = c;
    if (c?.family === "fist" && !ranged) ranged = c;
  }
  if (ranged) return ranged;
  return actor.type === "character" ? { family: "fist", kind: "fist" } : null;
}

const hasShield = token => !!token.actor?.items?.some(i => i.type === "equipment" && i.system?.type?.value === "shield" && i.system.equipped);

/** Последняя сверка на токен: если пришла новая, старая (ещё грузит картинку) ничего не делает */
const pending = new WeakMap();

/** Привести оружие в руках к нужному: достать, сменить, убрать. Во время атаки — после неё */
export async function syncHeld(token) {
  if (!token || token.destroyed || !canvas.ready) return;
  const vis = token.choreo;
  if (vis.act) return;
  const ticket = {};
  pending.set(token, ticket);
  const want = prefs.enabled && isArmed(token) ? heldChoice(token) : null, key = rigKey(want);
  const r = vis.rig;
  if (want) {
    if (r && r.key === key) {
      // То же оружие (только что из атаки или уже в руках) — просто опустить в покой
      r.leaving = false; r.done = false; r.held = true; rest(r);
    } else {
      const rig = await makeRig(vis, want, vis.rig?.face ?? Math.PI / 2);
      if (pending.get(token) !== ticket || token.destroyed || vis.act) { rig?.destroy(); return; }
      if (vis.rig) { if (vis.shield === vis.rig) vis.shield = null; vis.rig.destroy(); }
      vis.rig = rig;
      if (rig) { rig.held = true; rest(rig); }
    }
    if (hasShield(token)) {
      const q = vis.shield && vis.shield !== vis.rig ? vis.shield : null;
      if (q) { q.leaving = false; q.done = false; q.held = true; q.T = 0; }
      else { vis.shield = new ShieldRig(vis, { face: vis.rig?.face ?? Math.PI / 2 }); vis.shield.held = true; }
    } else if (vis.shield && vis.shield !== vis.rig) vis.shield.release();
  } else {
    if (r?.held) r.release();
    if (vis.shield?.held && vis.shield !== r) vis.shield.release();
  }
  director.wake(vis);
}

export function syncAll() {
  for (const t of canvas.tokens?.placeables ?? []) syncHeld(t);
}

/** Переключить кнопкой: достать или убрать (флаг токена); правый клик — снова «как в бою» */
async function toggle(token, reset) {
  const doc = token.document;
  if (!doc.isOwner) return;
  if (reset) await doc.unsetFlag(MODULE_ID, FLAG);
  else await doc.setFlag(MODULE_ID, FLAG, !isArmed(token));
}

export function registerHeld() {
  Hooks.on("canvasReady", () => syncAll());
  for (const h of ["combatStart", "deleteCombat", "createCombatant", "deleteCombatant"]) Hooks.on(h, () => syncAll());
  Hooks.on("updateCombat", (combat, changed) => { if ("round" in changed || "active" in changed || "started" in changed) syncAll(); });
  Hooks.on("updateToken", (doc, changed) => {
    if (foundry.utils.hasProperty(changed, `flags.${MODULE_ID}`) || foundry.utils.hasProperty(changed, `flags.-=${MODULE_ID}`)) syncHeld(doc.object);
  });
  // Надел, снял, сменил оружие
  const byItem = item => { if (item.parent instanceof Actor) for (const t of item.parent.getActiveTokens(false, false)) syncHeld(t.object ?? t); };
  for (const h of ["createItem", "updateItem", "deleteItem"]) Hooks.on(h, byItem);
  // Кнопка на панели токена
  Hooks.on("renderTokenHUD", (hud, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const col = root?.querySelector(".col.left");
    const token = hud.object;
    if (!col || !token?.document?.isOwner) return;
    const armed = isArmed(token), flag = token.document.getFlag(MODULE_ID, FLAG);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `control-icon${armed ? " active" : ""}`;
    btn.dataset.tooltip = game.i18n.localize(armed ? "TCHOREO.Hud.sheathe" : "TCHOREO.Hud.draw")
      + (flag === undefined ? "" : `<br>${game.i18n.localize("TCHOREO.Hud.reset")}`);
    btn.setAttribute("aria-label", game.i18n.localize(armed ? "TCHOREO.Hud.sheathe" : "TCHOREO.Hud.draw"));
    btn.innerHTML = `<i class="fa-solid ${armed ? "fa-hand-back-fist" : "fa-hand"}" inert></i>`;
    btn.addEventListener("click", ev => { ev.preventDefault(); toggle(token, false).then(() => hud.render()); });
    btn.addEventListener("contextmenu", ev => { ev.preventDefault(); toggle(token, true).then(() => hud.render()); });
    col.append(btn);
  });
}
