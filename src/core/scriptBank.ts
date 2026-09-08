/** A captured integer bank: absent slots mean zero. Live Script banks stay dense. */
export type ScriptBank = Readonly<Record<number, number>>;

/** Also accepts the dense arrays stored by older builds. */
export function captureBank(bank: ScriptBank): ScriptBank {
  const out: Record<number, number> = {};
  // Live banks are dense arrays: avoid allocating and parsing 1124 keys per move.
  if (Array.isArray(bank)) {
    for (let i = 0; i < bank.length; i++) {
      const value = bank[i]!;
      if (value !== 0 && Object.prototype.hasOwnProperty.call(bank, i)) out[i] = value;
    }
    return out;
  }
  for (const key of Object.keys(bank)) {
    const i = Number(key);
    const value = bank[i]!;
    if (value !== 0) out[i] = value;
  }
  return out;
}

export function sameBank(a: ScriptBank, b: ScriptBank): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[Number(key)] === b[Number(key)]);
}

/** Flat index/value pairs let the undo pool reuse its array interning and patches. */
export function bankEntries(bank: ScriptBank): number[] {
  const out: number[] = [];
  for (const key of Object.keys(bank)) {
    const i = Number(key);
    if (bank[i] !== 0) out.push(i, bank[i]!);
  }
  return out;
}

/** Reject malformed pairs rather than restoring a different script state. */
export function bankFromEntries(entries: readonly number[]): ScriptBank | null {
  if (entries.length % 2 !== 0) return null;
  const out: Record<number, number> = {};
  let previous = -1;
  for (let k = 0; k < entries.length; k += 2) {
    const i = entries[k]!;
    const value = entries[k + 1]!;
    if (!Number.isInteger(i) || i <= previous || i >= 1024 || !Number.isFinite(value)) return null;
    if (value !== 0) out[i] = value;
    previous = i;
  }
  return out;
}
