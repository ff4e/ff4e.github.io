/** Source-span extraction for `native-restated.test.ts`; see there. */
import { createHash } from 'node:crypto';

/**
 * The source span an anchor starts: up to the `;` that ends its statement, or the `}` that
 * closes its block, at bracket depth 0. Strings, template literals and comments are skipped
 * (comments are also dropped from the result). Regex literals are not recognised; none of
 * the restated spans contains one with a bracket or quote in it.
 */
export function extractSpan(src: string, anchor: string): string {
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`anchor not found: ${anchor}`);
  if (src.indexOf(anchor, start + 1) >= 0) throw new Error(`anchor is not unique: ${anchor}`);
  let out = '';
  let depth = 0;
  const tpl: number[] = []; // depth at which each open template literal's `${` began
  let i = start;
  const quoted = (q: string): void => {
    let j = i + 1;
    while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
    out += src.slice(i, j + 1);
    i = j + 1;
  };
  const template = (): void => {
    // from just after a ` (or a closing } of ${…}) to the next ` or ${
    let j = i;
    while (j < src.length && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
    if (src[j] === '`') {
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += src.slice(i, j + 2);
      i = j + 2;
      tpl.push(depth);
      depth++;
    }
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      quoted(c);
      continue;
    }
    if (c === '`') {
      out += c;
      i++;
      template();
      continue;
    }
    if (c === '}' && tpl.length && tpl[tpl.length - 1] === depth - 1) {
      tpl.pop();
      depth--;
      out += c;
      i++;
      template();
      continue;
    }
    out += c;
    i++;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0 && c === '}') break;
    } else if (c === ';' && depth === 0) break;
  }
  return out.replace(/\s+/g, ' ').trim();
}

export const spanHash = (span: string): string => createHash('sha256').update(span).digest('hex').slice(0, 12);
