interface Box { body: number; end: number }

/**
 * The staged AAC's media duration is sample-exact, but its movie/edit durations
 * are rounded to milliseconds. Core Audio obeys that rounded edit and truncates
 * up to a millisecond of real speech (x01/cil-v-hlaska0 loses 9 samples).
 * Express this single-track movie's durations in the media timescale instead.
 * Priming, AAC packets, box sizes and offsets are untouched; only the Mac bridge
 * receives this copy. This deliberately accepts only our one-edit, v0 layout.
 */
export function nativeAudioTiming(input: ArrayBuffer): ArrayBuffer {
  const view = new DataView(input);
  function invalid(reason: string): never {
    throw new Error(`Native audio timing: ${reason}`);
  }
  function box(parent: Box, type: string): Box {
    let found: Box | undefined;
    for (let offset = parent.body; offset < parent.end;) {
      if (offset + 8 > parent.end) invalid('truncated MP4 box');
      const size = view.getUint32(offset);
      if (size < 8 || size > parent.end - offset) invalid('invalid MP4 box size');
      const name = String.fromCharCode(...new Uint8Array(input, offset + 4, 4));
      if (name === type) {
        if (found) invalid(`multiple ${type} boxes`);
        found = { body: offset + 8, end: offset + size };
      }
      offset += size;
    }
    return found ?? invalid(`missing ${type} box`);
  }
  function version0(value: Box, size: number): number {
    if (value.end - value.body < size) invalid('truncated timing box');
    if (view.getUint8(value.body) !== 0) invalid('unsupported timing box version');
    return value.body;
  }
  const movie = box({ body: 0, end: input.byteLength }, 'moov');
  const track = box(movie, 'trak');
  const mvhd = version0(box(movie, 'mvhd'), 20);
  const tkhd = version0(box(track, 'tkhd'), 24);
  const mdhd = version0(box(box(track, 'mdia'), 'mdhd'), 20);
  const elst = version0(box(box(track, 'edts'), 'elst'), 20);
  if (view.getUint32(elst + 4) !== 1 || view.getUint32(elst + 16) !== 0x10000) {
    invalid('expected one normal-rate edit');
  }
  const movieRate = view.getUint32(mvhd + 12);
  const mediaRate = view.getUint32(mdhd + 12);
  const priming = view.getInt32(elst + 12);
  const frames = view.getUint32(mdhd + 16) - priming;
  if (!movieRate || !mediaRate || priming < 0 || frames <= 0) invalid('invalid audio duration');
  const editedFrames = view.getUint32(elst + 8) * mediaRate / movieRate;
  if (Math.abs(frames - editedFrames) > mediaRate / movieRate + 1) {
    invalid('edit is not the full audio after priming');
  }
  const output = input.slice(0);
  const exact = new DataView(output);
  exact.setUint32(mvhd + 12, mediaRate);
  exact.setUint32(mvhd + 16, frames);
  exact.setUint32(tkhd + 20, frames);
  exact.setUint32(elst + 8, frames);
  return output;
}
