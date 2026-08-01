/**
 * The shared asset-load gate (src/render/loadSlot.ts).
 *
 * `withLoadSlot` exists because loading a room's art all at once — which is what makes
 * the first frame arrive quickly on a high-latency link — otherwise asks the browser
 * for ~150 files at a time and gets `net::ERR_INSUFFICIENT_RESOURCES` back. That
 * failure is nasty precisely because it is SILENT: the room renders, just without the
 * art whose fetch was dropped, so the 72-room parity probes reported "wrong pixels"
 * rather than "load failed".
 *
 * Bookkeeping bugs in a gate like this are equally silent — a lost slot lowers the
 * ceiling for the rest of the session, a leaked one raises it, and either only shows up
 * as a timing change. So the invariants are asserted directly here, in plain node, with
 * no browser and no network: the concurrency ceiling, FIFO order, that a rejecting task
 * still releases its slot, and that the pool fully drains.
 */
import { describe, it, expect } from 'vitest';
import { withLoadSlot } from '../src/render/loadSlot.js';

/** A task that blocks until `release()` is called, and reports when it started. */
function gated() {
  let release;
  let started = false;
  const blocked = new Promise((r) => { release = r; });
  return {
    started: () => started,
    release: () => release(),
    run: () => withLoadSlot(async () => { started = true; await blocked; return 'done'; }),
  };
}

/**
 * Run a body with a pool of gated tasks, and ALWAYS drain them afterwards.
 *
 * `withLoadSlot`'s counters are module-level singletons shared by every test in this
 * file, so a test that fails mid-way while holding slots silently starves the tests
 * after it — which is exactly what happened while writing these (one bad assertion
 * turned into three failures, two of them phantom).
 */
async function withGated(n, body) {
  const tasks = Array.from({ length: n }, gated);
  const running = tasks.map((t) => t.run());
  try {
    await Promise.resolve();
    await Promise.resolve();
    return await body(tasks, running);
  } finally {
    for (const t of tasks) t.release();
    await Promise.all(running);
  }
}

describe('withLoadSlot', () => {
  it('runs up to 8 tasks at once and queues the rest', async () => {
    await withGated(12, (tasks) => {
      expect(tasks.slice(0, 8).every((t) => t.started())).toBe(true);
      expect(tasks.slice(8).some((t) => t.started())).toBe(false);
    });
  });

  it('hands a freed slot to the most recent waiter (LIFO)', async () => {
    // LIFO is deliberate: the queue decides which ROOM wins, and the room the player
    // is waiting for is the one that queued last (see loadSlot.ts).
    const order = [];
    await withGated(8, async (tasks, running) => {
      const queued = [0, 1, 2].map((i) => withLoadSlot(async () => { order.push(i); }));
      await Promise.resolve();
      expect(order).toEqual([]); // all three wait behind the full pool
      tasks[0].release();
      await running[0];
      await Promise.resolve();
      expect(order).toEqual([2]); // the LAST to queue runs first
      for (const t of tasks.slice(1)) t.release();
      await Promise.all(queued);
      expect(order).toEqual([2, 1, 0]);
    });
  });

  it('releases the slot when the task throws, and propagates the error', async () => {
    // A gate that leaked a slot on failure would quietly shrink the pool for the rest
    // of the session — and a partly-broken asset deploy is exactly when tasks throw.
    for (let i = 0; i < 20; i++) {
      await expect(withLoadSlot(async () => { throw new Error(`boom ${i}`); })).rejects.toThrow(`boom ${i}`);
    }
    // If any of those 20 leaked, fewer than 8 of these could start concurrently.
    await withGated(8, (tasks) => {
      expect(tasks.every((t) => t.started())).toBe(true);
    });
  });

  it('drains completely, so a later burst still gets the full pool', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => withLoadSlot(async () => i)));
    await withGated(8, (tasks) => {
      expect(tasks.filter((t) => t.started())).toHaveLength(8);
    });
  });
});
