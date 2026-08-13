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
  TransientAssetError,
  assetBlob,
  assetJson,
  decodeAsset,
  fetchAsset,
  isPngResponse,
  isTransient,
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

describe('fetchAsset', () => {
  it('treats a transport failure as transient — nothing was learned about the asset', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(fetchAsset(URL_, undefined, NO_RETRY)).rejects.toBeInstanceOf(TransientAssetError);
  });

  it.each([500, 502, 503, 408, 429])('treats HTTP %i as transient', async (status) => {
    vi.stubGlobal('fetch', async () => new Response('', { status }));
    await expect(fetchAsset(URL_, undefined, NO_RETRY)).rejects.toBeInstanceOf(TransientAssetError);
  });

  it.each([404, 403, 410])('treats HTTP %i as an ANSWER, and hands it back to the caller', async (status) => {
    vi.stubGlobal('fetch', async () => new Response('', { status }));
    const res = await fetchAsset(URL_);
    // Not a rejection: "not there" is exactly the thing a cache should remember, and only
    // the caller knows what absence means for it (the enhanced tier is full of holes by
    // design, so a 404 there is not even a fault).
    expect(res.status).toBe(status);
  });

  it('names the url it failed on', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    await expect(fetchAsset(URL_, undefined, NO_RETRY)).rejects.toMatchObject({ url: URL_ });
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

  it('is NOT transient when the body arrived and was not JSON', async () => {
    // A broken build. Deterministic, so retrying it forever would be pure waste.
    const res = new Response('<html>', { headers: { 'content-type': 'application/json' } });
    const err = await assetJson(URL_, res).catch((e) => e);
    expect(isTransient(err)).toBe(false);
    expect(err).toBeInstanceOf(SyntaxError);
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

describe('isPngResponse', () => {
  it('rejects the dev server SPA fallback, which answers 200 with HTML', () => {
    expect(isPngResponse(new Response('<html>', { headers: { 'content-type': 'text/html' } }))).toBe(false);
    expect(isPngResponse(new Response('x', { headers: { 'content-type': 'image/png' } }))).toBe(true);
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
describe('fetchAsset retry', () => {
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
    const res = await fetchAsset(URL_, undefined, { sleep: clock.sleep });
    expect(res.status).toBe(404);
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
    const res = await fetchAsset(URL_, undefined, { sleep: clock.sleep });
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
    await expect(fetchAsset(URL_, undefined, { sleep: clock.sleep })).rejects.toBeInstanceOf(TransientAssetError);
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
      fetchAsset(URL_, { signal: ac.signal }, { sleep: clock.sleep }),
    ).rejects.toBeInstanceOf(TransientAssetError);
    expect(calls).toBe(1);
    expect(clock.waits).toEqual([]);
  });
});
