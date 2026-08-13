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
 * `fetch`, with the transport-level failures labelled.
 *
 * Deliberately does NOT judge the response body: whether a 200 that is not a PNG counts
 * as absent is the caller's business (and for the dev server's SPA fallback, it does).
 * This only separates "no answer" from "an answer".
 */
export async function fetchAsset(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    // fetch rejects only for a transport failure: DNS, connection reset, offline, an
    // aborted request. Exactly the case that must never be remembered.
    throw new TransientAssetError(url, 'network error', e);
  }
  if (retryableStatus(res.status)) throw new TransientAssetError(url, `HTTP ${res.status}`);
  return res;
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
