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
 * Every request for a GAME ASSET comes through this file — `test/asset-fetch-discipline.test.ts`
 * fails the build for a bare `fetch(` anywhere else — and there are exactly two ways in:
 *
 *  - **`requiredAsset(url, what, tier)`** — the file must be there. An answer of "not
 *    there" is a `MissingAssetError`; no answer at all is a `TransientAssetError`.
 *  - **`optionalAsset(url, tier)`** — absence is the DESIGN. Returns null when the server
 *    says "not there"; a failure still throws.
 *
 * That door is about ABSENCE. What happens when the asset does not arrive is the second,
 * independent question, and it is the `tier` — see the block below. The two used to be
 * one, and conflating them is what produced a game where moving the mouse across the
 * world map could end the session.
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
 * "Game asset" is doing real work in that sentence, and the two things it excludes are
 * worth knowing before someone reads it as "no request escapes". `src/platform/analytics.ts`
 * appends a third-party `<script>`, and `index.html` pulls a cover image from CSS; neither
 * is an asset the game plays with, neither can be tiered (nothing about the game changes
 * if they fail), and neither goes near `fetch`, so the discipline test does not see them
 * either. Anything the GAME needs belongs here.
 *
 * One loader is a genuine exemption rather than an omission: the intro movie, which is
 * a `<video src>` in `intro.ts`. A media element streams, and its `error` event cannot
 * tell a 404 from a dropped connection — the one distinction everything here rests on —
 * so routing it through this door would buy a label the platform cannot supply. The intro
 * is skippable by design. `test/asset-fetch-discipline.test.ts` records that in the one
 * place someone would look before adding a second such loader.
 *
 * ── The three tiers ───────────────────────────────────────────────────────────
 *
 * The doors above answer "may this be absent?". The `tier` answers the other question,
 * and it is the one the player experiences:
 *
 * | tier | on failure | the test for membership |
 * | --- | --- | --- |
 * | `mustHave`   | fatal — the one failure screen, Reload | the game cannot run, or cannot be played correctly, without it |
 * | `shouldHave` | keep playing, show a visible note, offer a retry | the game runs, but the player is getting materially less than they asked for AND would not otherwise know |
 * | `niceToHave` | silent; retry on the next natural occasion | cosmetic or incidental; interrupting anyone would cost more than the loss |
 *
 * The middle tier's test is the important one, and it is deliberately about being
 * MISLED, not about being annoyed: the game is playable and is telling the player
 * something untrue, so it says so. The clearest examples are the help pages and the
 * minigame — open them with the network down and, without the note, an EMPTY overlay is
 * all the player gets and they conclude that is what the help looks like.
 *
 * A word on the archetype this tier is often explained with, because it is NOT one of
 * these: the v1.0.18 bug, where the setting said "AI upscaled" while the room drew
 * enhanced art. A room's art at any tier is `mustHave` here (everything a room will use
 * is preloaded on the deliberate act of entering it), so that case never reaches the
 * note. A note is also the wrong shape for it — it is dismissible, and the setting goes
 * on lying afterwards. That one wants the effective tier shown, not a transient message,
 * and that is a separate change.
 *
 * The retry is offered when a call site supplies one. The backstop below cannot: it is
 * reached precisely because nobody handled the failure, so there is nothing there that
 * knows how to re-run it, and the note hides the button rather than offering one that
 * does nothing.
 *
 * ── The rule that makes the tier necessary ────────────────────────────────────
 *
 *   **No interaction-driven fetch may be `mustHave`.**
 *
 * If an asset can be requested as a side effect of moving the mouse, hovering, or a draw
 * frame, it is `shouldHave` at most. This is not a preference. Every version of this file
 * before it made every asset fatal, and the world map fetches a room's name plaque WHEN
 * YOU HOVER IT (mapDraw.ts — 140 of them at ×4 would be ~30 MB to hold, so they are
 * fetched and evicted on demand). Moving the mouse across the map could therefore end the
 * session. `test/asset-tier-discipline.test.ts` enumerates the loaders reachable from a
 * draw or pointer path and fails the build if one of them asks for `mustHave`.
 *
 * Deliberate, player-initiated actions — entering a room, opening the help, starting a
 * cutscene — are NOT interaction-driven in this sense. The distinction is whether the
 * player asked for the thing that is now failing. Everything a room will use is fetched
 * up front, on the deliberate act of entering it, and is `mustHave`.
 *
 * ── What the tier does, and what it does NOT do ───────────────────────────────
 *
 * The tier is carried on the error, and `loadingUi.ts` routes on it: the failure screen
 * for `mustHave`, the note (`loadNote.ts`) for `shouldHave`, nothing for `niceToHave`.
 * That is a BACKSTOP — it guarantees a forgotten failure is never reported more loudly
 * than its tier, which is what makes an unhandled rejection safe again.
 *
 * It cannot, however, make the caller carry on: a throw abandons the rest of the
 * function, so "keep playing" is something the call site has to implement. A `shouldHave`
 * or `niceToHave` load that is AWAITED on a path the game needs to finish (boot, opening
 * the help) must catch its own asset error and fall back, or it will take that path down
 * regardless of how quietly the failure is reported. The tier says how loud; the call
 * site says what happens next.
 */

/**
 * How much it costs the player when this asset does not arrive.
 *
 * Required at every call site and with no default, deliberately: the previous design
 * defaulted to fatal so that FORGETTING failed closed, which was right when there were
 * two outcomes. With three, "forgetting" has to be a type error instead, because the safe
 * default is different for a room's FFR and for a plaque fetched on hover, and no single
 * choice is safe for both.
 */
export type AssetTier = 'mustHave' | 'shouldHave' | 'niceToHave';

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
  /** How loudly this failure may be reported. See `AssetTier`. */
  readonly tier: AssetTier;
  constructor(url: string, why: string, tier: AssetTier, cause?: unknown, what?: string) {
    super(`${url}: ${why}`, cause === undefined ? undefined : { cause });
    this.name = 'TransientAssetError';
    this.url = url;
    this.what = what;
    this.tier = tier;
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
  /** How loudly this failure may be reported. See `AssetTier`. */
  readonly tier: AssetTier;
  constructor(url: string, what: string, tier: AssetTier, why: string) {
    super(`${what}: ${url} ${why}`);
    this.name = 'MissingAssetError';
    this.url = url;
    this.what = what;
    this.tier = tier;
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
 * ── The cooldown, and why only `niceToHave` has one ───────────────────────────
 *
 * "Retry on the next natural occasion" falls out of a rule that is already here: since
 * #66 a FAILED load is not remembered, so the next hover, the next frame, the next open
 * simply asks again. For a deliberate act that is exactly right — the player did
 * something, and the game tries again.
 *
 * For an INCIDENTAL one it needs a floor. The map's plaques are fetched on hover and the
 * cutscene's frames from the draw path, so against a dead server "ask again next time" is
 * bounded only by how fast the gestures come.
 *
 * ── What it is actually worth, measured ───────────────────────────────────────
 * Less than it first appears, and the honest number belongs here rather than in a PR
 * nobody will re-read. Both of today's incidental loaders already hold an IN-FLIGHT set
 * (`aiPlaqueLoading`, `aiKufrLoading`), and with a 1.25 s retry budget that set is
 * occupied almost all of the time — so the gestures coalesce on their own. Measured on
 * the world map with the cooldown disabled: twenty alternating room-panel opens over
 * about a second produced TWO plaque requests, not twenty.
 *
 * So this is not what stops a request per mouse move; the in-flight guards are. What it
 * adds is a bound that does not depend on every future call site remembering to have one,
 * and a ~4x cut in the sustained rate against a server that is down (three attempts per
 * five seconds per URL, rather than three per 1.25 s). That is worth twelve lines. It is
 * NOT worth a browser probe — the effect is too small to separate from the in-flight
 * guard there, and `test/assetFetch.test.ts` proves the mechanism exactly, on an injected
 * clock, for a millisecond.
 *
 * The entry is only ever written on a failure, so a working asset never touches it, and
 * it expires on its own rather than needing anyone to clear it.
 *
 * It is deliberately NOT applied to the other two tiers. A `mustHave` retry happens on a
 * path the player asked for and is waiting on, and a `shouldHave` one happens when they
 * press Try again — refusing either would be the game ignoring a direct instruction
 * because of something that happened three seconds ago.
 */
const NICE_COOLDOWN_MS = 5000;
const niceFailedAt = new Map<string, number>();

/** For tests, and for the `__ff` hook a probe uses to stop waiting out a real cooldown. */
export function resetAssetCooldowns(): void {
  niceFailedAt.clear();
}

/**
 * Record that a `niceToHave` URL just failed, so the draw path stops asking for a while.
 *
 * Shared by the two places a failure is decided — `fetchAsset`'s catch (no answer) and
 * `requiredAsset`'s check (an answer that is not the asset). Both have to arm it or the
 * bound is only half there; see the note in `requiredAsset`.
 */
function noteNiceFailure(url: string, tier: AssetTier, retry?: RetryPolicy): void {
  if (tier !== 'niceToHave') return;
  niceFailedAt.set(url, (retry?.now ?? Date.now)());
}

/** Is this `niceToHave` URL still inside its refusal window? */
function coolingDown(url: string, tier: AssetTier, retry?: RetryPolicy): boolean {
  if (tier !== 'niceToHave') return false;
  const failed = niceFailedAt.get(url);
  if (failed === undefined) return false;
  return (retry?.now ?? Date.now)() - failed < (retry?.cooldownMs ?? NICE_COOLDOWN_MS);
}

/**
 * Would asking for this URL right now be refused? For callers on a DRAW path.
 *
 * The cooldown bounds requests on its own, but a draw-path loader that re-arms its
 * "tried" latch on every failure re-enters every frame — and inside the window each
 * re-entry still allocates an error, rejects a promise and logs. Requests were bounded;
 * work, garbage and console noise were not, which at 60 fps in a cutscene is hundreds of
 * logged failures the tier promised would be silent.
 *
 * So the three incidental loaders ask FIRST and return quietly, instead of asking and
 * being refused. That also gives the latch a correct shape: it is cleared on failure (a
 * failed load is not remembered, #66) and this is what stops the clearing turning into a
 * spin — the next attempt happens on the first repaint after the window, not the next
 * frame.
 */
export function assetCoolingDown(url: string): boolean {
  return coolingDown(url, 'niceToHave');
}

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
  /** The clock the `niceToHave` cooldown is measured on. For tests. */
  now?: () => number;
  /** How long a failed `niceToHave` URL is refused for. For tests. */
  cooldownMs?: number;
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
async function fetchAsset(url: string, tier: AssetTier, what?: string, init?: RequestInit, retry?: RetryPolicy): Promise<Response> {
  const nextDelay = retry?.delayMs ?? retryDelayMs;
  const sleep = retry?.sleep ?? realSleep;
  const now = retry?.now ?? Date.now;
  const cooldown = retry?.cooldownMs ?? NICE_COOLDOWN_MS;
  // Refused before the first attempt rather than after it, so a failing server sees no
  // request at all. The caller is told the same thing it would have been told by a real
  // failure — a transient error at its own tier — because "we did not ask" and "we asked
  // and got nothing" leave the caller in exactly the same position, and giving the two
  // different shapes would only be a second path for a call site to get wrong.
  if (coolingDown(url, tier, retry))
    throw new TransientAssetError(url, 'not retried yet — cooling down after a recent failure', tier, undefined, what);
  for (let attempt = 0; ; attempt++) {
    // One controller per attempt: aborting a stalled attempt must not poison the retry.
    const stall = new AbortController();
    const timer = setTimeout(() => stall.abort(new Error('no response headers')), retry?.headersMs ?? HEADERS_TIMEOUT_MS);
    try {
      // The caller's own signal still has to work — it is how a room that has been left
      // cancels its loads — so the two are combined rather than one replacing the other.
      const signal = init?.signal ? AbortSignal.any([init.signal, stall.signal]) : stall.signal;
      const res = await fetch(url, { ...init, signal });
      if (retryableStatus(res.status)) throw new TransientAssetError(url, `HTTP ${res.status}`, tier, undefined, what);
      return res;
    } catch (e) {
      // Only OUR classification is retried. A caller-thrown error, or anything the
      // labelling below decided was an answer, leaves immediately.
      const err = e instanceof TransientAssetError ? e : new TransientAssetError(url, 'network error', tier, e, what);
      // An abort the CALLER asked for is not a failure to recover from — it is the app
      // saying it no longer wants this. Retrying it would fight the page that navigated
      // away, and would keep a load alive after the room that wanted it is gone.
      const cancelled = init?.signal?.aborted === true;
      const delay = cancelled ? null : nextDelay(attempt);
      if (delay === null) {
        // Only a genuine failure arms the cooldown. A cancelled load learned nothing
        // about the server, and locking the URL out for five seconds because the player
        // left a room would make the next entry draw without art it could have had.
        if (!cancelled) noteNiceFailure(url, tier, retry);
        throw err;
      }
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
export async function assetBlob(url: string, res: Response, tier: AssetTier, what?: string): Promise<Blob> {
  try {
    return await res.blob();
  } catch (e) {
    throw new TransientAssetError(url, 'truncated response', tier, e, what);
  }
}

/**
 * Read a response body as bytes, treating a failure as transient.
 *
 * Same hazard as assetBlob, and the one the CORE room assets hit: an FFR whose headers
 * arrived and whose body did not rejects here with a bare `TypeError`, which is I/O and
 * must be retried rather than reported to the player as a broken game.
 */
export async function assetBytes(url: string, res: Response, tier: AssetTier, what?: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    throw new TransientAssetError(url, 'truncated response', tier, e, what);
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
 * `what` is the sentence fragment the player will read on the failure screen or the note
 * ("the world map", "the music for room 7"), so it is written for them, not for a log.
 * `tier` is how loudly this one may fail — see `AssetTier`, and read the rule about
 * interaction-driven fetches before reaching for `mustHave`.
 */
export async function requiredAsset(url: string, what: string, tier: AssetTier, opts?: AssetOptions): Promise<Response> {
  const res = await fetchAsset(url, tier, what, opts?.init, opts?.retry);
  const why = notTheAsset(res, opts?.expect);
  if (why !== null) {
    // A permanent answer arms the cooldown too, and it is the case that needs it MORE.
    // `fetchAsset` can only arm on a transient failure, because a 404 is not an error
    // down there — it returns normally and the judgement happens here. That left the
    // worst combination unbounded: a `niceToHave` asset a manifest promises and the
    // deploy does not have gets no cooldown (nothing armed it) and no memory (a failed
    // load is deliberately not remembered), so the draw path re-requests it on every
    // repaint that wants it, for ever, silently. A hovered plaque repaints ~7x/s.
    noteNiceFailure(url, tier, opts?.retry);
    throw new MissingAssetError(url, what, tier, why);
  }
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
 * `TransientAssetError` here exactly as it does everywhere else — at the `tier` given,
 * which is why one is required even though absence itself is free.
 */
export async function optionalAsset(url: string, tier: AssetTier, opts?: AssetOptions): Promise<Response | null> {
  const res = await fetchAsset(url, tier, undefined, opts?.init, opts?.retry);
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
export async function assetText(url: string, res: Response, tier: AssetTier, what?: string): Promise<string> {
  try {
    return await res.text();
  } catch (e) {
    throw new TransientAssetError(url, 'truncated response', tier, e, what);
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
export async function assetJson<T>(url: string, res: Response, tier: AssetTier, what?: string): Promise<T> {
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
    if (e instanceof SyntaxError) throw new MissingAssetError(url, what ?? 'A game file', tier, 'answered with a body that is not JSON');
    throw new TransientAssetError(url, 'unreadable manifest', tier, e, what);
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
export async function requiredBytes(url: string, what: string, tier: AssetTier, opts?: AssetOptions): Promise<Uint8Array> {
  return assetBytes(url, await requiredAsset(url, what, tier, opts), tier, what);
}

export async function requiredText(url: string, what: string, tier: AssetTier, opts?: AssetOptions): Promise<string> {
  return assetText(url, await requiredAsset(url, what, tier, opts), tier, what);
}

export async function requiredJson<T>(url: string, what: string, tier: AssetTier, opts?: AssetOptions): Promise<T> {
  return assetJson<T>(url, await requiredAsset(url, what, tier, { expect: 'json', ...opts }), tier, what);
}

export async function requiredBlob(url: string, what: string, tier: AssetTier, opts?: AssetOptions): Promise<Blob> {
  return assetBlob(url, await requiredAsset(url, what, tier, { expect: 'image', ...opts }), tier, what);
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
export async function decodeAsset<T>(url: string, tier: AssetTier, decode: () => Promise<T>): Promise<T> {
  try {
    return await decode();
  } catch (e) {
    throw new TransientAssetError(url, 'decode failed', tier, e);
  }
}

