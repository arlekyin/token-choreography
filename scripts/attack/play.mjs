/**
 * Запуск атаки от броска dnd5e. Сообщение чата с броском атаки (тип «attack») приходит всем клиентам —
 * каждый сам показывает атаку у себя. Исход по каждой цели — как у dnd5e (evaluatedTargets: КД цели, крит,
 * натуральная 1). Зерно случайности — из id сообщения: варианты (куда уклонился, с какой стороны) у всех одни.
 * С Dice So Nice атака начинается, когда кости упали.
 */

import { prefs } from "../settings.mjs";
import { seeded } from "./rng.mjs";
import { WKINDS, chooseAnimation, rigOf } from "./kinds.mjs";
import { Attack } from "./attack.mjs";
import { melee } from "./melee.mjs";
import { thrust, thrustNeedsDefender } from "./thrust.mjs";
import { greataxe } from "./greataxe.mjs";
import { fists } from "./fists.mjs";
import { bow } from "./bow.mjs";
import { firearm } from "./firearms.mjs";
import { thrown } from "./thrown.mjs";
import { limbAttack } from "./limbs.mjs";
import { ShieldRig } from "./shield.mjs";
import { makeRig, rigKey, syncHeld } from "./held.mjs";
import { natural } from "./natural.mjs";
import { ranged } from "./ranged.mjs";
import { goreFor } from "../gore/gore.mjs";

/** Для проверок: принудительный стиль удара и уход цели, через сколько секунд простоя стряхивать кровь (api.testing) */
export const testing = { style: null, dodge: null, idleShake: null };

/** Очередь атак каждого токена: вторая атака того же токена ждёт конца первой */
const queues = new Map();

export function registerAttacks() {
  Hooks.on("createChatMessage", message => {
    if (message.type !== "attack") return;
    onAttackMessage(message).catch(err => console.error("token-choreography | атака", err));
  });
}

/** Разобрать сообщение атаки и показать атаку по каждой цели */
async function onAttackMessage(message) {
  if (!prefs.enabled || !canvas.ready) return;
  const roll = message.rolls?.[0];
  if (!(roll instanceof CONFIG.Dice.D20Roll)) return;
  // Скрытый бросок (вслепую, шёпот не тебе): исход не выдаём
  if (!message.isContentVisible) return;
  const attacker = speakerToken(message);
  if (!attacker) return;
  const targets = (message.system?.evaluatedTargets ?? []).map(t => ({ ...t, token: targetToken(t) }))
    .filter(t => t.token && t.token !== attacker);
  if (!targets.length) return;
  const item = message.getAssociatedItem?.();
  const activity = message.getAssociatedActivity?.();
  const choice = chooseAnimation(item, activity, message.system?.mode);
  if (!choice) return;
  // Стиль — сразу, пока статусы атакующего не сменились (dnd5e может снять «Скрытность» после атаки)
  const plan = targets.map((t, i) => {
    const rng = seeded(`${message.id}:${i}`), result = outcome(roll, t);
    const styled = choice.family === "melee" || choice.family === "fist" || (choice.family === "ranged" && (!!WKINDS[choice.kind] || choice.kind === "bow"));
    const style = styled ? styleFor(attacker, message, roll, choice, result, rng) : null;
    const gore = goreFor(item, activity, choice, t.token, result === "crit", `${message.id}:${i}`);
    return { target: t.token, result, fumble: !!roll.isFumble, rng, style, gore };
  });
  await diceLanded(message);
  const key = attacker.document.id;
  const run = (queues.get(key) ?? Promise.resolve()).then(async () => {
    for (const p of plan) await play(attacker, p.target, choice, p);
  });
  queues.set(key, run.catch(() => {}));
  await run;
}

/** Исход по цели: попадание, крит, по броне (промах в 1–2 от КД), промах */
function outcome(roll, t) {
  if (!t.isMiss) return roll.isCritical ? "crit" : "hit";
  if (!roll.isFumble && (t.ac != null) && (roll.total >= t.ac - 2)) return "glance";
  return "miss";
}

/** Токен говорящего на текущей сцене */
function speakerToken(message) {
  const { scene, token, actor } = message.speaker ?? {};
  if (token && (!scene || scene === canvas.scene?.id)) {
    const t = canvas.tokens.get(token);
    if (t) return t;
  }
  const a = game.actors.get(actor);
  return a?.getActiveTokens?.(false, false).find(t => t.scene === canvas.scene) ?? null;
}

function targetToken(t) {
  const doc = t.token ? fromUuidSync(t.token, { strict: false }) : null;
  if (!doc || doc.parent !== canvas.scene) return null;
  return doc.object ?? null;
}

/** Ждать, пока Dice So Nice покажет кости этого сообщения (не дольше 15 с) */
async function diceLanded(message) {
  if (!game.dice3d?.waitFor3DAnimationByMessageID) return;
  // Dice So Nice помечает сообщение в своём createChatMessage — даём ему отработать
  await new Promise(r => setTimeout(r, 0));
  await Promise.race([
    game.dice3d.waitFor3DAnimationByMessageID(message.id),
    new Promise(r => setTimeout(r, 15000))
  ]);
}

/**
 * Подошёл ли атакующий к цели перед ударом — тогда наскок.
 * В бою: его ход и есть пройденный путь (история хода Foundry). Вне боя: ход кончился не раньше чем за 4 с
 * до прихода сообщения (часы клиента: ход и сообщение все получают почти одновременно)
 */
function approached(token, message) {
  const combat = game.combat;
  if (combat?.started && combat.combatants.some(c => c.tokenId === token.document.id)) {
    if (combat.combatant?.tokenId !== token.document.id) return false;
    return (token.document.movementHistory?.length ?? 0) > 0;
  }
  const end = token.choreoMovedUntil;
  if (!end) return false;
  const gap = Date.now() - end;
  return gap > -3000 && gap < 4000;
}

/** Есть ли у существа «Скрытая атака» */
const SNEAK = /sneak.?attack|скрытая атака/i;
function hasSneakAttack(actor) {
  return !!actor?.items?.some(i => i.system?.identifier === "sneak-attack" || SNEAK.test(i.name) || SNEAK.test(i.originalName ?? ""));
}

/**
 * Стиль удара оружием (общий для всех клиентов: только данные сообщения, документов и зерно):
 *  исподтишка — атакующий прячется или невидим, либо бросок с преимуществом и у него есть «Скрытая атака»;
 *  наскок     — подошёл к цели перед ударом;
 *  с замахом  — крит, мастерство «Опрокидывание»/«Толчок», двуручное двумя руками;
 *  иначе      — выпад, изредка (1 из 4) с замахом, чтобы удары не были одинаковыми
 */
function styleFor(attacker, message, roll, choice, result, rng) {
  // Только для проверок: принудительный стиль
  if (testing.style) return testing.style;
  const actor = attacker.actor, st = actor?.statuses;
  if (st?.has("hiding") || st?.has("invisible") || (roll.hasAdvantage && hasSneakAttack(actor))) return "sneak";
  if (approached(attacker, message)) return "leap";
  const mastery = message.system?.mastery;
  if (result === "crit" || mastery === "topple" || mastery === "push" || choice.two) return "heavy";
  return rng.next() < 0.25 ? "heavy" : "lunge";
}

/** Оружие цели для защиты: надетое оружие ближнего боя */
function defenderWeapon(token) {
  const items = token.actor?.items ?? [];
  for (const item of items) {
    if (item.type !== "weapon" || !item.system.equipped) continue;
    const act = item.system.activities?.getByType?.("attack")?.[0];
    const c = chooseAnimation(item, act, null);
    if (c?.family === "melee") return c;
  }
  return null;
}

/** Надет ли щит */
const hasShield = token => !!token.actor?.items?.some(i => i.type === "equipment" && i.system?.type?.value === "shield" && i.system.equipped);

/** Показать одну атаку и дождаться её конца */
async function play(attacker, target, choice, { result, fumble, rng, style, gore }) {
  if (attacker.destroyed || target.destroyed) return;
  const a = attacker.choreo, b = target.choreo;
  // Стряхивал кровь — атака важнее
  for (const v of [a, b]) if (v.act && !(v.act instanceof Attack)) v.act.cancel();
  // Прошлая атака ещё не кончилась (или токен в ходе) — эту показываем после
  const A = new Attack(a, b, { result, fumble, rng });
  A.gore = gore ? { ...gore } : null;
  // Оружие цели нужно только для защиты: парирование и ответный укол после промаха
  const moves = choice.family === "melee" ? rigOf(choice.kind).moves : null;
  const def = result === "miss" || thrustNeedsDefender(moves, style) ? defenderWeapon(target) : null;
  const shield = (result === "miss" || thrustNeedsDefender(moves, style)) && hasShield(target);
  // Оружие цели: то, что у неё в руках (или ещё исчезает после прошлой атаки), если это оно; иначе — новое
  const defKey = rigKey(def), drop = r => { if (b.shield === r) b.shield = null; r.destroy(); };
  if (b.rig?.leaving && b.rig.key !== defKey && b.rig !== b.shield) { drop(b.rig); b.rig = null; }
  if (b.shield?.leaving && !shield) { b.shield.destroy(); if (b.rig === b.shield) b.rig = null; b.shield = null; }
  if (def) {
    if (b.rig && b.rig.key === defKey) Object.assign(b.rig, { leaving: false, done: false, held: false });
    else if (!b.rig || b.rig.held || b.rig.leaving) {
      const r = await makeRig(b, def, A.dir + Math.PI);
      if (b.rig) drop(b.rig);
      b.rig = r;
    }
    b.rig.faceLock = A.dir + Math.PI;
  }
  if (shield) {
    if (b.shield) Object.assign(b.shield, { leaving: false, done: false, held: false });
    else b.shield = new ShieldRig(b, { face: A.dir + Math.PI });
    b.shield.faceLock = A.dir + Math.PI;
    // Без оружия щит сам защищает
    if (!b.rig) b.rig = b.shield;
  }
  // Варианты ухода — только от данных (не от того, что сейчас у цели в руках), чтобы у всех совпадало
  const dodges = ["side", "back", "duck"];
  if (def || shield) dodges.push("parry");
  A.dodge = rng.pick(dodges);
  if (testing.dodge && dodges.includes(testing.dodge)) A.dodge = testing.dodge;
  // Оружие атакующего: то, что в руках, если это оно (без смены картинки); иначе — новое
  const key = rigKey(choice);
  if (key && a.rig && a.rig.key === key && !a.rig.done) Object.assign(a.rig, { leaving: false, held: false, faceLock: A.dir });
  else if (key) {
    const r = await makeRig(a, choice, A.dir);
    if (a.rig) { if (a.shield === a.rig) a.shield = null; a.rig.destroy(); }
    a.rig = r;
  }
  if (choice.family === "melee") {
    const K = a.rig.K;
    A.style = style ?? "lunge";
    if (K.moves === "greataxe") greataxe(A, A.style);
    else if (!thrust(A, A.style)) melee(A, { style: A.style, dodge: A.dodge });
  }
  else if (choice.family === "fist") {
    A.style = style ?? "lunge";
    fists(A, A.style);
  }
  else if (choice.family === "natural") { if (!limbAttack(A, choice.kind)) natural(A, choice.kind); }
  else if (choice.family === "ranged" && choice.kind !== "thrown") {
    A.style = style ?? "lunge";
    if (choice.kind === "bow") bow(A, A.style);
    else firearm(A, A.style);
  }
  else if (choice.kind === "thrown") thrown(A, a.rig.main.texture);
  else ranged(A, choice);
  const ended = new Promise(r => { A.onEnd = r; });
  A.start();
  await ended;
  // После атаки: оружие — снова в руки (если боец держит его) или убрать
  syncHeld(attacker); syncHeld(target);
}
