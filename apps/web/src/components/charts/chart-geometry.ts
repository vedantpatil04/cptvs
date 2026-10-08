/** Clean axis ticks from 0 to at least `max` (integers, about four steps). */
export const niceTicks = (max: number, steps = 4): number[] => {
  if (max <= 0) return [0, 1];
  const raw = max / steps;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(
    1,
    ([1, 2, 5, 10].find((factor) => factor * magnitude >= raw) ?? 10) * magnitude,
  );
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
};

/** SVG path of a rectangle whose top corners are rounded and bottom is square. */
export const topRoundedRect = (
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string => {
  if (height <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    'Z',
  ].join(' ');
};
