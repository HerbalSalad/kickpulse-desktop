// electron/lights/color.ts — small, shared color-space conversions used by
// the light providers. Hue's own local API expresses color as hue (0-65535)
// + saturation (0-254), not RGB/hex — every other part of this app (and
// WLED, which DOES take plain RGB) works in hex, so this is the one place
// that conversion lives rather than duplicating it per-provider.

export function hexToRgb(hex: string): [number, number, number] {
  const h = (hex || '').replace('#', '').padEnd(6, '0');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `${c(r)}${c(g)}${c(b)}`;
}

/** hex -> Hue's own hue(0-65535)/sat(0-254) pair, brightness handled separately. */
export function hexToHueSat(hex: string): { hue: number; sat: number } {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const sat = max === 0 ? 0 : d / max;
  return { hue: Math.round((h / 360) * 65535), sat: Math.round(sat * 254) };
}

/** Hue's hue(0-65535)/sat(0-254) pair -> a plain hex color (brightness-neutral, full value). */
export function hueSatToHex(hue: number, sat: number): string {
  const h = (hue / 65535) * 360;
  const s = sat / 254;
  const c = s; // value fixed at 1 — brightness is applied separately by the caller
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = 1 - c;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
