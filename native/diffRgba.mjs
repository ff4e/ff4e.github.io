// The per-pixel diff both parity harnesses use (compare.mjs, compare-map.mjs): RGB only,
// max channel Δ per pixel, PSNR, and a ×32 visualisation of where they differ.
export function diff(a, b, w, h) {
  let max = 0, differing = 0, sq = 0;
  const vis = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[p * 4 + c] - b[p * 4 + c]);
      sq += d * d;
      if (d > m) m = d;
    }
    if (m > 0) differing++;
    if (m > max) max = m;
    const v = Math.min(255, m * 32);
    vis[p * 4] = v; vis[p * 4 + 1] = v; vis[p * 4 + 2] = v; vis[p * 4 + 3] = 255;
  }
  const mse = sq / (w * h * 3);
  return { max, differing, pct: (100 * differing) / (w * h), psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse), vis };
}
