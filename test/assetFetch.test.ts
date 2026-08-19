/**
 * The rule the whole tier-desync fix rests on: which failures may be remembered.
 *
 * A cache in front of an asset loader is remembering an ANSWER. "There is no AI art for
 * this room" is an answer; "the connection dropped" is not, and remembering it as one is
 * what locked a room out of its tier for a whole session. These tests pin the line,
 * because every caller's caching decision is `isTransient(e)` and nothing else.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MissingAssetError,
  TransientAssetError,
  assetBlob,
  assetJson,
  decodeAsset,
  isTransient,
  optionalAsset,
  requiredAsset,
  retryDelayMs,
} from '../src/render/assetFetch.js';
import { pinRandomHighest, pinRandomLowest } from './rng.js';

const URL_ = '/enhanced-ai/SCHODY/ai.json';
/**
 * Classification tests run with the retry budget spent, so they measure what they are
 * about and cost what a unit test should. The retries have their own describe below.
 */
const NO_RETRY = { delayMs: () => null };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the two doors', () => {
  it.each([
    ['requiredAsset', () => requiredAsset(URL_, 'the AI artwork', { retry: NO_RETRY })],
    ['optionalAsset', () => optionalAsset(URL_, { retry: NO_RETRY })],
  ])('%s treats a transport failure as transient — nothing was learned about the asset', async (_n, call) => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(call()).rejects.toBeInstanceOf(TransientAssetError);
  });

  it.each([500, 502, 503, 408, 429])('treats HTTP %i as transient, on BOTH doors', async (status) => {
    vi.stubGlobal('fetch', async () => new Response('', { status }));
    // The policy argument says what an ANSWER means. It never says a failure is fine:
    // "optional" is about absence by design, and a 5xx is not an absence.
    await expect(requiredAsset(URL_, 'the AI artwork', { retry: NO_RETRY })).rejects.toBeInstanceOf(
      TransientAssetError,
    );
    await expect(optionalAsset(URL_, { retry: NO_RETRY })).rejects.toBeInstanceOf(TransientAssetError);
  });

  it.each([404, 403, 410])('treats HTTP %i as an ANSWER, and lets the CALL SITE decide', async (status) => {
    vi.stubGlobal('fetch', async () => new Response('', { status }));
    // "Not there" is exactly the thing a cache should remember — and the two doors are
    // the two things it can mean. The enhanced tiers are full of holes by design, so a
    // 404 there is not a fault; anywhere else it is a broken build.
    expect(await optionalAsset(URL_)).toBeNull();
    await expect(requiredAsset(URL_, 'the AI artwork')).rejects.toBeInstanceOf(MissingAssetError);
  });

  it('names the url it failed on', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    await expect(requiredAsset(URL_, 'the AI artwork', { retry: NO_RETRY })).rejects.toMatchObject({ url: URL_ });
  });

  it('carries the player-facing name on a missing required asset', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    // The failure screen prints `what`, so it is part of the error rather than something
    // the catch site has to remember to supply a second time.
    await expect(requiredAsset(URL_, 'the world map')).rejects.toMatchObject({ what: 'the world map', url: URL_ });
  });

  it('rejects the dev server SPA fallback, which answers 200 with HTML', async () => {
    // The trap `expect` exists for: a missing file in dev is index.html with HTTP 200,
    // so a status check alone would hand markup to JSON.parse or to the image decoder.
    vi.stubGlobal('fetch', async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect(await optionalAsset(URL_, { expect: 'json' })).toBeNull();
    expect(await optionalAsset(URL_, { expect: 'image' })).toBeNull();
    await expect(requiredAsset(URL_, 'the AI artwork', { expect: 'json' })).rejects.toBeInstanceOf(MissingAssetError);
    // ...and a 200 that IS the asset passes both.
    vi.stubGlobal('fetch', async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    expect(await optionalAsset(URL_, { expect: 'json' })).not.toBeNull();
  });

  it('does not confuse the two kinds of failure', async () => {
    // `isTransient` is what every cache in the app branches on, and `isMissing` is what
    // the failure screen branches on. Neither may answer true for the other's error.
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    const missing = await requiredAsset(URL_, 'the AI artwork').catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(MissingAssetError);
    expect(isTransient(missing)).toBe(false);
  });
});

describe('assetJson', () => {
  it('parses a good manifest', async () => {
    expect(await assetJson<{ a: number }>(URL_, json({ a: 1 }))).toEqual({ a: 1 });
  });

  it('is transient when the BODY never arrived', async () => {
    // The headers can land and the body not — res.json() is I/O, not just parsing, and
    // it rejects with a bare TypeError. Filed as an absence, this would be cached.
    const res = { json: async () => { throw new TypeError('Failed to fetch'); } } as unknown as Response;
    await expect(assetJson(URL_, res)).rejects.toBeInstanceOf(TransientAssetError);
  });

  it('reports a body that arrived and was not JSON as MISSING, not transient', async () => {
    // A broken build: deterministic, so retrying it forever would be pure waste — but it
    // is still an ASSET failure, and that is the part that used to be wrong. It threw a
    // bare SyntaxError, which the failure screen does not recognise, so a manifest served
    // as garbage was cached as "this room has no art" and the room quietly rendered a
    // tier down. The `what` is carried through so the screen can name it.
    const res = new Response('<html>', { headers: { 'content-type': 'application/json' } });
    const err = await assetJson(URL_, res, 'the AI artwork').catch((e) => e);
    expect(isTransient(err)).toBe(false);
    expect(err).toBeInstanceOf(MissingAssetError);
    expect(err).toMatchObject({ what: 'the AI artwork', url: URL_ });
  });
});

describe('assetBlob / decodeAsset', () => {
  it('is transient when the body read fails', async () => {
    const res = { blob: async () => { throw new TypeError('Failed to fetch'); } } as unknown as Response;
    await expect(assetBlob(URL_, res)).rejects.toBeInstanceOf(TransientAssetError);
  });

  it('is transient when the decode fails', async () => {
    // A truncated download and a corrupt file are indistinguishable here. Transient is
    // the cheaper mistake: one wasted refetch, versus losing the tier for the session.
    await expect(decodeAsset(URL_, async () => { throw new Error('bad image'); })).rejects.toBeInstanceOf(
      TransientAssetError,
    );
  });
});

/**
 * The retry, which is the part that is easy to write and hard to prove.
 *
 * Two things are worth pinning, and they are not the same thing: WHAT is retried (the
 * 404 trap — a fallback room must not pay for retries on every entry, for ever) and HOW
 * LONG it can take (a dead link that becomes a 30-second stall is its own bug).
 *
 * All of it runs on an injected `sleep`, so the schedule is asserted without being
 * waited out. A test that actually spent the budget would cost ~500x what a unit test in
 * this repo costs, to prove less.
 */
describe('retry', () => {
  /** Collects the waits instead of taking them. */
  function fakeClock() {
    const waits: number[] = [];
    return { waits, sleep: async (ms: number) => void waits.push(ms) };
  }

  it('does not retry a 404 — the case that would cost every fallback room three requests, for ever', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return new Response('', { status: 404 });
    });
    const clock = fakeClock();
    expect(await optionalAsset(URL_, { retry: { sleep: clock.sleep } })).toBeNull();
    expect(calls).toBe(1);
    expect(clock.waits).toEqual([]);
  });

  it('retries a transient failure and returns the answer when one finally arrives', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return json({ scale: 4 });
    });
    const clock = fakeClock();
    const res = await requiredAsset(URL_, 'the AI artwork', { retry: { sleep: clock.sleep } });
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
    expect(clock.waits).toHaveLength(1); // one blip, one wait
  });

  it('gives up after three attempts and rethrows as transient, so the caller still does not cache it', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      throw new TypeError('Failed to fetch');
    });
    const clock = fakeClock();
    await expect(requiredAsset(URL_, 'the AI artwork', { retry: { sleep: clock.sleep } })).rejects.toBeInstanceOf(
      TransientAssetError,
    );
    expect(calls).toBe(3); // the first, plus two retries
    expect(clock.waits).toHaveLength(2);
  });

  it('costs at most ~1.25s of waiting, however unlucky the jitter', async () => {
    // The ceiling is the number that matters: boot already fetches ~48 MB and a cold
    // room entry is 17-27s on Slow 4G, so the budget has to be small enough that a dead
    // link is a hiccup rather than a hang.
    pinRandomHighest();
    expect(retryDelayMs(0)! + retryDelayMs(1)!).toBeLessThanOrEqual(1600);
    expect(retryDelayMs(2)).toBeNull(); // ...and there is no third retry
  });

  it('jitters, so a burst of assets failing together does not retry in lockstep', () => {
    pinRandomLowest();
    const low = retryDelayMs(0)!;
    pinRandomHighest();
    const high = retryDelayMs(0)!;
    expect(low).toBeLessThan(high);
    // ±25% around 250ms, and never zero or negative however the draw lands.
    expect(low).toBeGreaterThanOrEqual(Math.round(250 * 0.75));
    expect(high).toBeLessThanOrEqual(Math.round(250 * 1.25));
  });

  /**
   * The stall, which is the failure the retry above cannot see.
   *
   * A connection that DIES rejects and is retried; a connection that merely STOPS — a
   * radio going to sleep, a proxy holding the socket — never rejects at all, and every
   * recovery in this codebase is built on a rejection. Unbounded, that means no failure,
   * so no failure screen, so a parchment with no way out but the browser's own reload:
   * the one outcome worse than the silence this whole branch replaces.
   *
   * Asserted with an injected `headersMs` and a fetch that never settles, so the test
   * costs milliseconds rather than the 20 s the real deadline is set to. There was no
   * test for this at all until now — the deadline shipped in #102 on the strength of the
   * comment next to it.
   */
  it('treats a request that never produces headers as a failure, and retries it', async () => {
    let calls = 0;
    let aborted = 0;
    vi.stubGlobal('fetch', (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) => {
        // A real stalled fetch settles only when its signal aborts, which is exactly what
        // the deadline is for. Without honouring the signal here the test would hang.
        init?.signal?.addEventListener('abort', () => {
          aborted++;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    const clock = fakeClock();
    await expect(
      requiredAsset(URL_, 'the AI artwork', { retry: { sleep: clock.sleep, headersMs: 5 } }),
    ).rejects.toBeInstanceOf(TransientAssetError);
    expect(calls).toBe(3); // the stall is a failure like any other: first attempt + two retries
    expect(aborted).toBe(3); // ...and every attempt was actually torn down, not left hanging
    expect(clock.waits).toHaveLength(2);
  });

  it('does not arm the deadline against the BODY — a slow but healthy download must survive', async () => {
    // Bounded at the headers deliberately: these assets run to 9 MB, which is 48 s of
    // honest downloading on the 1.5 Mbps link the game is measured against, so a deadline
    // that covered the whole transfer would kill connections that are working perfectly.
    let signal;
    vi.stubGlobal('fetch', async (_url, init) => {
      signal = init?.signal;
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });
    const res = await requiredAsset(URL_, 'the AI artwork', { retry: { headersMs: 5 } });
    expect(res.ok).toBe(true);
    // The timer is cleared once the headers are in; if it were still armed it would abort
    // the body mid-download a few milliseconds from now.
    await new Promise((r) => setTimeout(r, 25));
    expect(signal?.aborted).toBe(false);
  });

  it('does not retry a request the app itself aborted — that is not a failure to recover from', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      throw new DOMException('aborted', 'AbortError');
    });
    const ac = new AbortController();
    ac.abort();
    const clock = fakeClock();
    await expect(
      requiredAsset(URL_, 'the AI artwork', { init: { signal: ac.signal }, retry: { sleep: clock.sleep } }),
    ).rejects.toBeInstanceOf(TransientAssetError);
    expect(calls).toBe(1);
    expect(clock.waits).toEqual([]);
  });
});
