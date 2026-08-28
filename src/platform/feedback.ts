/**
 * Player feedback: what a report contains, and the three ways out of the page.
 *
 * The site is static on GitHub Pages — there is no server to POST to and none is
 * wanted — so a report leaves the browser through something the player already has:
 *
 *   1. a prefilled **GitHub issue** (structured, public, needs an account),
 *   2. a prefilled **email** (`mailto:`, no account, may open nothing on a machine
 *      with no mail client configured),
 *   3. **copy to clipboard**, the fallback for when neither of those works.
 *
 * GitHub alone was rejected deliberately: requiring an account would filter out most
 * of this game's audience.
 *
 * NOTHING IS EVER SENT AUTOMATICALLY. This module only *builds text and links*; the
 * player reads the finished report and chooses an exit. That is a GDPR position, not
 * a nicety — the audience is largely EU/Czech — so there is no beacon here, no
 * pre-ticked consent, and no collection that happens before the form is opened.
 *
 * Everything below is pure: it takes the facts it is given and returns strings, so
 * what a report contains is decided in one place and unit-tested (test/feedback.test.ts).
 * The DOM half lives in src/app/feedback.ts.
 */

/**
 * The address reports are mailed to — deliberately a dedicated, disposable one, not
 * a personal address, so it can be filtered or abandoned if it attracts spam.
 *
 * It is NOT obfuscated. It will sit in a public repo and bots will harvest it; that
 * is accepted and is exactly why the address is disposable. Entity-encoding and
 * JS-assembly tricks defeat `mailto:` handling (and screen readers, and copy-paste)
 * far more reliably than they defeat scrapers.
 *
 * One constant, one place to change it.
 */
export const FEEDBACK_EMAIL = 'fish_fillets@icloud.com';

/** The public repository reports are filed against. */
export const FEEDBACK_REPO = 'ff4e/ff4e.github.io';

/** Issue-form file names under `.github/ISSUE_TEMPLATE/`, selected by `?template=`. */
export const BUG_TEMPLATE = 'bug_report.yml';
export const IDEA_TEMPLATE = 'idea.yml';

/**
 * Field ids in `.github/ISSUE_TEMPLATE/bug_report.yml` / `idea.yml`.
 *
 * A GitHub issue FORM is prefilled by field id (`?template=x.yml&<id>=<value>`), and a
 * value whose id does not exist is dropped without a word — so a rename in the YAML
 * would silently start filing empty reports. test/feedback.test.ts reads the YAML back
 * and asserts these ids still exist, which is the only thing standing between the two.
 */
export const BUG_FIELDS = {
  what: 'what-happened',
  where: 'where',
  record: 'move-record',
  diagnostics: 'diagnostics',
} as const;

export const IDEA_FIELDS = {
  idea: 'idea',
  version: 'version',
} as const;

/**
 * Safe ceiling for a generated `https://github.com/…/issues/new?…` link.
 *
 * A URL has no single limit; the smallest one on the path wins. Browsers are generous
 * (Chrome ~2 MB), but servers are not — 8 KB is the usual request-line ceiling, and
 * GitHub starts refusing well before it. 6000 leaves room under that and still carries
 * a move record of several thousand moves, which no real room needs. Over budget, the
 * record is dropped rather than a 414 being produced (see fitUrl).
 */
export const MAX_ISSUE_URL = 6000;

/**
 * Safe ceiling for a `mailto:` link — much lower, and for a different reason: the URL
 * is handed to the OS, and the classic Windows `ShellExecute` path caps the whole
 * command at 2048 characters, with Outlook truncating a long body silently rather than
 * failing loudly. A silently truncated report is worse than one that says what it left
 * out, so the budget sits below that line and the omission is written into the body.
 */
export const MAX_MAILTO_URL = 1800;

/** How much of the player's own text a link may carry before it is clamped. */
const CLAMP_MARK = '\n…(cut short to fit in this link — use “Copy report” for the whole thing)';

/**
 * How much of the player's own words is worth keeping a move record for.
 *
 * When a link overflows, one of the two has to give. Below this many characters the
 * player's own account of what went wrong wins: a record with no description of the
 * bug is a list of moves nobody knows what to look for in, which is worse than a
 * description with no record. Above it, the description is shortened and the record
 * — the thing that cannot be reconstructed later — is kept.
 */
const KEEP_DESCRIPTION = 600;

/**
 * Ceiling on the user agent, measured on its PERCENT-ENCODED length, because that is
 * what a URL budget is spent in. Counting characters instead lets a UA of spaces
 * (`%20`) cost three times its length, and a non-ASCII one up to nine — which is how a
 * "clamped" field still pushed a `mailto:` past the ceiling it was clamped for.
 */
const MAX_USER_AGENT_ENCODED = 400;

/**
 * Cut `text` to at most `n` UTF-16 units WITHOUT splitting a surrogate pair.
 *
 * A plain `slice` cuts on code units, so a cut that lands inside an emoji leaves a lone
 * high surrogate — and `encodeURIComponent` throws `URIError: URI malformed` on one.
 * That is not a theoretical string: the clamp starts biting at ~1100 characters of
 * `mailto:` description, which is an ordinary length for a careful bug report, and one
 * emoji anywhere in it was enough.
 */
function clampText(text: string, n: number): string {
  if (n >= text.length) return text;
  if (n <= 0) return '';
  const code = text.charCodeAt(n - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n);
}

/** Cut `text` until its percent-encoded form fits `maxEncoded`. */
function clampEncoded(text: string, maxEncoded: number): string {
  let s = text;
  for (let i = 0; i < 40 && s.length > 0; i++) {
    const over = encodeURIComponent(s).length - maxEncoded;
    if (over <= 0) break;
    s = clampText(s, Math.max(0, s.length - Math.max(1, Math.ceil(over / 3))));
  }
  return s;
}

/** Is this a defect report or a suggestion? Decides what the report may collect. */
export type FeedbackKind = 'bug' | 'idea';

/** A width/height pair, or null when the browser would not say. */
export interface Size {
  w: number;
  h: number;
}

/**
 * Everything a report may quote about the running game.
 *
 * Every field is nullable, and a null field produces no line at all rather than the
 * word "null" — a report is read by a human, and a wall of unknowns costs attention
 * without buying anything.
 */
export interface FeedbackFacts {
  version: string | null;
  buildHash: string | null;
  buildDate: string | null;
  /** Which screen the player was on: 'room', 'map', 'intro', 'legimage'. */
  screen: string | null;
  roomNum: number | null;
  /** The room's original 8-char name (Desc[].Jmeno), e.g. "KORALY". */
  roomName: string | null;
  /** The room's English description, e.g. "Corals". */
  roomTitle: string | null;
  graphics: string | null;
  renderer: string | null;
  webgl2: boolean | null;
  subtitles: string | null;
  viewport: Size | null;
  screenSize: Size | null;
  userAgent: string | null;
  moves: number | null;
  /** The room's move record (engine.srecord), replayable move for move. */
  record: string | null;
}

/**
 * The narrow view of the world `collectFacts` is allowed to read.
 *
 * Deliberately an explicit interface rather than the real globals, exactly as the
 * device classifier does (src/app/deviceGate.ts): it makes the collection unit-testable
 * against a stub, and — the point — it makes the list of things a report CAN contain
 * a declaration you can read in ten seconds. There is no `localStorage` here, no
 * `document.cookie`, no saved game and no solved-room list, so none of them can end
 * up in a report by accident.
 */
export interface FeedbackEnv {
  build: { version: string; hash: string; date: string };
  game: {
    screen: string;
    roomNum: number | null;
    roomName: string | null;
    roomTitle: string | null;
    graphics: string;
    renderer: string;
    subtitles: string;
    moves: number;
    record: string;
  };
  win: {
    innerWidth?: number;
    innerHeight?: number;
    screen?: { width?: number; height?: number } | null;
    navigator?: { userAgent?: string } | null;
  };
  /** Whether WebGL2 was available at boot (the CPU fallback is otherwise invisible). */
  webgl2: boolean;
}

function size(w: unknown, h: unknown): Size | null {
  return typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0
    ? { w: Math.round(w), h: Math.round(h) }
    : null;
}

/**
 * Read the facts a report may quote, for the kind of report being written.
 *
 * An IDEA collects almost nothing: which build it was written against, and that is
 * all. A suggestion is not reproduced, so a renderer, a screen size and a user agent
 * would be a privacy cost with no reader — and a payload nobody reads is exactly that.
 *
 * A BUG collects the diagnostics that have actually decided past reports: the build
 * (which code is this), the room (where), the graphics tier / renderer / WebGL2
 * availability (the three rendering paths differ and only one of them is the default),
 * the subtitle language (it selects different assets), the window and screen size (the
 * layout is scale-driven), the user agent, and the move record.
 */
export function collectFacts(env: FeedbackEnv, kind: FeedbackKind): FeedbackFacts {
  const base: FeedbackFacts = {
    version: env.build.version || null,
    buildHash: env.build.hash || null,
    buildDate: env.build.date || null,
    screen: null,
    roomNum: null,
    roomName: null,
    roomTitle: null,
    graphics: null,
    renderer: null,
    webgl2: null,
    subtitles: null,
    viewport: null,
    screenSize: null,
    userAgent: null,
    moves: null,
    record: null,
  };
  if (kind === 'idea') return base;
  const ua = env.win.navigator?.userAgent;
  const inRoom = env.game.screen === 'room' && env.game.roomNum !== null;
  return {
    ...base,
    screen: env.game.screen || null,
    roomNum: inRoom ? env.game.roomNum : null,
    roomName: inRoom ? (env.game.roomName ?? null) : null,
    roomTitle: inRoom ? (env.game.roomTitle ?? null) : null,
    graphics: env.game.graphics || null,
    renderer: env.game.renderer || null,
    webgl2: env.webgl2,
    subtitles: env.game.subtitles || null,
    viewport: size(env.win.innerWidth, env.win.innerHeight),
    screenSize: size(env.win.screen?.width, env.win.screen?.height),
    userAgent: typeof ua === 'string' && ua ? clampEncoded(ua, MAX_USER_AGENT_ENCODED) : null,
    // A record only means anything inside the room it was recorded in.
    moves: inRoom ? env.game.moves : null,
    record: inRoom && env.game.record ? env.game.record : null,
  };
}

export interface ReportInput {
  kind: FeedbackKind;
  /** What the player typed. The only free text in a report. */
  description: string;
  facts: FeedbackFacts;
  /** Leave the move record out (it did not fit in the link that is being built). */
  omitRecord?: boolean;
}

export interface Report {
  title: string;
  /** The whole report as one block of text — the clipboard copy and the email body. */
  body: string;
  /** The same content, split into the issue form's fields (prefilled by id). */
  fields: Record<string, string>;
}

/** The build line, the one diagnostic every report carries. */
function buildLine(f: FeedbackFacts): string {
  if (!f.version) return '';
  const hash = f.buildHash ? ` (${f.buildHash}` : '';
  const date = f.buildHash && f.buildDate ? `, built ${f.buildDate.slice(0, 10)})` : hash ? ')' : '';
  return `Fish Fillets 4ever ${f.version}${hash}${date}`;
}

/** Where the player was, in words. Empty when the game would not say. */
export function whereLine(f: FeedbackFacts): string {
  if (f.roomNum !== null) {
    const name = f.roomName ?? '';
    const title = f.roomTitle ? ` (${f.roomTitle})` : '';
    return `Room ${f.roomNum}${name ? ` — ${name}` : ''}${title}`;
  }
  if (f.screen === 'map') return 'The world map';
  if (f.screen === 'intro') return 'The intro movie';
  if (f.screen === 'legimage') return 'A story page between rooms';
  return f.screen ? `Screen: ${f.screen}` : '';
}

/** The move-record section's text, or '' when there is no record to speak of. */
function recordText(f: FeedbackFacts, omit: boolean): string {
  if (f.record === null) return '';
  const moves = f.moves ?? 0;
  if (omit) {
    return (
      `${moves} moves. The record is ${f.record.length} characters — too long for this link, ` +
      'so it was left out. Use the form\'s “Copy report” button and paste it here.'
    );
  }
  return `${moves} moves:\n\n    ${f.record}`;
}

/** The diagnostics block, one fact per line, skipping whatever is unavailable. */
function diagnosticsText(f: FeedbackFacts): string {
  const lines: string[] = [];
  const build = buildLine(f);
  if (build) lines.push(build);
  const render: string[] = [];
  if (f.graphics) render.push(`graphics: ${f.graphics}`);
  if (f.renderer) render.push(`renderer: ${f.renderer}`);
  if (f.webgl2 !== null) render.push(`WebGL2: ${f.webgl2 ? 'yes' : 'no'}`);
  if (render.length) lines.push(render.join(' · '));
  if (f.subtitles) lines.push(`subtitles: ${f.subtitles}`);
  const sizes: string[] = [];
  if (f.viewport) sizes.push(`window ${f.viewport.w}×${f.viewport.h}`);
  if (f.screenSize) sizes.push(`screen ${f.screenSize.w}×${f.screenSize.h}`);
  if (sizes.length) lines.push(sizes.join(' · '));
  if (f.userAgent) lines.push(f.userAgent);
  return lines.join('\n');
}

/** `[bug] KORALY (room 34)` / `[idea] a hint after ten minutes stuck`. */
function reportTitle(input: ReportInput): string {
  if (input.kind === 'idea') {
    const first = input.description.trim().split('\n')[0]?.trim() ?? '';
    // clampText, not slice: an idea whose first line runs long is cut here, and cutting
    // through an emoji leaves a lone surrogate that encodeURIComponent refuses.
    return `[idea] ${first.length > 60 ? `${clampText(first, 57)}…` : first}`.trimEnd();
  }
  const f = input.facts;
  if (f.roomNum !== null) {
    return `[bug] ${f.roomName ? `${f.roomName} ` : ''}(room ${f.roomNum})`;
  }
  const where = whereLine(f);
  return `[bug] ${where ? where.toLowerCase() : 'the game'}`;
}

/**
 * Assemble a report: the title, the whole thing as one block of text, and the same
 * content split into the issue form's fields.
 *
 * The two renderings must stay the same information — the form shows the player the
 * block, and it would be a lie if the issue carried something else.
 */
export function buildReport(input: ReportInput): Report {
  const f = input.facts;
  const description = input.description.trim();
  const title = reportTitle(input);

  if (input.kind === 'idea') {
    const version = buildLine(f);
    const body = [
      '### The idea',
      '',
      description || '_(nothing written)_',
      ...(version ? ['', '### Version', '', version] : []),
      '',
    ].join('\n');
    return {
      title,
      body,
      fields: { [IDEA_FIELDS.idea]: description, [IDEA_FIELDS.version]: version },
    };
  }

  const where = whereLine(f);
  const record = recordText(f, input.omitRecord === true);
  const diagnostics = diagnosticsText(f);
  const parts: string[] = ['### What happened', '', description || '_(nothing written)_'];
  if (where) parts.push('', '### Where', '', where);
  if (record) parts.push('', '### Move record', '', record);
  if (diagnostics) parts.push('', '### Diagnostics', '', diagnostics);
  parts.push('');
  return {
    title,
    body: parts.join('\n'),
    fields: {
      [BUG_FIELDS.what]: description,
      [BUG_FIELDS.where]: where,
      [BUG_FIELDS.record]: record,
      [BUG_FIELDS.diagnostics]: diagnostics,
    },
  };
}

/** A generated link, and what it could not carry. */
export interface FeedbackLink {
  url: string;
  /** The move record was dropped: the link could not hold it. */
  recordOmitted: boolean;
  /** The player's own text was cut short to fit. */
  clamped: boolean;
  /** Everything that could be shed was shed and the link is STILL over budget. */
  oversize: boolean;
}

function query(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * The longest prefix of the player's text for which the link still fits.
 *
 * A bisection, not "shave off the overflow and try again". The overflow is measured in
 * PERCENT-ENCODED characters while a cut removes RAW ones, and those are not the same
 * currency: a Czech diacritic encodes to six characters and an emoji to twelve, so
 * subtracting one from the other over-cuts by the encoding factor. That is not a
 * rounding error for this game's audience — measured on random long Czech reports, ~10%
 * lost their move record to the KEEP_DESCRIPTION floor in `fitUrl` while a link that
 * kept BOTH the record and a longer description was available, and the form then told
 * the player the record "is too long to fit in a link", which was untrue.
 *
 * The URL's length grows monotonically with the description, so the longest fitting
 * prefix is exactly what a bisection finds — and it finds it in ~12 rounds of `make`
 * rather than the heuristic's 60, without any convergence argument to get wrong.
 */
function clampToFit(
  make: (input: ReportInput) => string,
  input: ReportInput,
  budget: number,
): { url: string; description: string } {
  const full = make(input);
  if (full.length <= budget) return { url: full, description: input.description };

  const at = (n: number): { url: string; description: string } => {
    // clampText may return n-1 characters (never splitting a surrogate pair), which
    // keeps the search monotonic — it only ever shortens.
    const description = clampText(input.description, n);
    return { url: make({ ...input, description: description + CLAMP_MARK }), description };
  };

  let lo = 0;
  let hi = input.description.length;
  // The zero-length case is the floor: if even that is over budget, it is what gets
  // returned and `fitUrl` reports the link as oversize rather than pretending.
  let best = at(0);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cand = at(mid);
    if (cand.url.length <= budget) {
      best = cand;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Build a link and, if it is over budget, shed content until it fits — in the order
 * that costs the report least.
 *
 * The player's own text goes first, and it is shortened rather than dropped. Only once
 * shortening it would take it below KEEP_DESCRIPTION does the move record go instead —
 * and then it goes WHOLE. A truncated record is not a shorter record: the replay
 * reproduces a bug by re-running the moves from the start, so a record missing its tail
 * replays into a position that is not the one being reported, which is worse than no
 * record at all because it looks like one. What is left is a line saying how long the
 * record was and where to get it; the clipboard copy always carries it in full.
 *
 * The record is never dropped when dropping it would not actually save space — the
 * apology that replaces it is ~130 characters, so sacrificing a short record buys
 * nothing and puts a falsehood ("too long for this link") in front of whoever reads the
 * report.
 */
function fitUrl(
  make: (input: ReportInput) => string,
  input: ReportInput,
  budget: number,
): FeedbackLink {
  const url = make(input);
  if (url.length <= budget) {
    return { url, recordOmitted: false, clamped: false, oversize: false };
  }

  // 1. Keep the record, shorten the text — as long as enough of the text survives.
  const kept = clampToFit(make, input, budget);
  const floor = Math.min(KEEP_DESCRIPTION, input.description.length);
  const keptFits = kept.url.length <= budget && kept.description.length >= floor;
  const keptLink = (): FeedbackLink => ({
    url: kept.url,
    recordOmitted: false,
    clamped: kept.description.length < input.description.length,
    oversize: kept.url.length > budget,
  });
  if (keptFits) return keptLink();

  // 2. The text cannot give any more. Drop the record — but only if that buys space.
  const f = input.facts;
  const worthDropping =
    f.record !== null && recordText(f, true).length < recordText(f, false).length;
  if (!worthDropping) return keptLink();

  const dropped = clampToFit(make, { ...input, omitRecord: true }, budget);
  const droppedLink = (): FeedbackLink => ({
    url: dropped.url,
    recordOmitted: true,
    clamped: dropped.description.length < input.description.length,
    oversize: dropped.url.length > budget,
  });
  // Keeping the record produced no usable link at all: take whichever is smaller, and
  // let `oversize` say so if even that one does not fit.
  if (kept.url.length > budget) {
    return dropped.url.length < kept.url.length ? droppedLink() : keptLink();
  }
  // Both fit; the record only goes if giving it up hands the player back some of their
  // own words. Sacrificing it to gain nothing is the trade this whole branch exists to
  // avoid.
  return dropped.url.length <= budget && dropped.description.length > kept.description.length
    ? droppedLink()
    : keptLink();
}

/**
 * A prefilled GitHub issue, targeting the matching issue FORM by name.
 *
 * `?template=` is deliberate rather than the plain `?body=`: it puts the report into
 * the form's own fields, so a report filed from the game and one typed by hand arrive
 * in the same shape — and it bypasses the template chooser, which `/issues/new` would
 * otherwise redirect to now that the repo has forms.
 */
export function buildIssueUrl(input: ReportInput): FeedbackLink {
  const template = input.kind === 'bug' ? BUG_TEMPLATE : IDEA_TEMPLATE;
  const make = (i: ReportInput): string => {
    const r = buildReport(i);
    return `https://github.com/${FEEDBACK_REPO}/issues/new?${query({ template, title: r.title, ...r.fields })}`;
  };
  return fitUrl(make, input, MAX_ISSUE_URL);
}

/** A prefilled email to the one feedback address. */
export function buildMailtoUrl(input: ReportInput): FeedbackLink {
  const make = (i: ReportInput): string => {
    const r = buildReport(i);
    return `mailto:${FEEDBACK_EMAIL}?${query({ subject: r.title, body: r.body })}`;
  };
  return fitUrl(make, input, MAX_MAILTO_URL);
}

/** Everything the form needs: the text the player is shown, and the two links. */
export interface Feedback {
  report: Report;
  issue: FeedbackLink;
  email: FeedbackLink;
}

/**
 * The one call the UI makes.
 *
 * `report` is what the player reads and what “Copy report” puts on the clipboard: the
 * complete thing, record included. The links may carry less (see fitUrl), and say so
 * both in their flags — so the form can warn — and in their own body text, so whoever
 * receives one knows something was left behind.
 */
export function buildFeedback(input: ReportInput): Feedback {
  return {
    report: buildReport({ ...input, omitRecord: false }),
    issue: buildIssueUrl(input),
    email: buildMailtoUrl(input),
  };
}
