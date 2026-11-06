/**
 * Выстрел (ranged макета) — пока у луков, арбалетов, огнестрела и метания нет своих анимаций: отдача стрелка,
 * снаряд летит; попал — цель вздрагивает, кровь; мимо — снаряд проходит рядом, цель отшатывается.
 * Плевок монстра — комок по дуге.
 */

import { fx } from "../fx/layer.mjs";
import { R } from "./weapon.mjs";

export function ranged(A, choice) {
  const a = A.a, b = A.b, glob = choice.kind === "spit";
  const off = A.miss ? A.rng.sign() * R * 1.3 : 0;
  const B = b.home, n = { x: Math.cos(A.dir + Math.PI / 2), y: Math.sin(A.dir + Math.PI / 2) };
  const to = A.sc({ x: B.x + n.x * off, y: B.y + n.y * off });
  const from = A.sc({ x: A.home.x + A.dx * R * a.z, y: A.home.y + A.dy * R * a.z });
  let flying = true;
  A.seq([
    { dur: 0.12, fn(k) { a.squash = 0.08 * k; a.leanDir = A.dir; a.lean.p = -0.05 * k; } },
    {
      dur: 0.01,
      end() {
        a.squash = 0; a.ox.v -= A.dx * 260; a.oy.v -= A.dy * 260;
        const dist = Math.hypot(to.x - from.x, to.y - from.y) / A.u;
        if (A.miss) b.react.dodge = { kind: "side", dir: A.dir - Math.PI / 2 * Math.sign(off || 1), t: -dist / 1400 * 0.6, small: true };
        fx.projectile(from, to, A.elev, {
          speed: glob ? 520 : 1400, glob,
          onArrive: () => {
            flying = false;
            if (A.miss) return;
            const p = A.crit ? 1.4 : A.glance ? 0.5 : 1;
            A.stop(0.05);
            b.react.white = A.glance ? 0.45 : 1; if (!A.glance) b.react.red = 0.6;
            b.ox.v += A.dx * 420 * p; b.oy.v += A.dy * 420 * p; b.sx.v -= 5; b.sy.v += 3;
            if (A.glance) fx.sparks(to.x, to.y, b.token.document.elevation, A.dir + Math.PI, 6);
            else fx.blood(to.x, to.y, b.token.document.elevation, A.dir, 6, A);
          }
        });
      }
    },
    // Ждать, пока снаряд долетит (не дольше 2 с)
    { dur: 2, fn() { if (!flying) this.cut = true; } },
    { dur: 0.25 }
  ]);
}
