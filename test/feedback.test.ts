/**
 * The feedback payload (src/platform/feedback.ts).
 *
 * Three things are being pinned here, in order of how much it costs to get them wrong:
 *
 *  1. **What a report may contain.** `collectFacts` reads a declared, narrow view of
 *     the world, so the list of things that can end up in a report is a type. The tests
 *     below prove the negative side of that too — the collector cannot reach the
 *     player's storage, their saved game or their solved-room list, because a stub that
 *     explodes when those are touched passes through it untouched.
 *  2. **What happens when a field is missing.** A null field must vanish from the
 *     report, not print as "null" or "undefined". The whole report is read by a human.
 *  3. **What happens when it does not fit in a link.** A GitHub issue URL and a
 *     `mailto:` have hard practical ceilings, and a link that silently 414s (or that
 *     Outlook quietly truncates) is worse than one that says what it dropped.
 *
 * The issue-form field ids are checked against the YAML on disk: a prefill value whose
 * id does not exist is discarded by GitHub without a word, so a rename in the template
 * would otherwise start filing empty reports and nothing would notice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BUG_FIELDS,
  BUG_TEMPLATE,
  FEEDBACK_EMAIL,
  FEEDBACK_REPO,
  IDEA_FIELDS,
  IDEA_TEMPLATE,
  MAX_ISSUE_URL,
  MAX_MAILTO_URL,
  buildFeedback,
  buildIssueUrl,
  buildMailtoUrl,
  buildReport,
  collectFacts,
  whereLine,
  type FeedbackEnv,
  type FeedbackFacts,
} from '../src/platform/feedback.js';

/** A fully-populated environment: the game running in a room, in a real browser. */
function env(over: Partial<FeedbackEnv> = {}): FeedbackEnv {
  return {
    build: { version: '1.0.18', hash: '868c920', date: '2026-08-07T10:11:12.000Z' },
    game: {
      screen: 'room',
      roomNum: 34,
      roomName: 'KORALY',
      roomTitle: 'Corals',
      graphics: 'ai',
      renderer: 'webgl',
      subtitles: 'cz',
      moves: 3,
      record: 'IKJL',
    },
    win: {
      innerWidth: 1512,
      innerHeight: 850,
      screen: { width: 1512, height: 982 },
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh) TestBrowser/1.0' },
    },
    webgl2: true,
    ...over,
  };
}

const facts = (over: Partial<FeedbackEnv> = {}): FeedbackFacts => collectFacts(env(over), 'bug');

describe('collectFacts — what a report may contain', () => {
  it('collects the diagnostics that decide a bug report', () => {
    const f = facts();
    expect(f).toMatchObject({
      version: '1.0.18',
      buildHash: '868c920',
      screen: 'room',
      roomNum: 34,
      roomName: 'KORALY',
      roomTitle: 'Corals',
      graphics: 'ai',
      renderer: 'webgl',
      webgl2: true,
      subtitles: 'cz',
      viewport: { w: 1512, h: 850 },
      screenSize: { w: 1512, h: 982 },
      moves: 3,
      record: 'IKJL',
    });
  });

  it('collects almost nothing for an idea — a suggestion is not reproduced', () => {
    const f = collectFacts(env(), 'idea');
    expect(f.version).toBe('1.0.18');
    // Everything a bug needs in order to be REPRODUCED is a privacy cost with no
    // reader on a suggestion, so none of it is gathered in the first place.
    for (const k of [
      'screen',
      'roomNum',
      'graphics',
      'renderer',
      'webgl2',
      'subtitles',
      'viewport',
      'screenSize',
      'userAgent',
      'moves',
      'record',
    ] as const) {
      expect(f[k], `idea reports must not carry ${k}`).toBeNull();
    }
  });

  it('never reaches the player’s storage, saved game or progress', () => {
    // The collector is handed an environment that BOOMS if any of these is read. This
    // is not only a type-level claim: src/app/feedback.ts narrows the real `window`
    // into this shape at the call site rather than passing `window` itself, so at
    // runtime the builder is holding four numbers and a string and cannot reach
    // storage, cookies or the URL even if someone later widened the interface.
    const boom = (name: string) => () => {
      throw new Error(`feedback must not read ${name}`);
    };
    const hostile = env() as FeedbackEnv & Record<string, unknown>;
    Object.defineProperty(hostile.win, 'localStorage', { get: boom('localStorage') });
    Object.defineProperty(hostile.win, 'sessionStorage', { get: boom('sessionStorage') });
    Object.defineProperty(hostile.win, 'document', { get: boom('document') });
    Object.defineProperty(hostile.win, 'location', { get: boom('location') });
    Object.defineProperty(hostile.game, 'solved', { get: boom('solved rooms') });
    Object.defineProperty(hostile.game, 'save', { get: boom('the saved game') });
    expect(() => collectFacts(hostile, 'bug')).not.toThrow();
    const body = buildReport({ kind: 'bug', description: 'x', facts: collectFacts(hostile, 'bug') }).body;
    expect(body).not.toMatch(/localStorage|sessionStorage|cookie/i);
  });

  it('drops the move record outside a room — it only means something in one', () => {
    const onMap = facts({
      game: { ...env().game, screen: 'map', roomNum: null, record: 'IKJL', moves: 3 },
    });
    expect(onMap.record).toBeNull();
    expect(onMap.moves).toBeNull();
    expect(onMap.roomName).toBeNull();
    expect(onMap.screen).toBe('map');
  });

  it('reports no record when the player has not moved yet', () => {
    expect(facts({ game: { ...env().game, record: '', moves: 0 } }).record).toBeNull();
  });

  it('survives a browser that will not say how big it is', () => {
    const blind = facts({ win: { innerWidth: 0, innerHeight: 0, screen: null, navigator: null } });
    expect(blind.viewport).toBeNull();
    expect(blind.screenSize).toBeNull();
    expect(blind.userAgent).toBeNull();
  });

  it('clamps an absurd user agent — measured on the length a URL actually pays', () => {
    // Characters are not the currency: a space costs `%20`, a non-ASCII character up to
    // nine. Clamping on character count let a "clamped" UA still push a mailto past the
    // ceiling it was clamped for.
    for (const filler of ['U', ' ', ';', 'ř']) {
      const f = facts({ win: { ...env().win, navigator: { userAgent: filler.repeat(5000) } } });
      expect(encodeURIComponent(f.userAgent!).length).toBeLessThanOrEqual(400);
    }
  });
});

describe('buildReport — the text the player is shown', () => {
  it('leads with what the player wrote, then where, record and diagnostics — in that order', () => {
    const r = buildReport({ kind: 'bug', description: 'the fish sank', facts: facts() });
    // Pinned WHOLE, not by substring. Every `toContain` here used to pass just as
    // happily with the sections swapped, or with an extra line spliced into the
    // diagnostics that the player was never shown — which is the one thing this
    // feature promises cannot happen. An exact match is the only assertion that
    // actually says "this, and nothing else, is what gets sent".
    expect(r.body).toBe(
      [
        '### What happened',
        '',
        'the fish sank',
        '',
        '### Where',
        '',
        'Room 34 — KORALY (Corals)',
        '',
        '### Move record',
        '',
        '3 moves:',
        '',
        '    IKJL',
        '',
        '### Diagnostics',
        '',
        'Fish Fillets 4ever 1.0.18 (868c920, built 2026-08-07)',
        'graphics: ai · renderer: webgl · WebGL2: yes',
        'subtitles: cz',
        'window 1512×850 · screen 1512×982',
        'Mozilla/5.0 (Macintosh) TestBrowser/1.0',
        '',
      ].join('\n'),
    );
  });

  it('says nothing at all about a fact it does not have', () => {
    const blind = facts({
      win: { innerWidth: 0, innerHeight: 0, screen: null, navigator: null },
      game: { ...env().game, screen: 'map', roomNum: null, record: '', moves: 0, subtitles: '' },
    });
    const r = buildReport({ kind: 'bug', description: 'hm', facts: blind });
    expect(r.body).not.toMatch(/null|undefined|NaN/);
    expect(r.body).not.toContain('### Move record');
    expect(r.body).not.toContain('window ');
    expect(r.body).not.toContain('subtitles:');
    // What it DOES still know is kept.
    expect(r.body).toContain('The world map');
    expect(r.body).toContain('Fish Fillets 4ever 1.0.18');
  });

  it('marks an empty description rather than filing a blank report', () => {
    expect(buildReport({ kind: 'bug', description: '   ', facts: facts() }).body).toContain(
      '_(nothing written)_',
    );
  });

  it('titles a bug by its room and an idea by its first line', () => {
    expect(buildReport({ kind: 'bug', description: 'x', facts: facts() }).title).toBe(
      '[bug] KORALY (room 34)',
    );
    const onMap = facts({ game: { ...env().game, screen: 'map', roomNum: null } });
    expect(buildReport({ kind: 'bug', description: 'x', facts: onMap }).title).toBe(
      '[bug] the world map',
    );
    const idea = collectFacts(env(), 'idea');
    expect(buildReport({ kind: 'idea', description: 'a hint button\nplease', facts: idea }).title).toBe(
      '[idea] a hint button',
    );
    expect(buildReport({ kind: 'idea', description: '', facts: idea }).title).toBe('[idea]');
  });

  it('keeps the block and the issue fields telling the same story', () => {
    const r = buildReport({ kind: 'bug', description: 'the fish sank', facts: facts() });
    // Exact values, not first lines. The block is what the player READS and the fields
    // are what GitHub RECEIVES; a first-line check let a whole extra paragraph be
    // appended to a field without any test noticing, which would mean the player was
    // shown one thing and something else was filed.
    expect(r.fields[BUG_FIELDS.what]).toBe('the fish sank');
    expect(r.fields[BUG_FIELDS.where]).toBe('Room 34 — KORALY (Corals)');
    expect(r.fields[BUG_FIELDS.record]).toBe('3 moves:\n\n    IKJL');
    expect(r.fields[BUG_FIELDS.diagnostics]).toBe(
      [
        'Fish Fillets 4ever 1.0.18 (868c920, built 2026-08-07)',
        'graphics: ai · renderer: webgl · WebGL2: yes',
        'subtitles: cz',
        'window 1512×850 · screen 1512×982',
        'Mozilla/5.0 (Macintosh) TestBrowser/1.0',
      ].join('\n'),
    );
    // …and every field is present verbatim in the block, so nothing can be filed that
    // was not on screen.
    for (const value of Object.values(r.fields)) if (value) expect(r.body).toContain(value);
  });

  it('names the screen a player was on when it was not a room', () => {
    const base = facts();
    expect(whereLine({ ...base, roomNum: null, screen: 'map' })).toBe('The world map');
    expect(whereLine({ ...base, roomNum: null, screen: 'intro' })).toBe('The intro movie');
    expect(whereLine({ ...base, roomNum: null, screen: 'legimage' })).toContain('story page');
    expect(whereLine({ ...base, roomNum: null, screen: '' })).toBe('');
  });
});

describe('the three exits', () => {
  const input = { kind: 'bug' as const, description: 'the fish sank', facts: facts() };

  it('files against the repo’s own issue form, not a blank issue', () => {
    const { url } = buildIssueUrl(input);
    expect(url.startsWith(`https://github.com/${FEEDBACK_REPO}/issues/new?`)).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('template')).toBe(BUG_TEMPLATE);
    // The link carries EXACTLY the report the player was shown — every field, whole,
    // and no extra parameter beyond the template and the title. A substring check here
    // let an unshown line be smuggled into a field and still pass.
    const r = buildReport(input);
    expect(q.get('title')).toBe(r.title);
    for (const [id, value] of Object.entries(r.fields)) expect(q.get(id)).toBe(value || null);
    expect([...q.keys()].sort()).toEqual(
      ['template', 'title', ...Object.values(BUG_FIELDS).filter((id) => r.fields[id])].sort(),
    );

    const ideaInput = { kind: 'idea' as const, description: 'a hint button', facts: collectFacts(env(), 'idea') };
    const iq = new URL(buildIssueUrl(ideaInput).url).searchParams;
    const ir = buildReport(ideaInput);
    expect(iq.get('template')).toBe(IDEA_TEMPLATE);
    expect(iq.get(IDEA_FIELDS.idea)).toBe('a hint button');
    for (const [id, value] of Object.entries(ir.fields)) expect(iq.get(id)).toBe(value || null);
    expect([...iq.keys()].sort()).toEqual(
      ['template', 'title', ...Object.values(IDEA_FIELDS).filter((id) => ir.fields[id])].sort(),
    );
  });

  it('mails the one dedicated address, with the whole report as the body', () => {
    const { url } = buildMailtoUrl(input);
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?`)).toBe(true);
    const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    const r = buildReport(input);
    // Byte for byte the report on screen — an email that says more than the preview did
    // would break the only promise this feature makes.
    expect(q.get('subject')).toBe(r.title);
    expect(q.get('body')).toBe(r.body);
    expect([...q.keys()].sort()).toEqual(['body', 'subject']);
  });

  it('escapes a description that would otherwise break the query string', () => {
    const nasty = { ...input, description: 'a&b=c #hash %25 "quote" <tag>' };
    const { url } = buildIssueUrl(nasty);
    expect(new URL(url).searchParams.get(BUG_FIELDS.what)).toBe(nasty.description);
    const mail = buildMailtoUrl(nasty).url;
    expect(new URLSearchParams(mail.slice(mail.indexOf('?') + 1)).get('body')).toContain(
      nasty.description,
    );
  });
});

describe('links that would not fit', () => {
  /** A record long enough to blow both budgets: one character per move. */
  const flailing = (n: number): FeedbackFacts => ({
    ...facts(),
    record: 'IKJL'.repeat(n / 4),
    moves: n,
  });

  it('gives the record up only when that hands the player back their own words', () => {
    // The record is huge, so it has to go — and once it does there is room for the
    // description that was being squeezed out by it.
    const input = { kind: 'bug' as const, description: 'z'.repeat(1200), facts: flailing(20000) };
    const kept = buildMailtoUrl({ ...input, description: 'z'.repeat(1200) });
    expect(kept.recordOmitted).toBe(true);
    expect(kept.url.length).toBeLessThanOrEqual(MAX_MAILTO_URL);
    const body = new URLSearchParams(kept.url.slice(kept.url.indexOf('?') + 1)).get('body')!;
    expect(body.length).toBeGreaterThan(700); // the description survived, mostly
  });

  it('shortens the player’s text before it sacrifices the record', () => {
    // The ordinary case for a careful reporter: a thorough description and a perfectly
    // normal record. Dropping the record here would save ~60 characters and cost the
    // one thing that makes the report reproducible.
    const input = { kind: 'bug' as const, description: 'x'.repeat(1400), facts: flailing(200) };
    const mail = buildMailtoUrl(input);
    expect(mail.url.length).toBeLessThanOrEqual(MAX_MAILTO_URL);
    expect(mail.recordOmitted).toBe(false);
    expect(mail.clamped).toBe(true);
    expect(mail.oversize).toBe(false);
    const body = new URLSearchParams(mail.url.slice(mail.url.indexOf('?') + 1)).get('body')!;
    expect(body).toContain('IKJLIKJL');
    expect(body).toContain('cut short');
  });

  it('never trades a short record for nothing — the apology is longer than the record', () => {
    const input = { kind: 'bug' as const, description: 'y'.repeat(8000), facts: facts() };
    for (const link of [buildIssueUrl(input), buildMailtoUrl(input)]) {
      expect(link.recordOmitted).toBe(false);
      expect(link.clamped).toBe(true);
      // The falsehood this guards against: "4 moves … too long for this link".
      expect(decodeURIComponent(link.url)).not.toContain('too long for this link');
    }
  });

  it('drops an over-long record WHOLE rather than shipping half of one', () => {
    const input = { kind: 'bug' as const, description: 'stuck', facts: flailing(20000) };
    const issue = buildIssueUrl(input);
    expect(issue.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL);
    expect(issue.recordOmitted).toBe(true);
    // A partial record is not a shorter record: replaying it lands somewhere that is
    // not the reported position. So none of it goes, and the report says so.
    expect(new URL(issue.url).searchParams.get(BUG_FIELDS.record)).not.toContain('IKJLIKJL');
    expect(new URL(issue.url).searchParams.get(BUG_FIELDS.record)).toContain('20000 moves');
    expect(new URL(issue.url).searchParams.get(BUG_FIELDS.record)).toContain('Copy report');
  });

  it('keeps a realistic record — the common case must not be degraded', () => {
    const input = { kind: 'bug' as const, description: 'stuck', facts: flailing(400) };
    const issue = buildIssueUrl(input);
    expect(issue.recordOmitted).toBe(false);
    expect(new URL(issue.url).searchParams.get(BUG_FIELDS.record)).toContain('IKJLIKJL');
  });

  it('keeps mailto under the OS command-line ceiling', () => {
    const link = buildMailtoUrl({ kind: 'bug', description: 'stuck', facts: flailing(20000) });
    expect(link.url.length).toBeLessThanOrEqual(MAX_MAILTO_URL);
    expect(link.recordOmitted).toBe(true);
  });

  it('clamps the player’s own text only as a last resort, and marks it', () => {
    const link = buildIssueUrl({
      kind: 'bug',
      description: 'x'.repeat(50000),
      facts: facts(),
    });
    expect(link.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL);
    expect(link.clamped).toBe(true);
    expect(link.oversize).toBe(false);
    expect(new URL(link.url).searchParams.get(BUG_FIELDS.what)).toContain('cut short');
  });

  it('survives a cut that lands inside an emoji', () => {
    // `slice` cuts on UTF-16 units, so a cut through a surrogate pair leaves a lone
    // half — and `encodeURIComponent` throws `URIError` on one. That threw inside the
    // form's render, which froze the preview and left the button dead for the session.
    for (const at of [0, 300, 799, 800, 801, 1141, 1142, 2000]) {
      const description = `${'a'.repeat(at)}🐟${'b'.repeat(3000)}`;
      expect(() => buildFeedback({ kind: 'bug', description, facts: facts() })).not.toThrow();
    }
    // A whole report of nothing but emoji, clamped down to nothing, still builds.
    expect(() =>
      buildFeedback({ kind: 'bug', description: '🐟'.repeat(4000), facts: facts() }),
    ).not.toThrow();
  });

  it('reports a link it could not shrink instead of quietly handing over a 414', () => {
    // Nothing is left to shed: no description, no record, and diagnostics alone over
    // the budget. The flag is what lets the form say "use Copy report" rather than
    // offering a link the server will refuse or the mail client will truncate.
    const huge: FeedbackFacts = { ...facts(), record: null, moves: null, userAgent: 'ř'.repeat(3000) };
    const link = buildMailtoUrl({ kind: 'bug', description: '', facts: huge });
    expect(link.url.length).toBeGreaterThan(MAX_MAILTO_URL);
    expect(link.oversize).toBe(true);
  });

  it('always hands the clipboard the complete report, whatever the links dropped', () => {
    const f = flailing(20000);
    const fb = buildFeedback({ kind: 'bug', description: 'stuck', facts: f });
    expect(fb.issue.recordOmitted).toBe(true);
    expect(fb.email.recordOmitted).toBe(true);
    // The WHOLE record, asserted whole. Checking a 40-character prefix passed happily
    // with the clipboard copy truncated — which would silently defeat the one exit that
    // is supposed to carry everything.
    expect(fb.report.body).toContain(`${f.moves} moves:\n\n    ${f.record}`);
    expect(fb.report.body).toBe(buildReport({ kind: 'bug', description: 'stuck', facts: f }).body);
    expect(fb.report.body).not.toContain('too long for this link');
  });

  it('keeps the record for a long CZECH report — the audience this game actually has', () => {
    // The cut is applied in raw characters while the budget is spent in percent-encoded
    // ones, so a naive "shave off the overflow" over-cuts by the encoding factor: `č`
    // costs six URL characters, not one. That drove the surviving description under the
    // KEEP_DESCRIPTION floor and made fitUrl throw the move record away — on ~10% of
    // long Czech reports — while telling the player it was "too long to fit in a link".
    const czech = 'Rybka se zasekla ve zdi, když jsem posunul bednu doleva — pokaždé jinak. ';
    let description = '';
    while (description.length < 1551) description += czech;
    description = description.slice(0, 1551);
    const link = buildIssueUrl({ kind: 'bug', description, facts: flailing(1904) });
    expect(link.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL);
    expect(link.recordOmitted).toBe(false);
    expect(link.oversize).toBe(false);
    expect(new URL(link.url).searchParams.get(BUG_FIELDS.record)).toContain('IKJLIKJL');
  });

  it('keeps as much of the text as the budget truly allows, at any encoding density', () => {
    // The bisection's contract, stated as the thing that actually matters: when the
    // text has to be cut, the finished link sits within ONE character's encoded width
    // of the budget — nothing usable is left on the table. A character costs 1 URL
    // character as ASCII, 6 as a Czech diacritic, 9 as CJK and 12 as an astral emoji,
    // which is precisely the spread the old subtract-the-overflow loop got wrong: it
    // cut in raw characters against an overflow counted in encoded ones, and threw away
    // several times more of the player's words than it needed to.
    for (const [filler, encodedWidth] of [
      ['x', 1],
      ['č', 6],
      ['愛', 9],
      ['🐟', 12],
    ] as const) {
      const link = buildMailtoUrl({ kind: 'bug', description: filler.repeat(4000), facts: facts() });
      expect(link.clamped, filler).toBe(true);
      expect(link.oversize, filler).toBe(false);
      expect(link.recordOmitted, `${filler}: a 4-move record never needs sacrificing`).toBe(false);
      expect(link.url.length, filler).toBeLessThanOrEqual(MAX_MAILTO_URL);
      expect(
        MAX_MAILTO_URL - link.url.length,
        `${filler}: within one character of the budget, i.e. nothing wasted`,
      ).toBeLessThan(encodedWidth);
    }
  });

  it('holds up under 500 random reports', () => {
    // The shedding logic is a loop over a length that depends on percent-encoding, and
    // the inputs it will really see are Czech, emoji and pasted punctuation — exactly
    // the characters whose encoded length is not their character length. A case-by-case
    // suite kept missing those; this sweeps them. `Math.random` is seeded per test
    // (test/rng.ts), so a failure is reproducible, and `npm run test:seeds` walks the
    // whole space.
    const alphabet = [...'abcdefg ,.\něščřžýáíé🐟👍<>&%="?#+'];
    for (let i = 0; i < 500; i++) {
      let description = '';
      const len = Math.floor(Math.random() * 2600);
      for (let j = 0; j < len; j++) {
        description += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      const moves = Math.floor(Math.random() * 3000);
      const kind = Math.random() < 0.25 ? ('idea' as const) : ('bug' as const);
      const f =
        kind === 'idea'
          ? collectFacts(env(), 'idea')
          : { ...facts(), record: 'IKJLWSAD'.repeat(Math.ceil(moves / 8)).slice(0, moves), moves };
      const where = `#${i} kind=${kind} desc=${len} moves=${moves}`;
      const fb = buildFeedback({ kind, description, facts: f });
      expect(fb.issue.oversize || fb.issue.url.length <= MAX_ISSUE_URL, where).toBe(true);
      expect(fb.email.oversize || fb.email.url.length <= MAX_MAILTO_URL, where).toBe(true);
      // A lone surrogate would have thrown in the builder; a mangled one would survive
      // to here and break whoever decodes the link.
      expect(() => decodeURIComponent(fb.issue.url), where).not.toThrow();
      expect(() => decodeURIComponent(fb.email.url), where).not.toThrow();
    }
  });
});

describe('the issue forms on disk', () => {
  const read = (f: string): string =>
    readFileSync(new URL(`../.github/ISSUE_TEMPLATE/${f}`, import.meta.url), 'utf8');
  const idsIn = (yaml: string): string[] =>
    [...yaml.matchAll(/^\s+id:\s*(\S+)\s*$/gm)].map((m) => m[1]!);

  it('still has every field the game prefills', () => {
    // GitHub discards a prefill value whose field id does not exist, silently. This is
    // the only thing that would catch a rename before reports started arriving empty.
    expect(idsIn(read(BUG_TEMPLATE))).toEqual(expect.arrayContaining(Object.values(BUG_FIELDS)));
    expect(idsIn(read(IDEA_TEMPLATE))).toEqual(expect.arrayContaining(Object.values(IDEA_FIELDS)));
  });

  it('points at the same address the game does', () => {
    expect(read('config.yml')).toContain(FEEDBACK_EMAIL);
    expect(read(BUG_TEMPLATE)).toContain(FEEDBACK_EMAIL);
  });
});
