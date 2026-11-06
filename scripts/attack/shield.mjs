/**
 * Щит защитника (shield* макета). Сверху круглый щит виден наискось — овал поперёк взгляда. В покое — у левого бока,
 * в защите — перед собой слева. Удар в щит — глухо, щепки, защитника сдвигает по силе удара; стрелы и болты
 * застревают в щите. Щит без оружия сам служит «оружием» защиты (поднять, отбить); с оружием — поднимается вместе
 * с блоком клинком.
 */

import { fx } from "../fx/layer.mjs";
import { prefs } from "../settings.mjs";
import { clamp, lerp, rnd, sp, spring } from "../util.mjs";
import { IDLE, PUSH, R } from "./weapon.mjs";

const calm = () => prefs.calm;

export class ShieldRig {
  isShield = true;
  constructor(vis, { face = 0 } = {}) {
    this.vis = vis;
    this.up = sp(0); this.T = 0; this.kick = sp(0);
    this.stuck = [];
    this.face = this.faceLock = face;
    this.show = 0; this.leaving = false; this.done = false;
    this.gfx = new PIXI.Graphics(); this.gfx.eventMode = "none";
  }

  /** Как у оружия: защита и отбив — щит вперёд, покой — к боку */
  to(pose) { this.T = pose === IDLE ? 0 : 1; if (pose === PUSH) this.kick.v += 9; }
  release() { this.leaving = true; this.T = 0; }

  geo() {
    const v = this.vis, at = v.view ?? v.at, f = this.face + v.spin, up = this.up.p, z = v.z;
    const ang = f - lerp(1.3, 0.35, up), r = R * z * lerp(0.92, 1.1, up) + this.kick.p * 9 * z;
    return { x: at.x + Math.cos(ang) * r, y: at.y - v.hop + Math.sin(ang) * r, rot: ang + Math.PI / 2, ang, z };
  }
  mid() { return this.geo(); }

  update(dt) {
    // С оружием в другой руке: щит поднимается вместе с блоком клинком
    const w = this.vis.rig;
    if (w && w !== this && !w.isShield && w.T?.ba !== undefined) this.T = w.T.ba < -1 ? 1 : this.T;
    if (w && w !== this) this.faceLock = w.faceLock;
    this.face += Math.atan2(Math.sin(this.faceLock - this.face), Math.cos(this.faceLock - this.face)) * clamp(dt * 8);
    spring(this.up, this.T, 380, 30, dt);
    spring(this.kick, 0, 420, 24, dt);
    for (const q of this.stuck) q.age += dt;
    this.show = this.leaving ? Math.max(0, this.show - dt / 0.25) : Math.min(1, this.show + dt / 0.1);
    if (this.leaving && this.show <= 0) this.done = true;
  }

  render() {
    const v = this.vis, t = v.token, u = v.u, g = this.gfx;
    const seen = t.visible && t.mesh?.visible && this.show > 0.01;
    const parent = this.held ? fx.ground(t.document.elevation) : fx.over(t.document.elevation);
    if (!seen) { g.parent?.removeChild(g); return; }
    if (g.parent !== parent) parent.addChild(g);
    const G = this.geo(), rx = R * 0.52 * G.z, ry = R * 0.22 * G.z, c = Math.cos(G.rot), s = Math.sin(G.rot);
    const P = (x, y) => [(G.x + c * x - s * y) * u, (G.y + s * x + c * y) * u];
    const oval = (cx, cy, ax, ay) => { const pts = []; for (let i = 0; i < 24; i++) { const an = i / 24 * 6.283; pts.push(...P(cx + Math.cos(an) * ax, cy + Math.sin(an) * ay)); } return pts; };
    g.clear(); g.alpha = this.show;
    g.lineStyle(0); g.beginFill(0x0a0e1e, 0.3); g.drawPolygon(oval(3, 5, rx, ry)); g.endFill();
    g.beginFill(0x7a4f2b); g.drawPolygon(oval(0, 0, rx, ry)); g.endFill();
    g.lineStyle({ width: 1 * u, color: 0x28180c, alpha: 0.6 });
    for (const x of [-0.5, 0, 0.5]) { g.moveTo(...P(x * rx, -ry * Math.sqrt(1 - x * x) * 0.95)); g.lineTo(...P(x * rx, ry * Math.sqrt(1 - x * x) * 0.95)); }
    g.lineStyle({ width: 2.6 * u, color: 0xaeb4ba }); g.drawPolygon(oval(0, 0, rx, ry));
    g.lineStyle({ width: 1 * u, color: 0x3b3f44 }); g.beginFill(0xc9ced3); g.drawPolygon(oval(0, 0, rx * 0.2, ry * 0.45)); g.endFill();
    // Застрявшие стрелы и болты: от щита наружу, к стрелку
    for (const q of this.stuck) {
      const al = 1 - clamp((q.age - 5.4) / 0.6);
      if (al <= 0) continue;
      const a = q.rel + this.face, x = G.x + Math.cos(G.rot) * q.off * rx, y = G.y + Math.sin(G.rot) * q.off * rx, L = R * (q.bolt ? 0.45 : 0.75);
      const ca = Math.cos(a + Math.PI + q.tilt), sa = Math.sin(a + Math.PI + q.tilt);
      g.lineStyle({ width: (q.bolt ? 3 : 2.2) * u, color: q.bolt ? 0x8a6a44 : 0xd2bc90, alpha: al });
      g.moveTo(x * u, y * u); g.lineTo((x + ca * L) * u, (y + sa * L) * u);
    }
    this.stuck = this.stuck.filter(q => q.age < 6);
  }

  destroy() { if (!this.gfx.destroyed) this.gfx.destroy(); }
}

/** Принимает ли удар щитом: щит есть, и (если есть ещё клинок) так выпало */
export function useShield(A) {
  const b = A.b;
  if (!b.shield) return false;
  if (b.rig && !b.rig.isShield) return A.rng.next() < 0.5;
  return true;
}

/** Удар в щит: щепки, вспышка, щит отдаёт назад; сильный — защитника сдвигает. Возвращает точку удара */
export function shieldHit(A, dir, p) {
  const b = A.b, Q = b.shield, G = Q.geo(), e = b.token.document.elevation, u = A.u;
  Q.T = 1; Q.kick.v -= 12 * p;
  const n = Math.round((calm() ? 4 : 9) * p);
  for (let i = 0; i < n; i++) {
    const an = dir + Math.PI + rnd(-1.2, 1.2), v = rnd(90, 260) * u, g = new PIXI.Graphics(), size = rnd(2, 4) * u, rot0 = rnd(0, 6);
    g.beginFill(0x784f2a); g.drawRect(-size, -size * 0.4, size * 2, size * 0.8); g.endFill();
    g.position.set(G.x * u, G.y * u);
    const vx = Math.cos(an) * v, vy = Math.sin(an) * v;
    fx.add(g, rnd(0.3, 0.55), (k, dt, en) => { g.x += vx * dt * Math.pow(0.93, en.age * 200); g.y += vy * dt * Math.pow(0.93, en.age * 200); g.rotation = rot0 + en.age * 14; g.alpha = 1 - k; }, { elevation: e });
  }
  fx.ring(G.x * u, G.y * u, e, { r: 10 + 4 * p, life: 0.16, w: 4, grow: 20, hit: true });
  if (p > 1.05) { b.react.retreat = { t: 0, dur: 0.24, dist: 9 * p * p, dir, sharp: true }; b.react.stagger = { t: 0, amp: 0.05 * p, dir, twist: 0 }; }
  b.react.ringFlash = 0.5;
  A.later(0.4, () => { if (b.shield) b.shield.T = 0; });
  return G;
}

/** Стрела или болт застревает в щите */
export function stickInShield(A, dir, bolt) {
  const Q = A.b.shield;
  Q.stuck.push({ rel: dir - Q.face, off: rnd(-0.5, 0.5), tilt: rnd(-0.2, 0.2), age: 0, bolt });
}
