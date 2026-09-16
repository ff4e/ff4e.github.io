export interface PinchSample {
  ratio: number;
  x: number;
  y: number;
}

/** Continuous two-finger scale/centroid; suppress gameplay until EVERY finger lifts. */
export class TouchPinch {
  private points = new Map<number, { x: number; y: number }>();
  private start = 0;
  private blocked = false;
  active = false;

  reset(): void {
    this.points.clear();
    this.start = 0;
    this.blocked = this.active = false;
  }

  private distance(): number {
    const [a, b] = [...this.points.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private sample(): PinchSample {
    const [a, b] = [...this.points.values()];
    return { ratio: Math.max(1, this.distance()) / this.start, x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
  }

  down(id: number, x: number, y: number): PinchSample | null {
    this.points.set(id, { x, y });
    if (this.points.size === 2 && !this.active) {
      this.active = true;
      this.start = this.distance();
      if (this.start >= 1) return this.sample();
    }
    if (this.points.size > 2) this.blocked = true;
    return null;
  }

  move(id: number, x: number, y: number): PinchSample | null {
    if (!this.points.has(id)) return null;
    this.points.set(id, { x, y });
    if (!this.active || this.blocked || this.points.size !== 2 || this.start < 1) return null;
    return this.sample();
  }

  up(id: number): boolean {
    if (!this.points.has(id)) return false;
    const suppressed = this.active;
    this.points.delete(id);
    // Once either finger lifts, a replacement finger must not trigger another zoom.
    if (this.active) this.blocked = true;
    if (this.points.size === 0) this.reset();
    return suppressed;
  }
}
