/**
 * A tiny FIFO gate for asset fetch+decode.
 *
 * Room art used to be loaded one file (or one object) at a time, which on a
 * high-latency link made the first frame wait out a chain of round trips. Loading it
 * all at once fixes that but overshoots: some rooms ask for ~190 room-specific AI
 * files (plus the 134-file shared fish set on a cold scale), several rooms can be in
 * flight at once, and Chromium answers that with `net::ERR_INSUFFICIENT_RESOURCES` —
 * which surfaced as whole rooms silently losing their art in the 72-room parity
 * probes, not as a clean failure.
 *
 * So: parallel, but bounded. The limit is per-process and shared by every art loader
 * (AI room art and enhanced object sprites alike), because it exists to bound the
 * BROWSER, and the browser does not care which module queued the request.
 */

/** In-flight asset loads. A heuristic: high enough to keep the pipe busy, low enough
 *  to stay clear of the resource exhaustion observed above. */
const MAX_CONCURRENT_LOADS = 8;

let active = 0;
const waiting: Array<() => void> = [];

/**
 * Run `fn` once a slot is free.
 *
 * LIFO, not FIFO. Intra-room ordering does not matter — a room resolves on a
 * `Promise.all` of all its files, so the last one decides either way. What the order
 * DOES decide is which ROOM wins the queue: leave a room mid-load and enter another,
 * and a FIFO queue puts the new room's ~190 requests behind the abandoned room's
 * remainder, so the room the player is actually waiting for loads last. Serving the
 * most recent request first is the right bias on exactly the slow link this exists for.
 */
export async function withLoadSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_LOADS) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await fn();
  } finally {
    // Hand the slot straight to the next waiter rather than releasing and re-acquiring
    // it — otherwise a burst of new callers can jump the queue.
    const next = waiting.pop();
    if (next) next();
    else active--;
  }
}
