/**
 * Who owns the AudioEngine.
 *
 * It is a `let` behind `initAudio()` rather than a module-scope `new AudioEngine()`
 * because an imported module is evaluated before any statement of its importer, and a
 * constructor here would run ahead of the boot order `main.ts` sequences. `initAudio()` is called
 * from exactly the point in `main.ts` the `new AudioEngine()` line used to sit at, so
 * the order is unchanged. Restoring the persisted volume levels stays in `main.ts` on
 * the line after, where it always was.
 *
 * Everything else imports `audio` directly. It was the single biggest edge carrier in
 * `main.ts`'s core — seven regions reached for it — and none of them cared where it
 * was built.
 */
import { AudioEngine } from '../audio/audio.js';

/**
 * The one AudioEngine. Assigned by `initAudio()` during boot, before anything can
 * play a sound; the non-null assertion says so rather than making every caller
 * re-check what boot already guarantees.
 */
export let audio!: AudioEngine;

/** Build the engine. Called once, from `main.ts`, during boot. */
export function initAudio(): void {
  audio = new AudioEngine();
}
