/**
 * jmeno (the port's 8-char room name) -> FFNG codename (its `script/<cn>/` and
 * `images/<cn>/` directory), the ONE definition for every staging/render tool.
 *
 * It used to be copy-pasted into stage-enhanced.ts, stage-enhanced-objects.ts and
 * render-enhanced.ts, and the three copies had already drifted apart — render-enhanced
 * carried no override table at all. That drift is not cosmetic: a room resolved to the
 * wrong codename stages the wrong art, silently, because FFNG reuses whole rooms between
 * levels (see ZAVER below). One definition, so the tools cannot disagree.
 *
 * The base mapping is `test/fixtures/solutions/mapping.tsv`, which exists to replay FFNG
 * solution files and therefore records what a *solution* belongs to, not what a room's
 * ART belongs to. Two corrections sit on top of it:
 *
 *  - CODENAME_MISSING — rooms mapping.tsv simply does not cover. Applied only when the
 *    room is absent, so mapping.tsv stays authoritative wherever it speaks.
 *  - CODENAME_WRONG — rooms mapping.tsv covers INCORRECTLY. Always wins.
 */
import { readFileSync } from 'node:fs';

/** Rooms mapping.tsv omits (each verified against its script/<cn>/models.lua). */
const CODENAME_MISSING: Record<string, string> = {
  ZELVA: 'turtle',
  BARELY: 'barrel',
  GRAL: 'grail',
  PARTY2: 'party2',
  POHON: 'propulsion',
  SPUNT: 'atlantis',
  LODE: 'gods',
  DISKETA: 'floppy',
  MAPA: 'map',
  CHODBA: 'corridor',
};

/**
 * Rooms mapping.tsv gets WRONG. These override it unconditionally.
 *
 * ZAVER: mapping.tsv has one ambiguous row, `start -> 1|71 -> PRVNI|ZAVER`, which maps
 * BOTH the first room and the finale to `start`. FFNG's own world map settles it —
 * `branch_addNode("", "start", ...)` is level 1 and `branch_setEnding("ending", ...)` is
 * the finale — and the two levels reuse the same 29x27 fish house, with byte-identical
 * background/chair/table/pillow PNGs. That is exactly why the error survived: everything
 * ZAVER staged from `start` was correct, so nothing looked broken. The one thing only
 * `ending` has is `pldik`, the little creature under the table (FFR item 7), which was
 * therefore never staged and rendered as a classic sprite in the enhanced and ai tiers.
 */
const CODENAME_WRONG: Record<string, string> = {
  ZAVER: 'ending',
};

/** Build the jmeno -> codename map from `mapping.tsv` plus the two correction tables. */
export function jmenoToCodename(mappingTsvPath: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of readFileSync(mappingTsvPath, 'utf8').split('\n').slice(1)) {
    const [slug, , jmenoCol] = line.split('\t');
    if (!slug || !jmenoCol) continue;
    // An ambiguous row lists several jmeno separated by '|'; map each to the slug.
    for (const jm of jmenoCol.split('|')) m.set(jm.trim(), slug.trim());
  }
  for (const [jmeno, cn] of Object.entries(CODENAME_MISSING)) if (!m.has(jmeno)) m.set(jmeno, cn);
  for (const [jmeno, cn] of Object.entries(CODENAME_WRONG)) m.set(jmeno, cn);
  return m;
}
