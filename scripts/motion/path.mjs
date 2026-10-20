/**
 * Путь хода со скруглёнными поворотами и движением по длине.
 *
 * Точки — центры токена в пикселях холста, z — высота в тех же пикселях (чтобы подъём в полёте тоже занимал
 * время). Каждый поворот заменяется дугой: кривая начинается и кончается на отрезках, не дальше радиуса от угла,
 * так что длинные прямые остаются прямыми, а шаг по клеткам — плавным.
 */

import { clamp, lerp } from "../util.mjs";

export class SmoothPath {
  /**
   * @param {{x:number, y:number, z?:number}[]} points
   * @param {number} radius   радиус скругления поворотов, px
   */
  constructor(points, radius) {
    const pts = points.map(p => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const l1 = dist(a, b), l2 = dist(b, c);
      if (l1 < 1e-3 || l2 < 1e-3) { out.push(b); continue; }
      const r1 = Math.min(radius, l1 / 2), r2 = Math.min(radius, l2 / 2);
      const m1 = toward(b, a, r1 / l1), m2 = toward(b, c, r2 / l2);
      for (let k = 0; k <= 1.0001; k += 0.125) {
        const u = 1 - k;
        out.push({
          x: u * u * m1.x + 2 * u * k * b.x + k * k * m2.x,
          y: u * u * m1.y + 2 * u * k * b.y + k * k * m2.y,
          z: u * u * m1.z + 2 * u * k * b.z + k * k * m2.z
        });
      }
    }
    if (pts.length > 1) out.push(pts.at(-1));
    this.points = out;
    // Длина по плоскости (для шагов) и полная, с высотой (для времени)
    this.L = [0];
    this.L2 = [0];
    for (let i = 1; i < out.length; i++) {
      this.L.push(this.L[i - 1] + dist(out[i - 1], out[i]));
      this.L2.push(this.L2[i - 1] + Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
    }
    this.total = this.L.at(-1);
    this.total2 = this.L2.at(-1);
    this.dir0 = this.#dirAt(1);
  }

  /** Точка на расстоянии d от начала (по полной длине): x, y, z и направление на плоскости */
  at(d) {
    const L = this.L, P = this.points;
    if (P.length === 1) return { ...P[0], dir: 0, d2: 0 };
    let i = 1;
    while (i < L.length - 1 && L[i] < d) i++;
    const k = clamp((d - L[i - 1]) / ((L[i] - L[i - 1]) || 1));
    const a = P[i - 1], b = P[i];
    return {
      x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k),
      dir: this.#dirAt(i),
      d2: lerp(this.L2[i - 1], this.L2[i], k)
    };
  }

  /** Направление отрезка i; вертикальный отрезок (взлёт на месте) берёт направление соседнего */
  #dirAt(i) {
    const P = this.points;
    for (let j = i; j < P.length; j++) {
      const dx = P[j].x - P[j - 1].x, dy = P[j].y - P[j - 1].y;
      if (Math.abs(dx) + Math.abs(dy) > 1e-3) return Math.atan2(dy, dx);
    }
    for (let j = i - 1; j >= 1; j--) {
      const dx = P[j].x - P[j - 1].x, dy = P[j].y - P[j - 1].y;
      if (Math.abs(dx) + Math.abs(dy) > 1e-3) return Math.atan2(dy, dx);
    }
    return 0;
  }
}

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
const toward = (from, to, k) => ({ x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), z: lerp(from.z, to.z, k) });
