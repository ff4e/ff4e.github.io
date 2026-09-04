/**
 * The native (Capacitor/WKWebView) host, and the one thing it gets wrong.
 *
 * ── The bug this exists for ────────────────────────────────────────────────────
 *
 * Capacitor serves the bundled app from `capacitor://localhost` through a
 * `WKURLSchemeHandler`. For most files it answers with an `HTTPURLResponse` carrying
 * status 200. For anything it considers MEDIA — its own list is
 * `m4v, mov, mp4, aac, ac3, aiff, au, flac, m4a, mp3, wav` — and only when the request
 * carries no `Range` header, it answers with a bare `URLResponse` instead:
 *
 *     if isMediaExtension(pathExtension: url.pathExtension) {
 *         urlSchemeTask.didReceive(urlResponse)   // no status, no headers
 *     } else {
 *         urlSchemeTask.didReceive(httpResponse!) // status 200
 *     }
 *
 * A `URLResponse` has no status code, so `fetch()` surfaces it as `status: 0`, which
 * makes `Response.ok` false. The asset door reads that — correctly, by its own rules —
 * as "the server answered, authoritatively, that this is not there", caches the absence
 * and gives up. Every `Music/*.m4a` track is a `mustHave`, so the first one took the
 * whole game to the fatal screen: "Some of the game's files are missing." The file was
 * in the bundle the entire time, at the right path and the right size.
 *
 * It is deliberate on Capacitor's side, not an oversight — AVFoundation wants a plain
 * `URLResponse` to stream `<video>`/`<audio>` elements — which is why the fix here is to
 * take the other branch rather than to argue with it.
 *
 * ── The fix ───────────────────────────────────────────────────────────────────
 *
 * Ask for a range. `Range: bytes=0-` is the whole file, and it moves the handler onto its
 * 206 path, which builds a proper `HTTPURLResponse` (`Accept-Ranges`, `Content-Range`,
 * `Content-Length` and all). 206 is `ok`, the body is complete, and nothing downstream
 * needs to know any of this happened.
 *
 * ── Why it is gated on the native host ────────────────────────────────────────
 *
 * The header would be harmless on the web — a static host answers `bytes=0-` with 206 and
 * the same bytes — but "harmless" is not a reason to make every player's music request
 * carry a workaround for a bug none of their browsers have. It is also the honest
 * shape: this is a property of one host, so it lives behind a check for that host, in the
 * platform layer, next to the other thing that is true of one platform only.
 */

/** Media extensions Capacitor's asset handler answers without an HTTP status. */
const CAPACITOR_MEDIA_EXT = new Set(['m4v', 'mov', 'mp4', 'aac', 'ac3', 'aiff', 'au', 'flac', 'm4a', 'mp3', 'wav']);

/**
 * Is the app running inside the native shell rather than a browser?
 *
 * Capacitor loads the app from `capacitor://localhost`, so the scheme is the tell and it
 * is available before anything else boots. Guarded because `location` is absent in the
 * unit suite's default environment.
 */
export function isNativeHost(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'capacitor:';
}

/**
 * The `RequestInit` to fetch `url` with, given the host we are on.
 *
 * Returns `init` untouched everywhere except the native host asking for a media file,
 * which is the one case that needs the `Range` header above. Called for every asset, so
 * it stays cheap and total: no throwing, no allocation on the common path.
 */
export function hostFetchInit(url: string, init?: RequestInit): RequestInit | undefined {
  if (!isNativeHost()) return init;
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  if (!CAPACITOR_MEDIA_EXT.has(ext)) return init;
  // `bytes=0-` is "from the start to the end" — the whole file, by the one route that
  // comes back with a status code attached.
  return { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Range: 'bytes=0-' } };
}
