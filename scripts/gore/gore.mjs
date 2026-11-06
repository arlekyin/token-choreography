/**
 * Кровь в бою — сборка: что несёт атака (goreFor), смерть (лужа под павшим, у скелета — горстка пыли), раны на
 * портрете, красные края экрана у своего героя, чистка оружия после боя, стряхивание по простою, такт.
 *
 * Что видит клиент, решают его настройки («Кровь», спокойные эффекты, без вспышек). Смерть и раны — от ПЗ актёра
 * (updateActor приходит всем клиентам), атака — от сообщения.
 */

import { MODULE_ID, prefs } from "../settings.mjs";
import { clamp } from "../util.mjs";
import { testing } from "../attack/play.mjs";
import { decals, seededRnd } from "./decals.mjs";
import { spray, lastHits, goreK } from "./spray.mjs";
import { FLUIDS, DUSTS, fluidIdOf, fluidOf, rgba } from "./fluids.mjs";
import { stain, allStains, clearStains } from "./blade.mjs";
import { startFlourish } from "./flourish.mjs";

/** Природные атаки и оружие → вид урона, если в атаке нет своего (макет: NAT_DMG, WEAPON_DMG) */
const NAT_DMG = { bite: "pierce", claw: "slash", slam: "blunt", vine: "slash", tentacle: "blunt", sting: "pierce", touch: "blunt", spit: "blunt", fist: "blunt" };
const KIND_DMG = { rapier: "pierce", dagger: "pierce", javelin: "pierce", spear: "pierce", trident: "pierce", warpick: "pierce",
  maul: "blunt", greatclub: "blunt", warhammer: "blunt", morningstar: "blunt", flail: "blunt", club: "blunt" };
const DMG = { slashing: "slash", piercing: "pierce", bludgeoning: "blunt" };

/** Стряхнуть кровь после стольких секунд без дела в бою */
const IDLE = 300;

/**
 * Что атака несёт для крови по одной цели: вид раны, доля ПЗ, которую она снимет, жидкость цели, зерно
 * @returns {{type, share, fluid, seed, melee}}
 */
export function goreFor(item, activity, choice, target, crit, seed) {
  const parts = damageParts(item, activity);
  let type = null;
  for (const p of parts) for (const t of p.types ?? []) { if (DMG[t]) { type = DMG[t]; break; } }
  if (!type && parts.some(p => p.types?.has?.("fire") || (Array.isArray(p.types) && p.types.includes("fire")))) type = "fire";
  type ??= choice.family === "natural" || choice.family === "fist" ? NAT_DMG[choice.kind] ?? "slash"
    : choice.family === "ranged" ? "pierce" : KIND_DMG[choice.kind] ?? "slash";
  return { type, share: shareOf(parts, item, target, crit), fluid: fluidIdOf(target.actor), seed, melee: choice.family === "melee" };
}

/** Части урона атаки: урон оружия (если атака его берёт) и свои */
function damageParts(item, activity) {
  const out = [];
  try {
    if (activity?.damage?.includeBase && item?.system?.damage?.base) out.push(item.system.damage.base);
    for (const p of activity?.damage?.parts ?? []) out.push(p);
  } catch { /* у предмета может не быть урона */ }
  return out;
}

/** Какую долю ПЗ цели снимет средний удар (крит — больше); не знаем — треть */
function shareOf(parts, item, target, crit) {
  const max = target.actor?.system?.attributes?.hp?.max;
  if (!max || !parts.length) return 0.3;
  try {
    const data = item?.getRollData?.() ?? {};
    let avg = 0;
    for (const p of parts) {
      const f = p.formula;
      if (!f) continue;
      const formula = Roll.replaceFormulaData(f, data, { missing: "0" });
      const hi = new Roll(formula).evaluateSync({ maximize: true }).total, lo = new Roll(formula).evaluateSync({ minimize: true }).total;
      avg += (hi + lo) / 2;
    }
    if (!avg) return 0.3;
    return clamp(avg * (crit ? 1.6 : 1) / max, 0.08, 1);
  } catch { return 0.3; }
}

/* ---------- Раны на портрете ---------- */

/** Раны поверх картинки токена: царапины от четверти ПЗ, подтёки — ниже половины; по картинке, без фона */
class Wounds {
  /** tokenId → {sprite, canvas, hurt, fluid, src} */
  #marks = new Map();

  /** Есть ли раны у токена (для проверок) */
  has(tokenId) { const m = this.#marks.get(tokenId); return !!m && !m.sprite.destroyed && m.sprite.visible && !!m.sprite.parent; }

  /** Обновить раны токена по его ПЗ */
  refresh(token) {
    if (!token || token.destroyed) return;
    const hp = token.actor?.system?.attributes?.hp, id = token.document.id;
    const hurt = hp?.max ? clamp(1 - (hp.value ?? hp.max) / hp.max) : 0;
    if (goreK() <= 0 || hurt <= 0.02 || !token.mesh?.texture) { this.#drop(id); return; }
    const fluid = fluidIdOf(token.actor), q = Math.round(hurt * 20) / 20;
    let m = this.#marks.get(id);
    const src = token.mesh.texture.baseTexture?.resource?.source;
    if (!src) return;
    if (!m || m.sprite.destroyed || m.src !== src) {
      this.#drop(id);
      const canvas = document.createElement("canvas");
      canvas.width = token.mesh.texture.width; canvas.height = token.mesh.texture.height;
      const sprite = new PIXI.Sprite(PIXI.Texture.from(canvas));
      sprite.eventMode = "none";
      m = { sprite, canvas, hurt: -1, fluid: null, src, token };
      this.#marks.set(id, m);
    }
    if (m.hurt !== q || m.fluid !== fluid) { m.hurt = q; m.fluid = fluid; this.#paint(m, token, q, fluid); }
    this.follow(token);
  }

  #paint(m, token, hurt, fluid) {
    const c = m.canvas, l = c.getContext("2d"), W = c.width, H = c.height, frame = token.mesh.texture.frame;
    const D = DUSTS[fluid], fl = FLUIDS[fluid] ?? (D ? { lo: D.puff, hi: D.chip, dark: D.chip.map(v => v * 0.55 | 0) } : FLUIDS.blood);
    const r = seededRnd(`wounds:${token.document.id}`), rnd = (a, b) => a + r() * (b - a), S = Math.min(W, H);
    l.clearRect(0, 0, W, H);
    // Царапины
    l.globalAlpha = clamp(hurt * 1.6); l.lineCap = "round";
    for (let i = 0; i < 5; i++) {
      const x = rnd(0.15, 0.85) * W, y = rnd(0.15, 0.85) * H, a = rnd(0, 6.28), L = rnd(0.15, 0.4) * S;
      l.strokeStyle = rgba(fl.hi, 0.85); l.lineWidth = rnd(0.017, 0.034) * S;
      l.beginPath(); l.moveTo(x, y); l.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); l.stroke();
    }
    // Подтёки и пятна — тяжело ранен
    l.globalAlpha = clamp((hurt - 0.5) * 2.2);
    if (l.globalAlpha > 0) {
      for (let i = 0; i < 4; i++) {
        const x = rnd(0.2, 0.8) * W, y = rnd(0.15, 0.6) * H, w = rnd(0.06, 0.12) * S, h = rnd(0.2, 0.45) * S;
        const g = l.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, rgba(fl.lo, 0.85)); g.addColorStop(1, rgba(fl.lo, 0));
        l.fillStyle = g; l.beginPath(); l.ellipse(x, y + h / 2, w, h / 2, rnd(-0.2, 0.2), 0, 7); l.fill();
      }
      l.fillStyle = rgba(fl.dark, 0.6);
      for (let i = 0; i < 6; i++) { l.beginPath(); l.arc(rnd(0.15, 0.85) * W, rnd(0.15, 0.85) * H, rnd(0.017, 0.05) * S, 0, 7); l.fill(); }
    }
    l.globalAlpha = 1;
    // Только по картинке: прозрачный фон токена не пачкается
    l.globalCompositeOperation = "destination-in";
    l.drawImage(m.src, frame.x, frame.y, frame.width, frame.height, 0, 0, W, H);
    l.globalCompositeOperation = "source-over";
    m.sprite.texture.baseTexture.update();
  }

  /** Встать ровно на меш токена (после искажений) */
  follow(token) {
    const m = this.#marks.get(token?.document?.id), mesh = token?.mesh;
    if (!m || m.sprite.destroyed) return;
    const s = m.sprite;
    if (!mesh || mesh.destroyed || !mesh.visible || !token.visible) { s.visible = false; return; }
    s.visible = true;
    if (s.parent !== canvas.primary) canvas.primary.addChild(s);
    s.anchor.copyFrom(mesh.anchor);
    s.position.copyFrom(mesh.position);
    s.scale.copyFrom(mesh.scale);
    s.skew.copyFrom(mesh.skew);
    s.rotation = mesh.rotation;
    s.alpha = mesh.alpha;
    const sort = mesh.sort + 0.5;
    if (s.elevation !== mesh.elevation || s.sort !== sort || s.sortLayer !== mesh.sortLayer) {
      s.elevation = mesh.elevation; s.sortLayer = mesh.sortLayer; s.sort = sort; s.zIndex = mesh.zIndex;
      canvas.primary.sortDirty = true;
    }
  }

  #drop(id) {
    const m = this.#marks.get(id);
    if (m && !m.sprite.destroyed) m.sprite.destroy({ texture: true, baseTexture: true });
    this.#marks.delete(id);
  }

  clear() { for (const id of [...this.#marks.keys()]) this.#drop(id); }
}
export const wounds = new Wounds();

/* ---------- Красные края экрана ---------- */

let vignetteEl = null;
function vignette(strength) {
  if (!prefs.shake || goreK() <= 0) return;
  if (!vignetteEl) {
    vignetteEl = document.createElement("div");
    vignetteEl.id = "tchoreo-vignette";
    Object.assign(vignetteEl.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "50", opacity: "0",
      background: "radial-gradient(ellipse at center, rgba(140,0,10,0) 45%, rgba(140,0,10,.85) 100%)" });
    document.body.appendChild(vignetteEl);
  }
  const el = vignetteEl;
  el.style.transition = "none";
  el.style.opacity = String(clamp(strength));
  void el.offsetWidth;
  el.style.transition = "opacity 1.3s ease-out";
  el.style.opacity = "0";
}

/* ---------- ПЗ: смерть, раны, края экрана ---------- */

/** Последние известные ПЗ актёров (чтобы понять «упал до нуля» и «ранили» на любом клиенте) */
const knownHp = new Map();

function onHp(actor) {
  const hp = actor.system?.attributes?.hp;
  if (!hp) return;
  const key = actor.uuid, was = knownHp.get(key) ?? hp.value;
  knownHp.set(key, hp.value);
  const tokens = actor.getActiveTokens?.(false, false).filter(t => t.scene === canvas.scene) ?? [];
  for (const t of tokens) wounds.refresh(t);
  if (!prefs.enabled || goreK() <= 0) return;
  // Ранили своего героя — красные края экрана (Мастеру нет: у него все)
  if (hp.value < was && !game.user.isGM && actor.isOwner && hp.max) vignette(0.3 + 0.55 * Math.min(1, (was - hp.value) / hp.max));
  if (was > 0 && hp.value <= 0) for (const t of tokens) fallen(t);
}

/** Павший: лужа (растекается), у скелета — горстка пыли; клинку того, кто добил, — ещё крови */
function fallen(token) {
  const d = token.document, vis = token.choreo, c = d.getCenterPoint(), u = vis.u;
  const x = c.x / u, y = c.y / u, rad = 44 * vis.z, id = fluidIdOf(token.actor), fl = fluidOf(id), seed = `${d.id}:${game.time.worldTime}:${d.elevation}`;
  if (fl) {
    // «Немного» крови — без луж под павшими
    if (prefs.gore === "full") decals.pool(x + 2, y + 3, rad * 1.9, fl, d.elevation, seed);
    const last = lastHits.get(d.id);
    if (last && Date.now() - last.at < 20000) stain(last.tokenId, last.kind, id, 0.3);
  } else if (DUSTS[id]?.heap) decals.dustHeap(x, y, d.elevation, DUSTS[id], rad, seededRnd(seed));
}

/* ---------- Регистрация и такт ---------- */

export function registerGore() {
  Hooks.on("updateActor", actor => onHp(actor));
  Hooks.on("canvasReady", () => {
    knownHp.clear();
    for (const t of canvas.tokens.placeables) { const hp = t.actor?.system?.attributes?.hp; if (hp) knownHp.set(t.actor.uuid, hp.value); wounds.refresh(t); }
  });
  Hooks.on("refreshToken", t => wounds.follow(t));
  Hooks.on("drawToken", t => setTimeout(() => wounds.refresh(t), 0));
  Hooks.on("deleteToken", doc => clearStains(doc.id));
  // Бой кончился — оружие чистое
  Hooks.on("deleteCombat", () => clearStains());
  // Долго без дела в бою — стряхнуть кровь
  setInterval(() => {
    if (!prefs.enabled || goreK() <= 0 || !canvas.ready || !game.combat?.started) return;
    const idle = (testing.idleShake ?? IDLE) * 1000, now = Date.now();
    for (const [tokenId, s] of allStains()) {
      if (s.gore < 0.2 || s.flourishing || now - s.last < idle) continue;
      const t = canvas.tokens.get(tokenId);
      if (t && !t.destroyed && t.visible) startFlourish(t, s);
    }
  }, 1000);
}

export function goreUpdate(dt) {
  spray.update(dt);
  decals.update(dt);
}

export function goreClear() {
  spray.clear();
  decals.clear();
  wounds.clear();
  lastHits.clear();
}

/** Для проверок и Мастера: убрать все следы со сцены */
export function cleanGround() { decals.clear(); spray.clear(); }
export { MODULE_ID };
