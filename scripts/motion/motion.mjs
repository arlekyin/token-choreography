/**
 * Ход целиком: из ходa Foundry (точки пути и способ хода на каждом отрезке) строится цепочка частей —
 * ходьба, взлёт, полёт, посадка, прыжок, лазание — и раскладка по времени.
 *
 * Foundry сама двигает токен по точкам (зрение, свет, регионы, линейка — всё как обычно), а длительность
 * каждого её отрезка берётся отсюда (durationTo), чтобы настоящее положение шло вровень с картинкой.
 */

import { SmoothPath } from "./path.mjs";
import { ClimbLeg, FlyLeg, InstantLeg, JumpLeg, LandLeg, TakeoffLeg, WalkLeg } from "./legs.mjs";

/** Способ хода Foundry → вид анимации */
function styleOf(action) {
  const cfg = CONFIG.Token.movement.actions[action];
  if (!cfg || cfg.teleport) return "instant";
  switch (action) {
    case "fly": return "fly";
    case "jump": return "jump";
    case "fall": return "fall";
    case "climb": return "climb";
    case "swim": return "swim";
    case "burrow": return "burrow";
    default: return "walk"; // walk, crawl и способы, добавленные системами и модулями
  }
}

/** Множитель скорости способа хода относительно обычной скорости Foundry */
function speedOf(action, doc, explicit) {
  const cfg = CONFIG.Token.movement.actions[action];
  const base = CONFIG.Token.movement.defaultSpeed || 6;
  let speed = explicit ?? cfg?.getAnimationOptions?.(doc)?.movementSpeed ?? base;
  speed *= cfg?.getAnimationOptions?.(doc)?.speedMultiplier ?? 1;
  return speed / base;
}

export class Motion {
  /** @type {{leg: Leg, start: number}[]} */
  legs = [];
  time = 0;
  /** Конец «настоящего» хода (без того, что видно после прихода) */
  logicalEnd = 0;
  /** Конец всей картинки */
  total = 0;
  endAloft = false;

  /** Время (с начала этого хода), когда пройдено raw пикселей исходной ломаной Foundry */
  #timeline = []; // {raw0, raw1, start, leg}
  #raw = 0;       // пройдено ломаной к прошлому отрезку Foundry
  #prev = null;   // центр прошлого отрезка Foundry

  /**
   * @param {TokenVisual} vis
   * @param {object} movement   options._movement[id] из обновления токена
   * @param {object} o          continuing — ход продолжает идущий, explicitSpeed — скорость, заданная вызвавшим
   * @returns {Motion|null}     null — анимировать нечем (телепорт, пустой ход)
   */
  static plan(vis, movement, { continuing = false, startAloft = false, explicitSpeed } = {}) {
    const doc = vis.token.document, d = canvas.dimensions, grid = d.size, u = grid / 100, z = vis.z;
    const center = p => {
      const c = doc.getCenterPoint({ x: p.x, y: p.y, elevation: p.elevation, width: p.width ?? doc.width, height: p.height ?? doc.height, shape: p.shape ?? doc.shape });
      return { x: c.x, y: c.y, z: (p.elevation ?? 0) * d.distancePixels };
    };
    const wps = movement.passed.waypoints.filter(w => !w.intermediate || w.explicit);
    if (!wps.length) return null;

    // Подряд идущие отрезки одного вида — одна часть
    const groups = [];
    let last = center(movement.origin);
    for (const w of wps) {
      const style = styleOf(w.action), pt = center(w);
      const g = groups.at(-1);
      if (g && g.style === style && g.action === w.action) g.pts.push(pt);
      else groups.push({ style, action: w.action, pts: [last, pt] });
      last = pt;
    }
    if (groups.every(g => g.style === "instant")) return null;

    const m = new Motion();
    m.#prev = center(movement.origin);
    let aloft = startAloft, crouch = !continuing;
    // Состояние «Полёт»/«Парение»: и обычный ход — по воздуху
    const hover = !!vis.statusHover;
    const push = (leg, raw = 0) => {
      const start = m.logicalEnd;
      m.legs.push({ leg, start });
      m.#timeline.push({ raw0: m.#raw, raw1: m.#raw + raw, start, leg });
      m.#raw += raw;
      m.logicalEnd = start + leg.pre + leg.dur + leg.post;
      aloft = leg.aloft;
    };
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i], next = groups[i + 1];
      const raw = rawLength(g.pts);
      const speed = speedOf(g.action, doc, explicitSpeed);
      // Парящий и при обычном ходе летит; прыжок и лазание — с земли
      let style = g.style;
      if (hover && ["walk", "swim", "burrow"].includes(style)) style = "fly";
      const radius = grid * (style === "fly" ? 0.8 : 0.5);
      const path = new SmoothPath(g.pts, radius);
      const here = new SmoothPath([g.pts[0]], 0);
      if (style !== "fly" && style !== "instant" && aloft) push(new LandLeg(here, { u, z }));
      switch (style) {
        case "fly": {
          if (!aloft) push(new TakeoffLeg(here, { u, z }));
          push(new FlyLeg(path, { u, speed }), raw);
          // Садится, только если дальше в этом же ходе идёт пешком; в конце хода остаётся в воздухе
          const nextFly = next && (next.style === "fly" || (hover && ["walk", "swim", "burrow"].includes(next.style)));
          if (next && !nextFly && next.style !== "instant") push(new LandLeg(new SmoothPath([g.pts.at(-1)], 0), { u, z }));
          break;
        }
        case "jump": push(new JumpLeg(path, { z, u, crouch: true, speed }), raw); break;
        case "fall": push(new JumpLeg(path, { z, u, crouch: false, arc: 0.25, speed }), raw); break;
        case "climb": push(new ClimbLeg(path, { u, speed }), raw); break;
        case "instant": { const leg = new InstantLeg(path); leg.aloft = aloft; push(leg, raw); break; }
        default:
          push(new WalkLeg(path, { z, u, grid, speed, crouch, prints: style === "walk", dust: style !== "swim" }), raw);
      }
      crouch = false;
    }
    // Последняя часть: то, что после прихода, — уже не «настоящий» ход
    const lastLeg = m.legs.at(-1).leg;
    m.total = m.logicalEnd;
    m.logicalEnd -= lastLeg.post;
    m.endAloft = aloft;
    return m;
  }

  /** Ход из одной части на месте (взлёт, посадка) */
  static single(leg) {
    const m = new Motion();
    m.legs.push({ leg, start: 0 });
    m.total = leg.length;
    // Новый ход ждёт конца взлёта или посадки
    m.logicalEnd = leg.length;
    m.endAloft = leg.aloft;
    return m;
  }

  /**
   * Длительность очередного отрезка Foundry (мс) до точки to — по нашей раскладке.
   * Foundry зовёт animate по точкам ломаной по порядку, так что пройденное считается накопительно.
   */
  durationTo(doc, to) {
    if (!("x" in to) && !("y" in to) && !("elevation" in to)) return 0;
    const d = canvas.dimensions;
    const c = doc.getCenterPoint({ x: to.x ?? doc.x, y: to.y ?? doc.y, elevation: to.elevation ?? doc.elevation, width: to.width ?? doc.width, height: to.height ?? doc.height, shape: to.shape ?? doc.shape });
    const p = { x: c.x, y: c.y, z: (to.elevation ?? doc.elevation) * d.distancePixels };
    const prev = this.#prev ?? p;
    const raw0 = this.#raw0 ?? 0, raw1 = raw0 + dist(prev, p);
    this.#prev = p;
    this.#raw0 = raw1;
    return Math.max(0, (this.#timeAtRaw(raw1) - this.#timeAtRaw(raw0)) * 1000);
  }
  #raw0 = 0;

  #timeAtRaw(s) {
    const tl = this.#timeline;
    if (!tl.length) return 0;
    if (s <= 0) return tl[0].start + tl[0].leg.pre;
    for (const e of tl) {
      if (e.raw1 - e.raw0 <= 1e-6) continue;
      if (s <= e.raw1 + 1e-3) return e.start + e.leg.timeAt((s - e.raw0) / (e.raw1 - e.raw0));
    }
    return this.logicalEnd;
  }

  /**
   * Новый ход пришёл, пока этот идёт: он встаёт в очередь — с конца «настоящего» хода (так же, как Foundry
   * ставит свои отрезки в цепочку), а если тот уже кончился — сразу.
   */
  append(other) {
    const start = Math.max(this.time, this.logicalEnd);
    // Хвост (проскальзывание, посадка) уходящей части обрезается
    for (const { leg, start: s } of other.legs) this.legs.push({ leg, start: start + s });
    this.logicalEnd = start + other.logicalEnd;
    this.total = start + other.total;
    this.endAloft = other.endAloft;
  }

  /** Кадр: найти текущую часть и показать её. false — ход закончился */
  update(vis, dt) {
    this.time += dt;
    const t = this.time;
    let cur = null;
    for (let i = 0; i < this.legs.length; i++) {
      const e = this.legs[i], nextStart = this.legs[i + 1]?.start ?? Infinity;
      if (t < nextStart) { cur = e; break; }
      // Часть пройдена: последний кадр, чтобы её разовые события (остановка, приземление) не пропали
      if (!e.done) { e.done = true; e.leg.frame(vis, Math.min(e.leg.length, nextStart - e.start), dt); }
    }
    if (!cur || t >= this.total) {
      const e = this.legs.at(-1);
      if (e && !e.final) { e.final = true; e.leg.frame(vis, e.leg.length, dt); }
      vis.path = null;
      vis.hop = 0; vis.sway = 0; vis.bank = 0; vis.rot = 0; vis.leanT = 0;
      if (!this.endAloft) vis.alt = 0;
      vis.aloft = this.endAloft;
      vis.keepAloft = this.endAloft;
      return false;
    }
    cur.leg.frame(vis, t - cur.start, dt);
    return true;
  }
}

function rawLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
