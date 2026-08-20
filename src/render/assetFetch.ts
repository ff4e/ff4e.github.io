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
 *
 * ── The two doors ─────────────────────────────────────────────────────────────
 *
 * Every network request in `src/` comes through this file — `test/asset-fetch-discipline.test.ts`
 * fails the build for a bare `fetch(` anywhere else — and there are exactly two ways in:
 *
 *  - **`requiredAsset(url, what)`** — the file must be there. An answer of "not there" is
 *    a `MissingAssetError`; no answer at all is a `TransientAssetError`. Either ends the
 *    session on the failure screen.
 *  - **`optionalAsset(url)`** — absence is the DESIGN. Returns null when the server says
 *    "not there"; a failure still throws.
 *
 * The policy is an argument, not a default, so a new asset cannot be added without
 * someone answering the question — and so a reviewer can grep for the answer. `optional`
 * is deliberately the short list, and it is enumerable:
 *
 *  - per-room art in either enhanced tier — SCORE ships none at all, CHODBA and WIN draw
 *    a classic background by design, 21 object sprites are legitimately unstaged, and the
 *    `w1.png`/`p1.png` animation loop DISCOVERS its frame count by 404ing;
 *  - `CredMov_port.BMP`, which is built by a tool and falls back to `CredMov.BMP`;
 *  - the AI intro-movie probe, whose entire purpose is asking whether a file exists.
 *
 * Everything else is required. A 404 on it is a broken build or a broken deploy, and the
 * game says so instead of quietly playing without its music, its death lines or its help.
 *
 * One loader is outside this file rather than exempt within it: the intro movie, which is
 * a `<video src>` in `intro.ts`. A media element streams, and its `error` event cannot
 * tell a 404 from a dropped connection — the one distinction everything here rests on —
 * so routing it through this door would buy a label the platform cannot supply. The intro
 * is skippable by design. `test/asset-fetch-discipline.test.ts` records that in the one
 * place someone would look before adding a second such loader.
 */

/** A load that failed without learning anything about the asset — safe (and required) to retry. */
export class TransientAssetError extends Error {
  readonly url: string;
  /**
   * The player-facing name of the thing, when the call site named one.
   *
   * Only `requiredAsset` supplies it — `optionalAsset` has nothing to say to a player by
   * construction — and it exists so the failure screen can name the asset rather than
   * saying "a game file". Optional, because the classification happens one level below
   * the naming and must not depend on it.
   */
  readonly what: string | undefined;
  constructor(url: string, why: string, cause?: unknown, what?: string) {
    super(`${url}: ${why}`, cause === undefined ? undefined : { cause });
    this.name = 'TransientAssetError';
    this.url = url;
    this.what = what;
  }
}

/**
 * A file the game requires and the server answered "not there" for.
 *
 * The other half of the split above, and the one that had no name until every asset
 * became mandatory. It is PERMANENT — asking again cannot help — so nothing retries it
 * and nothing hides it: a required asset that 404s is a broken build or a broken deploy,
 * and the player is told exactly that rather than being sent to check their wifi.
 *
 * A type rather than a message, because the failure screen has to tell the two apart and
 * a string match on an error is a bug waiting for someone to reword a sentence.
 */
export class MissingAssetError extends Error {
  readonly url: string;
  /** The player-facing name of the thing, e.g. "the world map". */
  readonly what: string;
  constructor(url: string, what: string, why: string) {
    super(`${what}: ${url} ${why}`);
    this.name = 'MissingAssetError';
    this.url = url;
    this.what = what;
  }
}

export const isTransient = (e: unknown): e is TransientAssetError => e instanceof TransientAssetError;
export const isMissing = (e: unknown): e is MissingAssetError => e instanceof MissingAssetError;

/** Either way an asset failed to arrive — what the failure screen reacts to. */
export const isAssetError = (e: unknown): e is TransientAssetError | MissingAssetError =>
  isTransient(e) || isMissing(e);

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
 * What the body must actually BE, beyond the status being an answer. See `notTheAsset`.
 */
export type AssetExpect = 'json' | 'image';

/** The knobs both doors share. All optional; the POLICY is not one of them. */
export interface AssetOptions {
  init?: RequestInit | undefined;
  retry?: RetryPolicy | undefined;
  expect?: AssetExpect | undefined;
}

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
 *
 * NOT exported. It answers "what happened", never "what should happen", and a caller
 * holding a raw Response is a caller that has not chosen a policy — which is how 14 kinds
 * of asset came to fail silently. Reach it through `requiredAsset` or `optionalAsset`.
 */
async function fetchAsset(url: string, what?: string, init?: RequestInit, retry?: RetryPolicy): Promise<Response> {
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
      if (retryableStatus(res.status)) throw new TransientAssetError(url, `HTTP ${res.status}`, undefined, what);
      return res;
    } catch (e) {
      // Only OUR classification is retried. A caller-thrown error, or anything the
      // labelling below decided was an answer, leaves immediately.
      const err = e instanceof TransientAssetError ? e : new TransientAssetError(url, 'network error', e, what);
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
export async function assetBlob(url: string, res: Response, what?: string): Promise<Blob> {
  try {
    return await res.blob();
  } catch (e) {
    throw new TransientAssetError(url, 'truncated response', e, what);
  }
}

/**
 * Read a response body as bytes, treating a failure as transient.
 *
 * Same hazard as assetBlob, and the one the CORE room assets hit: an FFR whose headers
 * arrived and whose body did not rejects here with a bare `TypeError`, which is I/O and
 * must be retried rather than reported to the player as a broken game.
 */
export async function assetBytes(url: string, res: Response, what?: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    throw new TransientAssetError(url, 'truncated response', e, what);
  }
}

/**
 * Demand an answer that is actually the asset, or throw.
 *
 * The counterpart to `optionalAsset` for the assets the game cannot do without, which
 * since the all-or-nothing decision is nearly all of them. A 404 here is a
 * `MissingAssetError` — permanent, unretried, and fatal upstream — because on a correctly
 * built and correctly deployed game there is no case where this file is not there.
 *
 * `what` is the sentence fragment the player will read on the failure screen ("the world
 * map", "the music for room 7"), so it is written for them, not for a log.
 */
export async function requiredAsset(url: string, what: string, opts?: AssetOptions): Promise<Response> {
  const res = await fetchAsset(url, what, opts?.init, opts?.retry);
  const why = notTheAsset(res, opts?.expect);
  if (why !== null) throw new MissingAssetError(url, what, why);
  return res;
}

/**
 * Fetch something whose ABSENCE is part of the design, and say so by returning null.
 *
 * The whole exception to "every asset is mandatory", and it is a correctness constraint
 * rather than a convenience: SCORE ships with no enhanced art, CHODBA and WIN draw a
 * classic background by design, 21 object sprites are legitimately unstaged, and the
 * credits deliberately ask for a file a tool may not have built. Every one of those 404s
 * on a perfectly good deploy, so routing them to the failure screen would make the game
 * permanently unplayable in the tiers that are behaving exactly as intended.
 *
 * A FAILURE is still a failure: no answer means nothing was learned, and that throws
 * `TransientAssetError` here exactly as it does everywhere else. Only an ANSWER of "not
 * there" becomes null.
 */
export async function optionalAsset(url: string, opts?: AssetOptions): Promise<Response | null> {
  const res = await fetchAsset(url, undefined, opts?.init, opts?.retry);
  return notTheAsset(res, opts?.expect) === null ? res : null;
}

/**
 * Why this response is not the asset, or null when it is.
 *
 * `expect` exists because `res.ok` is not enough to know a file is there: the dev server
 * answers a missing asset with its SPA fallback — index.html, HTTP 200 — so a manifest
 * fetch that only checked the status would hand `<!doctype html>` to `JSON.parse` and a
 * sprite fetch would hand it to the image decoder. Checked in the one place both doors
 * pass through, rather than at the ten call sites that used to each remember it.
 */
function notTheAsset(res: Response, expect?: AssetExpect): string | null {
  if (!res.ok) return `returned HTTP ${res.status}`;
  if (expect === undefined) return null;
  const ct = res.headers.get('content-type') ?? '';
  const ok = expect === 'json' ? ct.includes('json') : ct.startsWith('image/');
  return ok ? null : `answered HTTP ${res.status} with ${ct || 'no content-type'}, not ${expect}`;
}

/**
 * Read a response body as text, treating a failure as transient.
 *
 * Same hazard as `assetBytes`, for the three assets that are plain text: the demo
 * script, the minigame's shape table and the help index.
 */
export async function assetText(url: string, res: Response, what?: string): Promise<string> {
  try {
    return await res.text();
  } catch (e) {
    throw new TransientAssetError(url, 'truncated response', e, what);
  }
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
export async function assetJson<T>(url: string, res: Response, what?: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (e) {
    // A SyntaxError means the body ARRIVED and was not JSON: deterministic, so retrying
    // is pure waste, and it is reported as MISSING rather than transient — the server
    // answered with something that is not the asset, which is the same fault as a 404 on
    // a file the build promised. It used to be rethrown as a bare SyntaxError, which is
    // not an asset error at all, so the failure screen never saw it and the enhanced tier
    // cached a broken manifest as "this room has no art": a silent fidelity loss of
    // exactly the kind the rest of this file exists to remove.
    //
    // Anything else — a TypeError from a body that never finished — is I/O, and must not
    // be remembered.
    if (e instanceof SyntaxError) throw new MissingAssetError(url, what ?? 'A game file', 'answered with a body that is not JSON');
    throw new TransientAssetError(url, 'unreadable manifest', e, what);
  }
}

/**
 * ── Required, end to end ──────────────────────────────────────────────────────
 *
 * A fetch and a body read are two calls, and until these existed every required asset
 * spelled both: `assetBytes(url, await requiredAsset(url, what))`. That works, and it
 * leaks in exactly one way — the body read is a second chance to forget the name, so a
 * download that died between its headers and its last byte reached the player as "A game
 * file didn't finish loading" while the same asset failing a moment earlier named itself.
 *
 * So the pair is one call. `what` is passed once and cannot drift from the request it
 * belongs to, and no caller has to hold a raw `Response` to read a body — which is also
 * what stops a parser outside this file from turning an asset failure back into an
 * ordinary error nothing recognises.
 */
export async function requiredBytes(url: string, what: string, opts?: AssetOptions): Promise<Uint8Array> {
  return assetBytes(url, await requiredAsset(url, what, opts), what);
}

export async function requiredText(url: string, what: string, opts?: AssetOptions): Promise<string> {
  return assetText(url, await requiredAsset(url, what, opts), what);
}

export async function requiredJson<T>(url: string, what: string, opts?: AssetOptions): Promise<T> {
  return assetJson<T>(url, await requiredAsset(url, what, { expect: 'json', ...opts }), what);
}

export async function requiredBlob(url: string, what: string, opts?: AssetOptions): Promise<Blob> {
  return assetBlob(url, await requiredAsset(url, what, { expect: 'image', ...opts }), what);
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

