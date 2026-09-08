import { captureBank, type ScriptBank } from '../core/scriptBank.js';
import { decodeUndoHistory, encodeUndoHistory } from '../core/undoStack.js';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBank(value: unknown, size: number): ScriptBank {
  if (!object(value) && !Array.isArray(value)) throw new Error('Invalid script bank');
  const bank: Record<number, number> = {};
  for (const [key, n] of Object.entries(value)) {
    const i = Number(key);
    if (
      !Number.isInteger(i) || i < 0 || i >= size || String(i) !== key ||
      typeof n !== 'number' || !Number.isFinite(n)
    ) {
      throw new Error('Invalid script bank entry');
    }
    bank[i] = n;
  }
  return captureBank(bank);
}

/** v1 -> v2, one slot at a time. Unknown fields and record-only saves survive. */
function compactSave(raw: string): string {
  if (!raw.trimStart().startsWith('{')) return raw; // legacy plain move record
  const slot: unknown = JSON.parse(raw);
  if (!object(slot) || typeof slot.rec !== 'string') throw new Error('Invalid save slot');
  if (slot.vars != null) {
    if (!object(slot.vars)) throw new Error('Invalid script snapshot');
    slot.vars = {
      ...slot.vars,
      roompole: readBank(slot.vars.roompole, 100),
      globpole: readBank(slot.vars.globpole, 1024),
    };
  }
  if (slot.undo != null) {
    const history = decodeUndoHistory(slot.undo, { strict: true });
    if (history.length === 0) throw new Error('Invalid undo history');
    slot.undo = encodeUndoHistory(history);
  }
  return JSON.stringify(slot);
}

/** Leave a failed slot intact, continue with siblings, and retry at the next boot. */
export function migrateSnapshotSaves(storage: Storage): boolean {
  let complete = true;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !/^ff\.save\.\d+$/.test(key)) continue;
    try {
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const compact = compactSave(raw);
      if (compact !== raw) storage.setItem(key, compact);
    } catch (error) {
      console.warn(`Could not migrate ${key}; keeping the existing save`, error);
      complete = false;
    }
  }
  return complete;
}
