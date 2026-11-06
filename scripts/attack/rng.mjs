/**
 * Общая случайность атаки: зерно берётся из сообщения чата, поэтому у всех клиентов выбор вариантов (куда
 * уклонился, с какой стороны зашёл, разброс темпа) один и тот же. Мелочи вроде разлёта пыли — обычный Math.random.
 */

/** Генератор по строке (id сообщения + номер цели): mulberry32 от хеша FNV-1a */
export function seeded(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let s = h || 1;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Число в [a, b) */
    range: (a, b) => a + next() * (b - a),
    /** ±1 */
    sign: () => (next() < 0.5 ? 1 : -1),
    /** Один из вариантов */
    pick: list => list[Math.floor(next() * list.length)]
  };
}
