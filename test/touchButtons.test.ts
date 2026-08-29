/**
 * The touch bar's markup agrees with the region table (src/app/touchButtons.ts).
 *
 * This exists because the bar is driven by `data-region` attributes read straight from
 * `index.html`, so the region numbers live in the markup and nothing in the code path
 * ever compares them against anything. That is fine for a typo like `data-region="1x"`,
 * which produces a button that does nothing — but a transposed digit between two VALID
 * regions produces a button that does something else. Save is 12 and Load is 13; a
 * Save button that quietly loads and throws away the attempt is the failure worth a
 * test, and it is invisible to every other check in the repo.
 *
 * A unit test rather than an assertion in the UI probe: it is a static fact about a
 * file, it costs milliseconds against the probe's ~8 s, and it fails with the exact
 * mismatch rather than with a game that behaved oddly.
 *
 * Undo (24) is the one region here with no `Uovl.pas` counterpart — the 1998 game has no
 * undo — so nothing else in the repo would notice if the markup sent 4 (little fish left)
 * instead. That is the transposition case again, one digit further out.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// From `keyTables.ts`, not `touchButtons.ts`: the latter reaches the DOM through
// `loadingUi.ts`, and this suite runs in node with no document.
import { TOUCH_REGIONS } from '../src/app/keyTables.js';

const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');

/** The `#touchbar` element's markup, so a `data-region` elsewhere cannot satisfy this. */
function touchbarMarkup(): string {
  const start = html.indexOf('<div id="touchbar"');
  expect(start, 'index.html still has a #touchbar element').toBeGreaterThan(-1);
  const end = html.indexOf('</div>', html.indexOf('</button>', start));
  expect(end, 'the #touchbar element is closed').toBeGreaterThan(start);
  return html.slice(start, end);
}

/**
 * Every button in the bar, as `[visible label, region]`, in document order.
 *
 * The VISIBLE label, not `aria-label`: "Load the saved game" contains "save", and
 * matching that against the verbs paired Load with Save's region — this test's own first
 * bug, and a fair warning about matching prose.
 */
function buttons(): Array<[string, number]> {
  const markup = touchbarMarkup();
  const out: Array<[string, number]> = [];
  const re = /<button\b[^>]*\bdata-region="(\d+)"[\s\S]*?<span>([^<]*)<\/span>[\s\S]*?<\/button>/g;
  for (let m = re.exec(markup); m !== null; m = re.exec(markup)) {
    out.push([m[2]!.trim(), Number(m[1])]);
  }
  return out;
}

describe('the touch bar markup', () => {
  it('sends exactly the regions in TOUCH_REGIONS, and no others', () => {
    const inMarkup = buttons()
      .map(([, r]) => r)
      .sort((a, b) => a - b);
    const inTable = Object.values(TOUCH_REGIONS)
      .map(Number)
      .sort((a, b) => a - b);
    expect(inMarkup).toEqual(inTable);
  });

  it('gives every button the region its own label describes', () => {
    // The transposition case: both 12 and 13 are valid, so only the pairing catches it.
    const want: Record<string, number> = {
      Map: TOUCH_REGIONS.map,
      Save: TOUCH_REGIONS.save,
      Load: TOUCH_REGIONS.load,
      Undo: TOUCH_REGIONS.undo,
      Options: TOUCH_REGIONS.options,
      Restart: TOUCH_REGIONS.restart,
    };
    for (const [label, region] of buttons()) {
      expect(want, `"${label}" is one of the known buttons`).toHaveProperty(label);
      expect(region, `"${label}" sends its own region`).toBe(want[label]);
    }
  });

  it('has a button for every verb in the table', () => {
    expect(buttons()).toHaveLength(Object.keys(TOUCH_REGIONS).length);
  });
});
