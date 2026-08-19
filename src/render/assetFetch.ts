/**
 * ── What does "this asset did not load" mean? ──────────────────────────────────
 *
 * Both art tiers cache the ANSWER to that question, and both used to cache it without
 * asking which of two very different things had happened:
 *
 *  - **Absent.** The server answered, authoritatively, "not there" (404/403/410), or it
 *    answered with something that is not the asset (the dev server's SPA fallback serves
 *    index.html with a 200). This is a real, stable state — the enhanced tier is
 *    deliberately incomplete, and SCORE ships with no art at all — so the right thing is
 *    to remember it and stop asking.
 *  - **Failed.** The request never got an answer (network error, an aborted connection, a
 *    5xx from a proxy that is having a moment). Nothing has been learned about the asset,
 *    so remembering this is remembering a lie: one blip locked a room out of its tier for
 *    the whole session, with the setting still saying `ai` and the room drawing enhanced.
 *
 * So loaders throw `TransientAssetError` for the second kind and something else (or a
 * plain null) for the first, and every cache in front of them keeps absences and drops
 * failures. That is the whole rule; the rest of this file is the classification.
 */

/** A load that failed without learning anything about the asset — safe (and required) to retry. */
export class TransientAssetError extends Error {
  readonly url: string;
  constructor(url: string, why: string, cause?: unknown) {
    super(`${url}: ${why}`, cause === undefined ? undefined : { cause });
    this.name = 'TransientAssetError';
    this.url = url;
  }
}

export const isTransient = (e: unknown): e is TransientAssetError => e instanceof TransientAssetError;

/**
 * HTTP statuses that say "ask again", as opposed to "there is nothing here".
 *
 * 5xx is the server failing to answer a question it may well answer next time; 408 and
 * 429 are explicit "retry" statuses. Everything else — notably 404 and 403 — is an
 * answer, and an answer is cacheable.
 */
function retryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * ── Retry ─────────────────────────────────────────────────────────────────────
 *
 * The trap that decides this design: **a 404 here is usually correct.** No `ai.json`
 * means the room has no AI art and falls back a tier BY DESIGN; the same goes for
 * `objects.json` and for the 21 sprites that are legitimately absent from their
 * manifests. A retry that could not tell those from a failure would make every
 * fallback room pay three requests plus backoff on EVERY entry, for ever — slower than
 * doing nothing, and worse.
 *
 * So the retry lives here, inside the one function that already draws that line, rather
 * than at 47 call sites. It can only ever re-issue a request that `fetchAsset` itself
 * classified as transient; an answer — any answer, including 404 — is returned to the
 * caller untouched and unretried. That is a property of where the code sits, not a rule
 * someone has to remember.
 *
 * ── The budget ────────────────────────────────────────────────────────────────
 * Two retries, ~250 ms then ~1000 ms, jittered by ±25%. Worst case a dead link costs
 * **1.25 s of waiting** on top of the failed requests themselves, and then the caller
 * carries on exactly as it does today — falls back a tier, and (since #66) does not
 * remember the failure, so the next room entry tries again anyway.
 *
 * The ceiling matters more than the count. Boot fetches ~48 MB and a cold room entry is
 * 17-27 s on Slow 4G, so a policy that turned one dead link into a 30-second stall would
 * be its own bug. Three attempts is the point where a genuine blip is almost always
 * covered and a genuinely broken deploy has not yet become a hang.
 */
const RETRY_DELAYS_MS = [250, 1000] as const;
const JITTER = 0.25;

/**
 * ── The stall ─────────────────────────────────────────────────────────────────
 *
 * `fetch` does not time out. A connection that DIES rejects and is retried above; a
 * connection that merely stops — a phone radio going to sleep, a tunnel, a proxy holding
 * the socket open — never rejects at all, and every recovery in this codebase is built on
 * a rejection. Without a bound on it, a stalled request means: no failure, so no failure
 * screen; the room hold never releases, so the room never appears; and the map's input
 * guards stay armed, so nothing can be clicked. The player is left at a parchment with no
 * way out but the browser's own reload — the one failure mode that is WORSE than the bug
 * this whole branch exists to fix, because at least that one left a playable game.
 *
 * So a request that has not produced RESPONSE HEADERS in this long is treated as the
 * failure it is, and joins the retry above.
 *
 * Bounded at the headers deliberately, and not at the whole transfer: the assets here run
 * to 9 MB, which is 48 s of honest downloading on the 1.5 Mbps link this game is measured
 * against, so any total-transfer deadline short enough to catch a stall would also kill
 * slow connections that are working perfectly. A body that stalls AFTER its headers is
 * therefore still unbounded — see the note on `assetBytes`.
 */
const HEADERS_TIMEOUT_MS = 20000;

/**
 * How long to wait before attempt `n + 1` (0-based), or null when the budget is spent.
 *
 * Jittered so a burst of assets failing together — which is what a dropped connection
 * looks like — does not retry in lockstep and re-create the burst. Pure, and exported,
 * so the schedule can be tested without waiting for it.
 */
export function retryDelayMs(attempt: number, rand: () => number = Math.random): number | null {
  const base = RETRY_DELAYS_MS[attempt];
  if (base === undefined) return null;
  return Math.round(base * (1 + (rand() * 2 - 1) * JITTER));
}

/**
 * The two things a caller (in practice, a test) may want to control about the waiting.
 *
 * Injected rather than reached for globally, because the alternative is a test-only
 * backdoor in shipping code. The unit suite uses `delayMs: () => null` to test the
 * CLASSIFICATION at full speed, and a counting `sleep` to test the SCHEDULE without
 * spending it — a retry test that actually waits 1.25 s costs 500x what a unit test in
 * this repo is supposed to.
 */
export interface RetryPolicy {
  /** Wait before attempt `n + 1`, or null to stop. Defaults to `retryDelayMs`. */
  delayMs?: (attempt: number) => number | null;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for response HEADERS before calling it a stall. For tests. */
  headersMs?: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * `fetch`, with the transport-level failures labelled — and retried.
 *
 * Deliberately does NOT judge the response body: whether a 200 that is not a PNG counts
 * as absent is the caller's business (and for the dev server's SPA fallback, it does).
 * This only separates "no answer" from "an answer".
 *
 * The happy path is one `fetch` inside one `try`, and the loop exits on the first
 * attempt — measured at no detectable difference on a full room entry, which is the case
 * that matters, since every request succeeding is overwhelmingly the common one.
 *
 * A body that arrives TRUNCATED is not retried here: it is reported transient by
 * `assetBlob` / `assetBytes` / `assetJson`, after this function has already returned its
 * response. That is a real gap and a deliberate one — retrying it means re-issuing the
 * whole request from the caller. It is also where the headers deadline stops helping: a
 * body that stalls after its headers have arrived is still unbounded, because the only
 * honest bound on it is a per-chunk stall watchdog over a streamed body, which is a
 * bigger change than this one.
 */
export async function fetchAsset(url: string, init?: RequestInit, retry?: RetryPolicy): Promise<Response> {
  const nextDelay = retry?.delayMs ?? retryDelayMs;
  const sleep = retry?.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    // One controller per attempt: aborting a stalled attempt must not poison the retry.
    const stall = new AbortController();
    const timer = setTimeout(() => stall.abort(new Error('no response headers')), retry?.headersMs ?? HEADERS_TIMEOUT_MS);
    try {
      // The caller's own signal still has to work — it is how a room that has been left
      // cancels its loads — so the two are combined rather than one replacing the other.
      const signal = init?.signal ? AbortSignal.any([init.signal, stall.signal]) : stall.signal;
      const res = await fetch(url, { ...init, signal });
      if (retryableStatus(res.status)) throw new TransientAssetError(url, `HTTP ${res.status}`);
      return res;
    } catch (e) {
      // Only OUR classification is retried. A caller-thrown error, or anything the
      // labelling below decided was an answer, leaves immediately.
      const err = e instanceof TransientAssetError ? e : new TransientAssetError(url, 'network error', e);
      // An abort the CALLER asked for is not a failure to recover from — it is the app
      // saying it no longer wants this. Retrying it would fight the page that navigated
      // away, and would keep a load alive after the room that wanted it is gone.
      const delay = init?.signal?.aborted === true ? null : nextDelay(attempt);
      if (delay === null) throw err;
      // The wait happens while HOLDING the caller's load slot, where it has one. That is
      // deliberate: acquiring a second slot from inside one can deadlock the pool, and
      // holding it also stops a failing room from spending its whole budget re-queuing.
      await sleep(delay);
    } finally {
      // Cleared once the headers are in, which is what makes the deadline a HEADERS
      // deadline: leaving it armed would abort the body mid-download and turn every slow
      // but healthy transfer into a failure.
      clearTimeout(timer);
    }
  }
}

/**
 * Read a response body as a Blob, treating a failure as transient.
 *
 * The headers can arrive and the body still not: a connection dropped mid-download
 * rejects here, not at `fetch`. That is a blip, not a missing file.
 */
export async function assetBlob(url: string, res: Response): Promise<Blob> {
  try {
    return await res.blob();
  } catch (e) {
    throw new TransientAssetError(url, 'truncated response', e);
  }
}

/**
 * Read a response body as bytes, treating a failure as transient.
 *
 * Same hazard as assetBlob, and the one the CORE room assets hit: an FFR whose headers
 * arrived and whose body did not rejects here with a bare `TypeError`, which is I/O and
 * must be retried rather than reported to the player as a broken game.
 */
export async function assetBytes(url: string, res: Response): Promise<Uint8Array> {
  try {
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    throw new TransientAssetError(url, 'truncated response', e);
  }
}

/**
 * Demand an answer that is actually the asset, or throw.
 *
 * The counterpart to `fetchAsset` for assets that are NOT optional. `fetchAsset` returns
 * every answer it got, including 404 — because for the art tiers a 404 is usually
 * correct (no `ai.json` means the room has no AI art, by design). For a room's own FFR
 * or FFT there is no such case: all 72 rooms ship both, so an answer of "not there" is a
 * broken build or a broken deploy. It is still PERMANENT rather than transient — nothing
 * is gained by asking again — and `isTransient` is what tells the two apart downstream,
 * so this throws a plain Error deliberately.
 */
export function requireAsset(res: Response, url: string, what: string): void {
  if (!res.ok) throw new Error(`${what}: ${url} returned HTTP ${res.status}`);
}

/**
 * Read a response body as JSON, treating a failure as transient.
 *
 * Same reason as assetBlob, and easier to forget because `res.json()` reads like parsing
 * rather than like I/O — it is both. A manifest whose body never finished arriving (the
 * page navigated away mid-load, the connection dropped) rejects here with a bare
 * `TypeError: Failed to fetch`, and without this it would be filed as "this room has no
 * art at that tier" and cached — the very mistake this module exists to prevent, one
 * level below where it was first found.
 */
export async function assetJson<T>(url: string, res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (e) {
    // A SyntaxError means the body ARRIVED and was not JSON: a broken build, which is
    // deterministic and worth caching. Anything else — a TypeError from a body that
    // never finished — is I/O, and must not be remembered. Rethrowing the SyntaxError
    // unwrapped is what puts it on the deterministic side of every caller's catch.
    if (e instanceof SyntaxError) throw e;
    throw new TransientAssetError(url, 'unreadable manifest', e);
  }
}

/**
 * Wrap an image decode failure as transient.
 *
 * A truncated download and a genuinely corrupt file look identical to the decoder, so
 * this call is a guess either way. It guesses "transient" because the two mistakes do not
 * cost the same: guessing transient on a corrupt file costs one wasted refetch the next
 * time the room is entered, while guessing absent on a truncated one costs the player the
 * tier for the rest of the session — which is the bug this whole file exists for.
 */
export async function decodeAsset<T>(url: string, decode: () => Promise<T>): Promise<T> {
  try {
    return await decode();
  } catch (e) {
    throw new TransientAssetError(url, 'decode failed', e);
  }
}

/**
 * The dev server serves index.html (HTTP 200) for a missing asset, so `res.ok` is not
 * enough to know a file exists — verify the content-type is an image.
 */
export function isPngResponse(res: Response): boolean {
  return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/');
}

/**
 * Report an asset that a manifest promised and the server does not have.
 *
 * This is the case the tiers could not previously distinguish from a legitimate gap, and
 * the two want opposite treatment. An item simply ABSENT from a manifest is by design —
 * 21 sprites ship that way and render as 1998 bitmaps inside a truecolor room, silently
 * and correctly. An item LISTED in a manifest that then 404s is a broken build or a
 * broken deployment: nothing at runtime can fix it, so it is cached like any other
 * absence, but it must not be silent, because the only other symptom is art quietly
 * being a bit wrong in one room.
 */
export function reportMissingAsset(what: string, url: string): void {
  console.error(`[art] ${what}: manifest lists ${url}, but it did not load — the build or the deploy is incomplete`);
}
