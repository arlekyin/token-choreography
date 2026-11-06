/**
 * Метательное (thThrow макета): замах из-за плеча — шаг и бросок; оружие уходит из руки, через миг герой
 * выхватывает следующее. Кинжал и ручной топор кувыркаются, дротик (и копьё) летит высокой дугой остриём вперёд.
 * Попал — торчит из цели; мимо — в земле за целью (кувыркающееся может упасть плашмя); броня — отскакивает.
 */

import { ease, lerp } from "../util.mjs";
import { IDLE } from "./weapon.mjs";
import { loose } from "./shafts.mjs";

export function thrown(A, texture) {
  const a = A.a, w = a.rig, K = w.K, point = K.thrown === "point" || K.moves === "javelin";
  const flight = {};
  let from;
  A.seq([
    {
      dur: 0.18, start() { from = A.pos; w.to(point ? { ha: 1.9, ba: -1.75, ext: -8 } : { ha: 2.3, ba: 0.6, ext: -4 }, 900); },
      fn(k) { a.leanDir = A.dir; a.lean.p = -0.08 * k; A.place({ x: from.x - A.dx * 6 * k, y: from.y - A.dy * 6 * k }); }
    },
    {
      dur: 0.08, start() { from = A.pos; w.to({ ha: -0.25, ba: point ? 0 : -0.3, ext: 14 }, 4200); },
      fn(k) { A.place({ x: from.x + A.dx * 14 * k, y: from.y + A.dy * 14 * k }); a.lean.p = 0.14 * k; },
      end() {
        flight.S = loose(A, w.tip(), {
          sprite: K.kind, texture, speed: point ? 900 : 1000, arc: point ? 2.2 : 1,
          power: point ? 1.3 : K.kind === "handaxe" ? 1.2 : 0.9, deep: true
        });
        w.gone = true;
      }
    },
    { dur: 2, fn() { if (!flight.S?.flying && !A.b.react.dodge) this.cut = true; } },
    { dur: 0.14, start() { w.to(IDLE, 700); a.lean.p = 0; } },
    // Выхватывает следующее
    { dur: 0.16, start() { w.gone = false; w.to({ ha: 1.2, ba: 1.6, ext: -6 }, 300); }, end() { w.to(IDLE, 500); } },
    {
      dur: 0.26, start() { from = A.pos; },
      fn(k) { const e = ease.out(k); A.place({ x: lerp(from.x, A.home.x, e), y: lerp(from.y, A.home.y, e) }); a.lean.p = -0.05 * (1 - k); a.squash = 0; }
    }
  ], () => { w.gone = false; A.place(A.home); A.ax.v = A.ay.v = 0; a.lean.p = 0; a.squash = 0; });
}
