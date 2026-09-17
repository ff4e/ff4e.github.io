/**
 * Sample static room wall art once, never a live frame.
 * Bound lightness/saturation for the glass and carved symbols independently.
 * Labels and surface opacity stay unchanged.
 */
export interface NativeMenuPalette {
  readonly hue: number | null;
  readonly glass: string;
  readonly edge: string;
  readonly popup: string;
  readonly pressed: string;
  readonly symbol: string | null;
  readonly highlight: string | null;
  readonly shade: string | null;
  readonly detail: string | null;
  readonly outline: string | null;
}

export function roomTone(rgba: Uint8Array | Uint8ClampedArray): NativeMenuPalette {
  if (rgba.length % 4 !== 0) throw new RangeError('Room palette requires complete RGBA pixels');
  const bins = Array.from({ length: 24 }, () => ({ weight: 0, x: 0, y: 0 }));
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! < 240) continue;
    const r = rgba[i]! / 255;
    const g = rgba[i + 1]! / 255;
    const b = rgba[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const light = (max + min) / 2;
    if (light < .10 || light > .88 || chroma < .08) continue;
    let hue = max === r ? ((g - b) / chroma) % 6 :
      max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
    hue = (hue * 60 + 360) % 360;
    const bin = bins[Math.floor(hue / 15)]!;
    const weight = Math.min(chroma, .45);
    bin.weight += weight;
    bin.x += Math.cos(hue * Math.PI / 180) * weight;
    bin.y += Math.sin(hue * Math.PI / 180) * weight;
  }
  const best = bins.reduce((a, b) => b.weight > a.weight ? b : a);
  // An achromatic room deliberately keeps the neutral C palette.
  if (!best.weight) return menuPalette(null);
  const hue = Math.round((Math.atan2(best.y, best.x) * 180 / Math.PI + 360) % 360) % 360;
  return menuPalette(hue);
}

export function menuPalette(hue: number | null): NativeMenuPalette {
  if (hue !== null && (!Number.isInteger(hue) || hue < 0 || hue >= 360)) {
    throw new RangeError('Native menu hue must be an integer in [0, 360)');
  }
  if (hue === null) return {
    hue: null,
    glass: 'rgb(23 29 34 / 45%)', edge: '#d0d7ce6b',
    popup: 'rgb(25 32 36 / 86%)', pressed: 'rgb(46 59 64 / 70%)',
    symbol: null, highlight: null, shade: null, detail: null, outline: null,
  };
  return {
    hue,
    glass: `hsl(${hue} 28% 13% / 45%)`,
    edge: `hsl(${hue} 28% 74% / 42%)`,
    popup: `hsl(${hue} 18% 12% / 86%)`,
    pressed: `hsl(${hue} 24% 24% / 70%)`,
    symbol: `hsl(${hue} 58% 72%)`,
    highlight: `hsl(${hue} 42% 88%)`,
    shade: `hsl(${hue} 38% 47%)`,
    detail: `hsl(${hue} 32% 30%)`,
    outline: `hsl(${hue} 30% 16%)`,
  };
}
