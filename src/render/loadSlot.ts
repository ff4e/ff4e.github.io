/**
 * A tiny FIFO gate for asset fetch+decode.
 *
 * Room art used to be loaded one file (or one object) at a time, which on a
 * high-latency link made the first frame wait out a chain of round trips. Loading it
 * all at once fixes that but overshoots: a room can ask for ~150 files, several rooms
 * can be in flight at once, and Chromium answers that with
 * `net::ERR_INSUFFICIENT_RESOURCES` — which surfaced as whole rooms silently losing
 * their art in the 72-room parity probes, not as a clean failure.
 *
 * So: parallel, but bounded. The limit is per-process and shared by every art loader
 * (AI room art and enhanced object sprites alike), because it exists to bound the
 * BROWSER, and the browser does not care which module queued the request.
 */

/** In-flight asset loads. Above the browser's per-host connection limit, so it never
 *  starves the pipe, but far below the point where queued requests exhaust it. */
const MAX_CONCURRENT_LOADS = 8;

let active = 0;
const waiting: Array<() => void> = [];

/** Run `fn` once a slot is free. FIFO, so a room's own files are not starved. */
export async function withLoadSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_LOADS) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await fn();
  } finally {
    // Hand the slot straight to the next waiter rather than releasing and re-acquiring
    // it — otherwise a burst of new callers can jump the queue.
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
