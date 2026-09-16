/** Apply the phone camera to BOTH canvases, without changing the simulation geometry. */
import { stageBox, wrap } from './dom.js';
import { phoneUi } from './touchButtons.js';
import { alpha, cutscene, engine, room } from './gameState.js';
import { ui } from './screenState.js';
import { roomLoading, setForceRoomRedraw } from './framePacing.js';
import { roomArtPending } from './art.js';
import { roomEntryHeld } from './roomLoad.js';
import { roomGeometry, stage } from './stageGeometry.js';
import { PhoneCamera } from './phoneZoom.js';
import type { PinchSample } from './touchPinch.js';
import { Dir } from '../core/dir.js';
import { FALL_FRAMES } from '../core/stepEngine.js';
import { wake } from './frameClock.js';
import { CELL_NATIVE } from './layout.js';

const camera = new PhoneCamera();
let applied = '';
let phoneRoom = false;
let gestureCentre = { x: 0, y: 0 };

export function phoneRenderZoom(): number { return camera.renderZoom; }
export function phoneCameraMoving(): boolean { return camera.moving; }

export function continuePhoneRoom(previous: object, next: object): void {
  camera.continueRoom(previous, next);
}

function relativeSample(sample: PinchSample): PinchSample {
  return { ...sample, x: sample.x - gestureCentre.x, y: sample.y - gestureCentre.y };
}

export function beginPhoneGesture(sample: PinchSample): void {
  if (!phoneUi() || roomLoading || roomArtPending() || roomEntryHeld()) return;
  const box = stageBox.getBoundingClientRect();
  gestureCentre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  camera.beginGesture(relativeSample(sample));
  wake();
}

export function movePhoneGesture(sample: PinchSample): void {
  if (!camera.inspecting) return;
  camera.moveGesture(relativeSample(sample));
  wake();
}

export function endPhoneGesture(): void {
  if (!camera.inspecting) return;
  camera.endGesture(performance.now());
  wake();
}

export function cancelPhoneGesture(): void {
  if (camera.cancelGesture()) wake();
}

export function syncPhoneViewport(now: number): void {
  const want = phoneUi() && ui.screen === 'room' && !ui.helpOpen && !cutscene;
  if (phoneRoom !== want) {
    phoneRoom = want;
    document.documentElement.toggleAttribute('data-phone-room', want);
  }
  const before = camera.renderZoom;
  if (!want || !room || !engine) {
    camera.suspend();
  } else if (roomLoading || roomArtPending() || roomEntryHeld()) {
    camera.hold();
  } else {
    const g = roomGeometry(room);
    const fish = room.items[engine.active === 'little' ? room.littleIdx : room.bigIdx];
    if (!fish) camera.suspend();
    else {
      // Item positions and occupied fields are CELLS, not native pixels.
      const xs = fish.fields.map((f) => f.x);
      const ys = fish.fields.map((f) => f.y);
      const cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys) + 1) / 2;
      let slide = 0;
      if (engine.active === engine.activeAnimFish) {
        if (engine.phase === 'move') slide = (engine.animFrame + alpha) / engine.cellFrames;
        else if (engine.phase === 'fall') slide = (engine.animFrame + alpha) / FALL_FRAMES;
      }
      const dx = fish.dir === Dir.left ? -1 : fish.dir === Dir.right ? 1 : 0;
      const dy = fish.dir === Dir.up ? -1 : fish.dir === Dir.down ? 1 : 0;
      camera.update({
        owner: room, width: g.cssW, height: g.cssH,
        viewportW: stage.stageW, viewportH: stage.stageH, scale: g.scale,
        fishX: (fish.x + cx + slide * dx) * CELL_NATIVE * g.scale,
        fishY: (fish.y + cy + slide * dy) * CELL_NATIVE * g.scale, now,
      });
    }
  }
  const transform = camera.zoom === 1 ? '' :
    `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
  if (transform !== applied) {
    applied = transform;
    wrap.style.transform = transform;
  }
  // The GL presentation buffer needs the extra pixels, not a magnified low-res present.
  if (before !== camera.renderZoom) setForceRoomRedraw(true);
}
