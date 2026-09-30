/**
 * Present only the visible part of a zoomed room to #screen-gl.
 *
 * The phone camera magnifies the whole wrap with a CSS transform, and the GL backing store
 * is enlarged by the same bucket so the magnified room stays sharp. Presenting the WHOLE
 * room at that resolution scales with zoom squared while the screen does not: measured at
 * 3x on an 852x393 @3x viewport, room 7 presented 7668x2212 (17.0 MP) and room 5 4716x3537
 * (16.7 MP) every frame the fish moved, against ~3 MP actually on screen. So when zoomed,
 * the canvas covers a viewport-sized window of the room instead, placed where the camera
 * looks, and the present pass draws exactly those pixels of the full-size present.
 */

/** A rectangle of the room in its own CSS px (before the camera transform). */
export interface GlCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the present lands, in backing-store px of the full (uncropped) room. */
export interface GlPlacement {
  fullW: number;
  fullH: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The room window the camera can see, or null to present the whole room as before.
 *
 * The size depends only on the render-zoom bucket, never on the live zoom, so a pinch or
 * an eased zoom inside one bucket does not reallocate the drawing buffer every frame. It is
 * sized for the bucket's LOWEST zoom (renderZoom - 0.5), which is what makes it cover every
 * zoom inside the bucket and leaves slack for a room shake or a layout that is not exactly
 * centred. Below that floor — a zoom-out settling under a bucket held at its high-water
 * mark — the whole room is presented, exactly as it was before cropping existed.
 */
export function phoneCropFor(
  cssW: number, cssH: number, viewW: number, viewH: number,
  zoom: number, renderZoom: number, camX: number, camY: number,
): GlCrop | null {
  const floor = renderZoom - 0.5;
  if (renderZoom <= 1 || !(zoom >= floor) || !(cssW > 0) || !(cssH > 0)) return null;
  const w = Math.min(cssW, viewW / floor);
  const h = Math.min(cssH, viewH / floor);
  if (w >= cssW && h >= cssH) return null;
  // translate(camX, camY) scale(zoom) about the room's centre puts the viewport's centre
  // over this room point.
  const cx = cssW / 2 - camX / zoom;
  const cy = cssH / 2 - camY / zoom;
  return {
    x: Math.max(0, Math.min(cssW - w, cx - w / 2)),
    y: Math.max(0, Math.min(cssH - h, cy - h / 2)),
    w, h,
  };
}

/**
 * Snap a crop to whole backing px of the full present, so every pixel it draws is the
 * pixel the uncropped present would have drawn there. Without a crop this is the full
 * canvas at the origin — the sizing presentToGlCanvas always used.
 */
export function glPlacement(cssW: number, cssH: number, scale: number, crop: GlCrop | null): GlPlacement {
  const fullW = Math.round(cssW * scale);
  const fullH = Math.round(cssH * scale);
  if (!crop) return { fullW, fullH, x: 0, y: 0, w: fullW, h: fullH };
  const w = Math.max(1, Math.min(fullW, Math.ceil(crop.w * scale)));
  const h = Math.max(1, Math.min(fullH, Math.ceil(crop.h * scale)));
  return {
    fullW, fullH, w, h,
    x: Math.max(0, Math.min(fullW - w, Math.round(crop.x * scale))),
    y: Math.max(0, Math.min(fullH - h, Math.round(crop.y * scale))),
  };
}
