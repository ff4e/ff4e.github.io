/** Per-room phone camera: continuous zoom, temporary inspection and eased fish-follow. */
import { CELL_NATIVE } from './layout.js';
import type { PinchSample } from './touchPinch.js';

export const PHONE_ZOOM_CELL_PX = 20;
export const MAX_PHONE_ZOOM = 3;
export const CAMERA_EASE_MS = 130;
export const GESTURE_EASE_MS = 45;
export const PHONE_RECENTER_DELAY_MS = 350;
export const PHONE_ZOOM_OVERSHOOT = 0.08;

/** Resisted visual stretch; the selected zoom still remains inside 1x-3x. */
export function rubberBandZoom(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) throw new Error('Invalid phone zoom');
  const edge = Math.max(1, Math.min(MAX_PHONE_ZOOM, zoom));
  const excess = zoom / edge - 1;
  const stretch = PHONE_ZOOM_OVERSHOOT * Math.abs(excess) / (PHONE_ZOOM_OVERSHOOT + Math.abs(excess));
  return edge * (1 + Math.sign(excess) * stretch);
}

function rawZoomFor(zoom: number): number {
  const edge = Math.max(1, Math.min(MAX_PHONE_ZOOM, zoom));
  const stretch = zoom / edge - 1;
  return Math.max(Number.EPSILON, edge * (1 + stretch / Math.max(1e-6, 1 - Math.abs(stretch) / PHONE_ZOOM_OVERSHOOT)));
}

export function roomBenefitsFromZoom(standardScale: number): boolean {
  return Number.isFinite(standardScale) && standardScale > 0 && standardScale * CELL_NATIVE < PHONE_ZOOM_CELL_PX;
}

/** Translation about the room's centre; a short axis stays centred, never edge-panned. */
export function cameraAxis(roomSize: number, viewport: number, fish: number, zoom: number): number {
  return boundAxis((roomSize / 2 - fish) * zoom, roomSize, viewport, zoom);
}

function boundAxis(value: number, roomSize: number, viewport: number, zoom: number): number {
  const limit = Math.max(0, (roomSize * zoom - viewport) / 2);
  return limit === 0 ? 0 : Math.max(-limit, Math.min(limit, value));
}

export interface CameraFrame {
  owner: object;
  width: number;
  height: number;
  viewportW: number;
  viewportH: number;
  scale: number;
  fishX: number;
  fishY: number;
  now: number;
}

interface Inspection {
  previous: PinchSample;
  pending: PinchSample;
  x: number;
  y: number;
  rawZoom: number;
  zoom: number;
}

interface ReleasedView {
  until: number;
  screenX: number;
  screenY: number;
  roomX: number;
  roomY: number;
}

function validateSample(sample: PinchSample): void {
  if (!(sample.ratio > 0) || ![sample.ratio, sample.x, sample.y].every(Number.isFinite)) {
    throw new Error('Invalid phone camera gesture');
  }
}

export class PhoneCamera {
  zoom = 1;
  /** Half-step backing-store buckets, held at their high-water mark during a gesture. */
  renderZoom = 1;
  x = 0;
  y = 0;
  moving = false;
  private owner: object | null = null;
  private frame: CameraFrame | null = null;
  private suspended = true;
  private lastTime = 0;
  private targetZoom = 1;
  private inspection: Inspection | null = null;
  private released: ReleasedView | null = null;

  get inspecting(): boolean { return this.inspection !== null; }

  /** Undo replaces the simulation object without entering a new room. */
  continueRoom(previous: object, next: object): void {
    if (this.owner !== previous) return;
    this.cancelGesture();
    this.owner = next;
    if (this.frame) this.frame = { ...this.frame, owner: next };
  }

  /** Other screens need a neutral transform; only this same room can restore its zoom. */
  suspend(): void {
    this.cancelGesture();
    this.frame = null;
    this.suspended = true;
    this.zoom = 1;
    this.renderZoom = 1;
    this.x = this.y = 0;
    this.moving = false;
  }

  /** Keep the last visible framing while this room's art/backend is being prepared. */
  hold(): void {
    this.cancelGesture();
    this.frame = null;
    this.moving = false;
  }

  beginGesture(sample: PinchSample): boolean {
    validateSample(sample);
    if (!this.frame || !roomBenefitsFromZoom(this.frame.scale)) return false;
    this.targetZoom = Math.max(1, Math.min(MAX_PHONE_ZOOM, this.zoom));
    this.released = null;
    this.inspection = {
      previous: { ...sample }, pending: { ...sample }, x: this.x, y: this.y,
      rawZoom: rawZoomFor(this.zoom), zoom: this.zoom,
    };
    return true;
  }

  moveGesture(sample: PinchSample): void {
    validateSample(sample);
    if (this.inspection) this.inspection.pending = { ...sample };
  }

  endGesture(now = this.lastTime): void {
    this.finishGesture(now + PHONE_RECENTER_DELAY_MS);
  }

  cancelGesture(): boolean {
    const changed = this.inspection !== null || this.released !== null;
    this.finishGesture(null);
    return changed;
  }

  private finishGesture(until: number | null): void {
    // A quick pinch can finish before the next paint. Do not lose its final sample.
    if (this.frame) this.applyGesture(this.frame);
    const g = this.inspection;
    this.released = g && until !== null ? {
      until, screenX: g.previous.x, screenY: g.previous.y,
      roomX: (g.previous.x - g.x) / g.zoom, roomY: (g.previous.y - g.y) / g.zoom,
    } : null;
    this.inspection = null;
    if (this.released) this.moving = true;
  }

  private applyGesture(f: CameraFrame): void {
    const g = this.inspection;
    if (!g) return;
    const next = g.pending;
    if (next.ratio === g.previous.ratio && next.x === g.previous.x && next.y === g.previous.y) return;
    g.rawZoom *= next.ratio / g.previous.ratio;
    const zoom = rubberBandZoom(g.rawZoom);
    const ratio = zoom / g.zoom;
    // Keep the room point under the centroid; pan limits rebase while zoom limits stretch.
    g.x = zoom <= 1 ? 0 : boundAxis(next.x - (g.previous.x - g.x) * ratio, f.width, f.viewportW, zoom);
    g.y = zoom <= 1 ? 0 : boundAxis(next.y - (g.previous.y - g.y) * ratio, f.height, f.viewportH, zoom);
    g.previous = next;
    g.zoom = zoom;
    this.targetZoom = Math.max(1, Math.min(MAX_PHONE_ZOOM, g.rawZoom));
  }

  update(f: CameraFrame): void {
    if (this.owner !== f.owner) {
      this.owner = f.owner;
      this.targetZoom = 1;
      this.inspection = null;
      this.released = null;
      this.suspended = true;
    } else if (this.frame && (this.frame.viewportW !== f.viewportW || this.frame.viewportH !== f.viewportH ||
      this.frame.width !== f.width || this.frame.height !== f.height)) {
      this.cancelGesture();
    }
    this.frame = f;
    if (!roomBenefitsFromZoom(f.scale)) {
      this.targetZoom = 1;
      this.inspection = null;
      this.released = null;
    }
    if (this.released && f.now >= this.released.until) this.released = null;
    // Both fingers emit separate pointer events. Consume their latest combined sample
    // once per frame, not once per finger (which would turn a pan at max zoom into zoom-out).
    this.applyGesture(f);
    const dt = Math.min(32, Math.max(0, f.now - this.lastTime));
    const zoomTarget = this.inspection?.zoom ?? this.targetZoom;
    const zoomEase = this.suspended ? 1 : 1 - Math.exp(-dt / GESTURE_EASE_MS);
    this.zoom += (zoomTarget - this.zoom) * zoomEase;
    if (Math.abs(zoomTarget - this.zoom) * Math.max(f.width, f.height) < 0.1) this.zoom = zoomTarget;
    const held = this.inspection ?? (this.released ? {
      x: this.released.screenX - this.released.roomX * this.zoom,
      y: this.released.screenY - this.released.roomY * this.zoom,
    } : null);
    const x = this.zoom <= 1 ? 0 : held
      ? boundAxis(held.x, f.width, f.viewportW, this.zoom)
      : cameraAxis(f.width, f.viewportW, f.fishX, this.zoom);
    const y = this.zoom <= 1 ? 0 : held
      ? boundAxis(held.y, f.height, f.viewportH, this.zoom)
      : cameraAxis(f.height, f.viewportH, f.fishY, this.zoom);
    const panEase = this.suspended ? 1 : 1 - Math.exp(-dt / (held ? GESTURE_EASE_MS : CAMERA_EASE_MS));
    this.x = boundAxis(this.x + (x - this.x) * panEase, f.width, f.viewportW, this.zoom);
    this.y = boundAxis(this.y + (y - this.y) * panEase, f.height, f.viewportH, this.zoom);
    if (Math.abs(x - this.x) < 0.1) this.x = x;
    if (Math.abs(y - this.y) < 0.1) this.y = y;
    // Elastic feedback is compositor-only: it must not allocate beyond the 3x budget.
    const needed = Math.max(1, Math.min(MAX_PHONE_ZOOM, Math.ceil(Math.max(this.zoom, zoomTarget) * 2) / 2));
    if (this.inspection || this.zoom !== zoomTarget) {
      this.renderZoom = Math.max(this.renderZoom, needed);
    } else {
      this.renderZoom = needed;
    }
    this.moving = this.released !== null || this.zoom !== zoomTarget || this.x !== x || this.y !== y;
    this.lastTime = f.now;
    this.suspended = false;
  }
}
