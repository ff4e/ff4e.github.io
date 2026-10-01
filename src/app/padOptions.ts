/**
 * The touch Options, driven by a controller.
 *
 * A TV derives its UI from the tablet's, and the tablet's Options is plain HTML controls
 * (`touchOptions.ts`) — so the controller does not get an Options screen of its own. It
 * moves a highlight over the same controls and works them the way a finger would: the
 * value change goes through the control's own `input`/`change` listener, which is the one
 * that dispatches through `panelAction`. Nothing here sets a volume or a subtitle mode.
 *
 *   up / down   choose a row
 *   left/right  change a slider or the subtitle language
 *   Ⓐ           press a button (Help, Done); also steps the subtitle language
 *   Ⓑ / ☰       close
 *
 * The privacy link is left out: it opens a browser tab, which a console has nowhere to put.
 */
import { DirRepeat, type PadSnapshot } from '../platform/gamepad.js';
import { closeTouchOptions, touchOptionsOpen } from './touchOptions.js';
import { wake } from './frameClock.js';

/** One stop of the highlight: a slider, the subtitle radios, or a button. */
type Row = { kind: 'range'; el: HTMLInputElement } | { kind: 'radios'; els: HTMLInputElement[] } | { kind: 'button'; el: HTMLButtonElement };

const FOCUS_CLASS = 'pad-focus';
const repeat = new DirRepeat();
let row = 0;
let wasOpen = false;

function rows(): Row[] {
  const out: Row[] = [];
  for (const id of ['topt-effect', 'topt-voice', 'topt-music']) {
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement) out.push({ kind: 'range', el });
  }
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="topt-subs"]')];
  if (radios.length) out.push({ kind: 'radios', els: radios });
  for (const id of ['topt-help', 'topt-close']) {
    const el = document.getElementById(id);
    if (el instanceof HTMLButtonElement) out.push({ kind: 'button', el });
  }
  return out;
}

/** The element that carries the highlight for a row: the radio group's fieldset. */
function rowElement(r: Row): HTMLElement {
  if (r.kind === 'radios') return (r.els[0]!.closest('fieldset') as HTMLElement | null) ?? r.els[0]!;
  return r.el;
}

function highlight(all: Row[]): void {
  document.querySelectorAll(`#touchopts .${FOCUS_CLASS}`).forEach((el) => el.classList.remove(FOCUS_CLASS));
  const r = all[row];
  if (!r) return;
  const el = rowElement(r);
  el.classList.add(FOCUS_CLASS);
  el.scrollIntoView?.({ block: 'nearest' });
}

function stepRange(el: HTMLInputElement, delta: number): void {
  const before = el.value;
  if (delta > 0) el.stepUp();
  else el.stepDown();
  if (el.value !== before) el.dispatchEvent(new Event('input', { bubbles: true }));
}

function stepRadios(els: HTMLInputElement[], delta: number): void {
  const i = Math.max(0, els.findIndex((e) => e.checked));
  const next = els[(i + delta + els.length) % els.length]!;
  next.checked = true;
  next.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Clear the highlight once the overlay is gone, whoever closed it. */
function leave(): void {
  wasOpen = false;
  document.querySelectorAll(`.${FOCUS_CLASS}`).forEach((el) => el.classList.remove(FOCUS_CLASS));
}

/**
 * One poll's worth of controller input while the Options overlay is up. Returns false
 * when it is not up, so the caller routes the input elsewhere.
 */
export function handleOptionsPad(pad: PadSnapshot, now: number): boolean {
  if (!touchOptionsOpen()) {
    if (wasOpen) leave();
    return false;
  }
  const all = rows();
  if (!wasOpen) {
    wasOpen = true;
    row = 0;
    repeat.reset();
    highlight(all);
  }
  if (pad.pressed('b') || pad.pressed('menu')) {
    closeTouchOptions();
    leave();
    wake();
    return true;
  }
  const step = repeat.step(pad.leftDir ?? pad.rightDir, now);
  const r = all[row];
  if (step === 'up' || step === 'down') {
    row = (row + (step === 'down' ? 1 : all.length - 1)) % all.length;
    highlight(all);
  } else if ((step === 'left' || step === 'right') && r) {
    const d = step === 'right' ? 1 : -1;
    if (r.kind === 'range') stepRange(r.el, d);
    else if (r.kind === 'radios') stepRadios(r.els, d);
  }
  if (pad.pressed('a') && r) {
    if (r.kind === 'button') {
      r.el.click();
      if (!touchOptionsOpen()) leave();
    } else if (r.kind === 'radios') stepRadios(r.els, 1);
  }
  if (step || pad.anyPressed) wake();
  return true;
}
