/**
 * Чем истекает существо — по типу существа dnd5e. Цвета: lo/hi — разброс пятен на земле, drop — капля в воздухе,
 * dark — сердцевина пятна, ободок и лужа, wet — блик, blade — подтёки на клинке, gloss — блеск (свернувшаяся
 * кровь нежити тусклая), glow — светится (ихор небожителя), embers — искры при ударе (исчадие).
 * Кто не течёт (элементаль, скелет) — вместо жидкости пыль и осколки (DUSTS): луж нет, клинок чистый.
 * Скелет — нежить без плоти: отличается по названию или подтипу; любой тип можно задать флагом актёра
 * flags.token-choreography.fluid
 */

import { MODULE_ID } from "../settings.mjs";

export const FLUIDS = {
  blood:      { lo: [92, 3, 9],      hi: [138, 10, 18],   drop: [150, 8, 20],    dark: [52, 2, 6],      wet: [185, 32, 36],   blade: [92, 6, 12],    gloss: 1 },
  undead:     { lo: [34, 22, 20],    hi: [60, 36, 28],    drop: [62, 38, 30],    dark: [14, 8, 6],      wet: [110, 84, 70],   blade: [40, 24, 20],   gloss: 0.35 },
  // Сок растений — млечный: зелёный теряется в траве
  plant:      { lo: [208, 216, 190], hi: [234, 238, 220], drop: [242, 245, 230], dark: [160, 172, 140], wet: [255, 255, 255], blade: [218, 224, 200], gloss: 1 },
  ooze:       { lo: [112, 168, 20],  hi: [150, 208, 40],  drop: [165, 222, 55],  dark: [62, 100, 10],   wet: [225, 255, 150], blade: [122, 180, 30], gloss: 1 },
  construct:  { lo: [16, 16, 22],    hi: [34, 32, 42],    drop: [30, 30, 40],    dark: [6, 6, 8],       wet: [130, 118, 175], blade: [22, 22, 30],   gloss: 1 },
  fiend:      { lo: [40, 6, 6],      hi: [70, 12, 8],     drop: [84, 14, 10],    dark: [14, 2, 2],      wet: [235, 100, 35],  blade: [48, 8, 6],     gloss: 0.8, embers: true },
  celestial:  { lo: [186, 118, 6],   hi: [232, 168, 22],  drop: [255, 196, 40],  dark: [96, 50, 0],     wet: [255, 246, 190], blade: [200, 132, 10], gloss: 1, glow: true },
  aberration: { lo: [70, 30, 110],   hi: [110, 50, 160],  drop: [122, 62, 172],  dark: [30, 10, 50],    wet: [195, 145, 245], blade: [82, 36, 122],  gloss: 0.9 },
  fey:        { lo: [120, 170, 200], hi: [170, 215, 235], drop: [185, 228, 245], dark: [60, 100, 130],  wet: [240, 252, 255], blade: [128, 178, 205], gloss: 0.9 }
};

/** Элементаль — каменная крошка; скелет — немного костной пыли, павший оставляет горстку пыли */
export const DUSTS = {
  elemental: { chip: [120, 80, 42], puff: [205, 190, 155], amount: 1 },
  bone:      { chip: [232, 224, 202], puff: [220, 214, 198], amount: 0.55, heap: true }
};

/** Тип существа dnd5e → жидкость */
const BY_TYPE = {
  humanoid: "blood", beast: "blood", giant: "blood", monstrosity: "blood", dragon: "blood",
  undead: "undead", plant: "plant", ooze: "ooze", construct: "construct", fiend: "fiend",
  celestial: "celestial", aberration: "aberration", fey: "fey", elemental: "elemental"
};
const SKELETON = /skelet|скелет|костян/i;

/** Чем истекает актёр: id из FLUIDS или DUSTS */
export function fluidIdOf(actor) {
  if (!actor) return "blood";
  const own = actor.getFlag?.(MODULE_ID, "fluid");
  if (own && (own in FLUIDS || own in DUSTS)) return own;
  const type = actor.system?.details?.type ?? {};
  const id = BY_TYPE[type.value] ?? "blood";
  if (id === "undead" && SKELETON.test(`${actor.name} ${actor.prototypeToken?.name ?? ""} ${type.subtype ?? ""} ${type.custom ?? ""}`)) return "bone";
  return id;
}

export const fluidOf = id => FLUIDS[id] ?? null;

export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const hex = c => (c[0] << 16) | (c[1] << 8) | c[2];
/** Цвет между lo и hi; r — случайность (общая у всех клиентов, если передана) */
export const mixRgb = (lo, hi, r = Math.random) => { const k = r(); return [0, 1, 2].map(i => (lo[i] + (hi[i] - lo[i]) * k) | 0); };
