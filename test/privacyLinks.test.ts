/**
 * The game links its privacy policy from three places a player can actually reach.
 *
 * These links shipped in every TestFlight build from 1.0 (2) through 1.0.2 (12), but only as
 * an uncommitted per-release patch: they were never on `main`. When the release worktrees
 * were cleaned up, the patch went with them. A test that reads the markup is what keeps
 * them in the source rather than in somebody's working tree.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
const POLICY = 'https://ff4e.github.io/privacy.html';

describe('in-app privacy policy links', () => {
  for (const id of ['feedbar-privacy', 'topt-privacy', 'feedback-privacy']) {
    it(`#${id} links to the published policy, in a new tab`, () => {
      const m = html.match(new RegExp(`<a\\b[^>]*\\bid="${id}"[^>]*>`));
      expect(m, `index.html has #${id}`).not.toBeNull();
      const tag = m![0];
      expect(tag).toContain(`href="${POLICY}"`);
      expect(tag).toContain('target="_blank"');
      expect(tag).toContain('rel="noopener noreferrer"');
    });
  }
});
