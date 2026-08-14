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
} from '../src/render/assetFetch.js';

const URL_ = '/enhanced-ai/SCHODY/ai.json';
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
    await expect(fetchAsset(URL_)).rejects.toBeInstanceOf(TransientAssetError);
  });

  it.each([500, 502, 503, 408, 429])('treats HTTP %i as transient', async (status) => {
    vi.stubGlobal('fetch', async () => new Response('', { status }));
    await expect(fetchAsset(URL_)).rejects.toBeInstanceOf(TransientAssetError);
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
    await expect(fetchAsset(URL_)).rejects.toMatchObject({ url: URL_ });
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
