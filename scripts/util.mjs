/** Мелкие общие функции движения */

/** Высота парения, px макета (клетка 100) */
export const FLY_ALT = 42;

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rnd = (a, b) => a + Math.random() * (b - a);

export const ease = {
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
};

/** Угол в (−π, π] */
export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Пружина: {p, v} тянется к target с жёсткостью k и затуханием d */
export function spring(s, target, k, d, dt) {
  s.v += (k * (target - s.p) - d * s.v) * dt;
  s.p += s.v * dt;
}
export const sp = p => ({ p, v: 0 });

/**
 * Трапеция скорости: разгон за ramp, крейсер, торможение за ramp. Возвращает долю пути к моменту t ∈ [0, dur].
 * Площадь под скоростью — 1, так что к концу ровно весь путь.
 */
export function trapezoid(t, dur, ramp) {
  ramp = Math.min(ramp, dur / 2);
  if (dur <= 0) return 1;
  const vmax = 1 / (dur - ramp);
  if (t <= 0) return 0;
  if (t < ramp) return 0.5 * vmax * t * t / ramp;
  if (t < dur - ramp) return vmax * (t - ramp / 2);
  if (t >= dur) return 1;
  const r = dur - t;
  return 1 - 0.5 * vmax * r * r / ramp;
}
