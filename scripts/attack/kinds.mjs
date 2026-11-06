/**
 * Чем бьют: вид оружия → картинка и размеры; предмет dnd5e → вид анимации.
 *
 * Базовый тип оружия dnd5e (system.type.baseItem) берётся по таблице DND_ANIM из макета. Самодельное оружие без
 * базового типа — по свойствам (двуручное, фехтовальное, метательное, перезарядка, боеприпасы). Атаки монстров
 * без оружия (природное оружие, умения с атакой) — по названию: укус, когти, удар телом, щупальце, жало, касание,
 * плевок. Для видов, у которых ещё нет своей анимации, указано, чем их пока показывать (as).
 */

import { MODULE_ID } from "../settings.mjs";

const SRC = name => `modules/${MODULE_ID}/assets/weapons/${name}.webp`;

/**
 * Картинки оружия: размеры, где древко по ширине (haftX) и с какой стороны лезвие (для зеркала по ходу дуги).
 * Посчитаны заранее по непрозрачным точкам картинки — так же, как макет считает при загрузке.
 */
export const SPRITES = {
  "axe-2": { w: 183, h: 457, haftX: 0.672, bladeLeft: true },
  // Арбалеты: концы плеч (tipL, tipR) — для тетивы; огнестрел: дуло (muzzle) и с какой стороны картинки замок (lock)
  "crossbow-1": { w: 332, h: 394, haftX: 0.498, tipL: { x: 0.018, y: 0.292 }, tipR: { x: 0.979, y: 0.294 } },
  "crossbow-2": { w: 295, h: 305, haftX: 0.499, tipL: { x: 0.02, y: 0.295 }, tipR: { x: 0.976, y: 0.295 } },
  "crossbow-3": { w: 363, h: 442, haftX: 0.487, tipL: { x: 0.017, y: 0.299 }, tipR: { x: 0.981, y: 0.296 } },
  "musket-1": { w: 106, h: 486, haftX: 0.587, muzzle: { x: 0.434, y: 0.012 }, lock: "left" },
  "pistol-2": { w: 207, h: 432, haftX: 0.388, muzzle: { x: 0.671, y: 0.014 }, lock: "right" },
  "dagger-1": { w: 86, h: 375, haftX: 0.497, bladeRight: true },
  "flail-1": { w: 198, h: 453, haftX: 0.599, bladeRight: true },
  "flail-3": { w: 209, h: 459, haftX: 0.853 },
  "flail-4": { w: 93, h: 459, haftX: 0.515 },
  "greataxe-1": { w: 142, h: 543, haftX: 0.181, bladeRight: true },
  "greatsword-1": { w: 130, h: 541, haftX: 0.496 },
  "maul-1": { w: 192, h: 530, haftX: 0.506 },
  "maul-2": { w: 132, h: 531, haftX: 0.504 },
  "maul-3": { w: 189, h: 520, haftX: 0.494 },
  "maul-4": { w: 230, h: 496, haftX: 0.646, bladeRight: true },
  "polearm-1": { w: 43, h: 543, haftX: 0.492 },
  "polearm-2": { w: 54, h: 543, haftX: 0.533, bladeRight: true },
  "polearm-3": { w: 130, h: 540, haftX: 0.529, bladeLeft: true },
  "polearm-4": { w: 101, h: 539, haftX: 0.499 },
  "rapier-1": { w: 161, h: 483, haftX: 0.532 },
  "sword-1": { w: 125, h: 468, haftX: 0.496 },
  "sword-4": { w: 91, h: 424, haftX: 0.485 }
};
export const spritePath = SRC;

/**
 * Виды оружия (как WKINDS в макете): len — длина картинки в px макета, grip — где хват по высоте картинки,
 * arm — оружие ведёт рука (плечо справа), two — всегда двумя руками, heavy — тяжёлое, thrown — метательное.
 * as — своей анимации пока нет, движения — от этого вида (картинка своя)
 */
export const WKINDS = {
  sword: { src: "sword-1", len: 104, grip: 0.86, arm: true },
  greataxe: { src: "greataxe-1", len: 140, grip: 0.88, arm: true, heavy: true, two: true },
  axe: { src: "axe-2", len: 108, grip: 0.9, arm: true, heavy: true },
  rapier: { src: "rapier-1", len: 128, grip: 0.86, arm: true, thrust: true },
  dagger: { src: "dagger-1", len: 62, grip: 0.78, arm: true, light: true, thrown: "spin", thrust: true },
  handaxe: { src: "axe-2", len: 64, grip: 0.85, arm: true, light: true, thrown: "spin" },
  javelin: { src: "polearm-1", len: 118, grip: 0.62, arm: true, thrown: "point", thrust: true },
  greatsword: { src: "greatsword-1", len: 136, grip: 0.82, as: "greataxe" },
  glaive: { src: "polearm-2", len: 150, grip: 0.7, as: "greataxe" },
  halberd: { src: "polearm-3", len: 150, grip: 0.7, as: "greataxe" },
  maul: { src: "maul-3", len: 124, grip: 0.85, as: "greataxe" },
  greatclub: { src: "maul-1", len: 118, grip: 0.85, as: "greataxe" },
  spear: { src: "polearm-1", len: 130, grip: 0.62, as: "javelin" },
  trident: { src: "polearm-4", len: 124, grip: 0.62, as: "javelin" },
  warhammer: { src: "maul-3", len: 92, grip: 0.85, as: "sword" },
  morningstar: { src: "maul-2", len: 96, grip: 0.85, as: "sword" },
  warpick: { src: "maul-4", len: 94, grip: 0.85, as: "sword" },
  flail: { src: "flail-1", len: 100, grip: 0.8, as: "sword" },
  club: { src: "flail-4", len: 84, grip: 0.85, as: "sword" },
  whip: { src: "flail-3", len: 96, grip: 0.8, as: "sword" },
  // Стрелковое: nut — где орех (замок) по высоте картинки, bolt — длина болта; pan — где полка (огнестрел)
  xbow: { src: "crossbow-1", len: 104, grip: 0.5, xbow: "light", nut: 0.52, bolt: 0.42 },
  hxbow: { src: "crossbow-3", len: 122, grip: 0.5, xbow: "heavy", nut: 0.55, bolt: 0.4 },
  handxbow: { src: "crossbow-2", len: 72, grip: 0.5, xbow: "hand", nut: 0.6, bolt: 0.36 },
  musket: { src: "musket-1", len: 118, grip: 0.5, gun: "musket", pan: 0.66 },
  pistol: { src: "pistol-2", len: 54, grip: 0.5, gun: "pistol", pan: 0.52 }
};

/** Базовый тип оружия dnd5e → вид анимации (DND_ANIM из макета) */
export const DND_ANIM = {
  club: "club", dagger: "dagger", greatclub: "greatclub", handaxe: "handaxe", javelin: "javelin", lighthammer: "warhammer", mace: "morningstar",
  quarterstaff: "spear", sickle: "dagger", spear: "spear", dart: "dagger", lightcrossbow: "xbow", shortbow: "bow", sling: "bow",
  battleaxe: "sword", flail: "flail", glaive: "glaive", greataxe: "greataxe", greatsword: "greatsword", halberd: "halberd", lance: "spear",
  longsword: "sword", maul: "maul", morningstar: "morningstar", pike: "spear", rapier: "rapier", scimitar: "sword", shortsword: "sword",
  trident: "trident", warhammer: "warhammer", warpick: "warpick", whip: "whip", blowgun: "bow", handcrossbow: "handxbow", heavycrossbow: "hxbow",
  longbow: "bow", musket: "musket", pistol: "pistol"
};

/** Стрелковое: своей анимации пока нет — общий выстрел снарядом */
const RANGED = new Set(["bow", "xbow", "hxbow", "handxbow", "musket", "pistol"]);

/** Природные атаки по названию (русские и английские слова). Порядок важен: первое совпадение */
const NATURAL = [
  ["bite", /bite|fang|jaw|beak|укус|клык|челюст|клюв|пасть/i],
  ["claw", /claw|talon|rake|scratch|когт|коготь|царап|лап/i],
  ["tentacle", /tentacle|tendril|щупальц|отросток/i],
  ["vine", /vine|root|thorn|лоз|корн|шип/i],
  ["sting", /sting|жал/i],
  ["touch", /touch|касани|прикоснов/i],
  ["spit", /spit|spray|плев|брызг/i],
  ["slam", /slam|fist|punch|ram|gore|hoof|tail|crush|pseudopod|удар|кулак|таран|бодан|рог|копыт|хвост|ложнонож|сокруш/i]
];
/** Безоружный удар */
const FIST = /unarmed|fist|punch|безоруж|кулак/i;

/**
 * Что показывать для атаки.
 * @returns {{family: "melee"|"natural"|"ranged", kind: string, two?: boolean, thrown?: boolean} | null}
 */
export function chooseAnimation(item, activity, mode) {
  const action = activity?.getActionType?.(mode) ?? activity?.actionType ?? "mwak";
  // Заклинания — отдельная история (позже)
  if (action === "msak" || action === "rsak") return null;
  const ranged = action === "rwak";
  const sys = item?.system ?? {};
  const props = sys.properties ?? new Set();
  const twoMode = mode === "twoHanded";
  const thrownMode = mode?.startsWith?.("thrown");
  const isWeapon = item?.type === "weapon";
  const natural = !isWeapon || sys.type?.value === "natural" || activity?.attack?.type?.classification === "unarmed";

  if (isWeapon && !natural) {
    let kind = DND_ANIM[sys.type?.baseItem];
    if (!kind) kind = byProperties(props, ranged);
    if (RANGED.has(kind)) return { family: "ranged", kind };
    // Метнул оружие ближнего боя — пока общий бросок снарядом
    if (thrownMode || (ranged && !RANGED.has(kind))) return { family: "ranged", kind: "thrown", sprite: kind };
    // Удар второй рукой (два лёгких оружия) — левой
    return { family: "melee", kind, two: twoMode || !!(WKINDS[kind]?.two || WKINDS[WKINDS[kind]?.as]?.two), left: mode === "offhand" };
  }
  // Без оружия: по названию атаки
  const name = `${item?.name ?? ""} ${activity?.name ?? ""} ${item?.system?.identifier ?? ""}`;
  // Безоружный удар (и кулаки у гуманоидов) — кулаки
  if (!ranged && (activity?.attack?.type?.classification === "unarmed" || FIST.test(name))) return { family: "fist", kind: "fist" };
  let nat = NATURAL.find(([, re]) => re.test(name))?.[0] ?? (ranged ? "spit" : "slam");
  return { family: "natural", kind: nat };
}

/** Самодельное оружие: по свойствам dnd5e */
function byProperties(props, ranged) {
  const has = p => props.has?.(p);
  if (has("lod")) return "xbow";
  if (has("amm")) return "bow";
  if (has("two")) return has("rch") ? "glaive" : "greatsword";
  if (has("fin")) return has("lgt") ? "dagger" : "rapier";
  if (has("thr")) return has("lgt") ? "handaxe" : "javelin";
  if (has("rch")) return "spear";
  return ranged ? "javelin" : "sword";
}

/** Вид с анимацией: заглушки берут движения у своего образца, картинку — свою */
export function rigOf(kind) {
  const K = WKINDS[kind] ?? WKINDS.sword;
  const base = K.as ? WKINDS[K.as] : K;
  return { ...base, src: K.src, len: K.len, grip: K.grip, kind, moves: K.as ?? kind };
}
