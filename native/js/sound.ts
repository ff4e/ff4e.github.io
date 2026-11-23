/**
 * The native game's sound, around the browser's own policy (`AudioEngine`, built on the SDL
 * mixer by `seams/audioEngine.ts`): what the browser's boot, options and composition root do
 * with that policy and the native one needs too — the global packages, the persisted volume
 * levels, the menu music, the lip sync — and the mixer's clock.
 *
 * The room's own sound needs nothing here: `roomLoad` fetches and installs its voice package
 * and starts its music, as in the browser, and the room script's calls reach the policy
 * through `game.ts`'s `buildRoom`.
 */
import { audio, initAudio, mixer } from './seams/audioEngine.js';
import { count, poslMluv, room } from '../../src/app/gameState.js';
import { MLUVI_PRIOR } from '../../src/app/keyTables.js';
import { requireSoundPkg } from '../../src/app/roomLoad.js';
import { voiceUrl } from '../../src/audio/ffs2.js';
import { musicUrl } from '../../src/audio/music.js';
import { busMultiplier, loadSettings, VOLUMES } from '../../src/core/settings.js';

let musicVolume: number = VOLUMES[0];

/**
 * Build the engine and give it the player's volume levels (the Options sliders' indices,
 * as the browser persisted them; there are no sliders natively yet).
 * restates src/app/playerSettings.ts `export function applyVolumeSettings(` @ a87618fd2222
 */
export function initSound(): void {
  initAudio();
  const settings = loadSettings();
  for (const bus of ['effect', 'voice', 'music'] as const) {
    audio.setBusGain(bus, busMultiplier(bus, settings.volume[bus]));
  }
  musicVolume = VOLUMES[Math.max(0, Math.min(VOLUMES.length - 1, settings.volume.music))]!;
}

/**
 * music_volume on the original's 0..64 scale, which room scripts compare against (VES).
 * restates src/app/playerSettings.ts `export function musicLevel(` @ 2b2fb2bb6a51
 */
export function musicLevel(): number {
  return musicVolume; // no cheats natively, so never the silent film's 0
}

/**
 * The persistent global packages, in the browser boot's order: x00 effects, x03 fish
 * chatter, x02 death commentary — then the two restored 1998 lines, which the browser
 * fetches off its critical path. Here all four are awaited before the first room, so a
 * headless run is the same from its first tick.
 * restates src/app/boot.ts `const GLOBAL_PKGS:` @ 3ec7d8c94b80
 */
export async function loadGlobalSounds(): Promise<void> {
  const GLOBAL_PKGS: ReadonlyArray<[string, string]> = [
    ['x00', 'the sound effects'],
    ['x03', 'the fish chatter'],
    ['x02', 'the death commentary'],
  ];
  for (const [id, what] of GLOBAL_PKGS) {
    await requireSoundPkg(id, `/data/Title/${id}.fft`, voiceUrl(id), what);
  }
  // restates src/app/boot.ts `void requireSoundPkg('restored'` @ 6be09af4be9b
  await requireSoundPkg('restored', '/restored/restored.fft', voiceUrl('restored', '/restored'), 'the restored 1998 lines', true);
}

// restates src/app/mapNav.ts `export function startMenuMusic(` @ c331fcfc349f
export function startMenuMusic(): void {
  void audio.playMusic('menu', musicUrl('menu'), 419772);
}

/**
 * posl_mluv (URoom.pas:25734-25743): while a fish's voice is sounding, cycle its mouth frame
 * (0..2) randomly every other tick; -1 when silent. `fishFrame` draws the talking head from it.
 * restates src/app/main.ts `function updateLipSync(` @ 57f535165ba1
 */
export function updateLipSync(): void {
  if (!room) return;
  for (const which of ['little', 'big'] as const) {
    const alive = which === 'little' ? room.alive.little : room.alive.big;
    const talking = alive && (audio.talking(MLUVI_PRIOR[which]) || audio.talking(3));
    if (talking) {
      if (poslMluv[which] === -1) poslMluv[which] = Math.floor(Math.random() * 3);
      else if (count % 2 === 1) {
        poslMluv[which] = Math.random() < 0.5 ? (poslMluv[which] + 1) % 3 : (poslMluv[which] + 2) % 3;
      }
    } else {
      poslMluv[which] = -1;
    }
  }
}

/**
 * `ms` of game time has passed. Headless, that is what moves the mixer's clock (one 80 ms
 * step is 1764 frames); with an output the device does, and this does nothing.
 */
export function soundTime(ms: number): void {
  if (mixer.mode === 'manual') mixer.advance(ms);
}

/** Deliver what the mixer finished since the last frame (`onEnded`). Once per frame. */
export function soundPoll(): void {
  mixer.poll();
}
