/**
 * Everything the game persists in localStorage: which rooms are solved or cheated,
 * best move counts, best-solution records, and per-room play time.
 *
 * A closed store rather than a module of exported globals. That is deliberate:
 * ── Ordering. main.ts refuses to run on a phone before ANY other side effect, and an
 *    imported module is evaluated before a single statement of its importer. Loading
 *    (and migrating) save data at module scope would have jumped ahead of that
 *    refusal and stamped ff.schema into a phone visitor's storage. openSaveStore() is
 *    called from main.ts at exactly the point this code used to run instead.
 * ── The migration invariant. migrateSaves() must run "before any ff.* key is read".
 *    Module-scope consts would have read first and migrated second — harmless at
 *    schema v1, which only stamps, and a silent data bug at the first real migration.
 *
 * main.ts destructures the returned object, so every call site there is unchanged.
 */
export function openSaveStore() {
  /** Current localStorage save-data layout version (ff.schema). Bump when the shape
   *  of any persisted `ff.*` key changes, and add a migration step in migrateSaves().
   *  Declared before migrateSaves() runs: the call below reads SAVE_SCHEMA, so the
   *  const must be initialized first (a later declaration would be in its temporal
   *  dead zone → a swallowed ReferenceError that silently skips the migration). */
  const SAVE_SCHEMA = 1;

  migrateSaves();
  const solved = loadSet('ff.solved'); // set of solved (1-based) room numbers, persisted
  const cheated = loadSet('ff.cheated'); // rooms completed via the cheat (shown as kCheat)

  /**
   * Version + migrate the persisted save data so a future layout change never strands
   * an existing player's progress. Runs once at boot, before any `ff.*` key is read.
   * Pre-versioning saves (no `ff.schema`) are already in the v1 shape, so they are
   * simply stamped; later bumps add `if (from < N)` steps that transform keys in place.
   */
  function migrateSaves(): void {
    try {
      const raw = localStorage.getItem('ff.schema');
      const from = raw !== null ? Number(raw) : 0;
      if (from >= SAVE_SCHEMA) return;
      // from 0 (unversioned) -> 1: no key changes needed (ff.solved/cheated/scores/
      // best/graphics/renderer/... already match v1); future migrations go here.
      localStorage.setItem('ff.schema', String(SAVE_SCHEMA));
    } catch {
      /* storage unavailable */
    }
  }

  /** Load a persisted set of room numbers from localStorage. */
  function loadSet(key: string): Set<number> {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return new Set<number>(JSON.parse(raw) as number[]);
    } catch {
      /* storage unavailable */
    }
    return new Set<number>();
  }

  /** Persist a set of room numbers. */
  function saveSet(key: string, s: Set<number>): void {
    try {
      localStorage.setItem(key, JSON.stringify([...s]));
    } catch {
      /* storage unavailable */
    }
  }

  const saveSolved = (): void => saveSet('ff.solved', solved);
  const saveCheated = (): void => saveSet('ff.cheated', cheated);

  const scores = loadScores(); // room number -> best (lowest) move count on a genuine solve

  /**
   * cascisty (USoutez.pas:697): milliseconds spent INSIDE each room, accumulated
   * across every visit and every session. The original keeps this per room in its
   * competition records and adds the visit's elapsed time when the room closes
   * (zaznamenej_zmeny, UMain.pas:283), then persists the records; ZAVER's finale
   * narrates the total as an hour count. Map/menu/intro time never counts, and a
   * restart does not split a visit (TRoom.Restart leaves casstartu alone).
   */
  const playTime = loadPlayTime();
  /** Date.now() when the current room visit began, or 0 when not in a room. */
  let roomEnterAt = 0;
  /** The room that visit belongs to. */
  let roomClockNum = 0;

  /** Load the persisted per-room play time (ms). */
  function loadPlayTime(): Map<number, number> {
    try {
      const raw = localStorage.getItem('ff.playtime');
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, number>;
        return new Map(
          Object.entries(obj)
            .map(([k, v]) => [Number(k), Number(v)] as [number, number])
            .filter(([k, v]) => Number.isFinite(k) && Number.isFinite(v) && v >= 0),
        );
      }
    } catch {
      /* storage unavailable */
    }
    return new Map<number, number>();
  }

  /** Start timing a visit to room `num` (TRoom.Start: casstartu := Date+Time). Armed
   *  by the player entering a room, not by loadRoom — the boot room is pre-loaded
   *  behind the world map and must not accrue play time. The room number is captured
   *  here rather than read from `curNum` at the end, because `curNum` only updates
   *  once the (async) room load succeeds: leaving during the load would otherwise
   *  bank the time against the room the player just came from. */
  function startRoomClock(num: number): void {
    roomEnterAt = Date.now();
    roomClockNum = num;
  }

  /**
   * Close a room visit and bank its elapsed time (zaznamenej_zmeny, UMain.pas:283 ->
   * USoutez.pas:695). Called whenever the room is left, for any reason; time in a
   * visit that is never closed is lost, exactly as it is in the original.
   */
  function stopRoomClock(): void {
    if (!roomEnterAt) return;
    const elapsed = Date.now() - roomEnterAt;
    roomEnterAt = 0;
    const n = roomClockNum;
    roomClockNum = 0;
    if (!n || elapsed <= 0) return;
    playTime.set(n, (playTime.get(n) ?? 0) + elapsed);
    try {
      localStorage.setItem('ff.playtime', JSON.stringify(Object.fromEntries(playTime)));
    } catch {
      /* storage unavailable */
    }
  }

  /**
   * cas_hry (USoutez.pas:263): the whole game's play time, in Delphi day units —
   * the sum over all rooms of their banked time. The visit in progress is NOT
   * included, matching the original, whose current room has not been recorded yet
   * when ZAVER reads it.
   */
  function casHry(): number {
    let ms = 0;
    for (const v of playTime.values()) ms += v;
    return ms / 86_400_000;
  }

  /** Load the persisted per-room best move counts (RoomVysl). */
  function loadScores(): Map<number, number> {
    try {
      const raw = localStorage.getItem('ff.scores');
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, number>;
        return new Map(Object.entries(obj).map(([k, v]) => [Number(k), Number(v)]));
      }
    } catch {
      /* storage unavailable */
    }
    return new Map<number, number>();
  }

  /** Persist the per-room best move counts. */
  function saveScores(): void {
    try {
      localStorage.setItem('ff.scores', JSON.stringify(Object.fromEntries(scores)));
    } catch {
      /* storage unavailable */
    }
  }

  /** RoomVysl:=LengthOfRecord (URoom.pas:24342): record a solve's move count, keeping the best. */
  function recordScore(roomNum: number, moves: number): void {
    const prev = scores.get(roomNum);
    if (prev === undefined || moves < prev) {
      scores.set(roomNum, moves);
      saveScores();
    }
  }

  // The best-solution move records (the original's `nej` save slot), keyed by room.
  // Persisted so the map info panel's "Replay" can animate a room's best solution.
  const bestRecords = loadBestRecords();

  /** Load the persisted per-room best-solution move records (ff.best). */
  function loadBestRecords(): Map<number, string> {
    try {
      const raw = localStorage.getItem('ff.best');
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, string>;
        return new Map(Object.entries(obj).map(([k, v]) => [Number(k), String(v)]));
      }
    } catch {
      /* storage unavailable */
    }
    return new Map<number, string>();
  }

  /** Persist the per-room best-solution move records. */
  function saveBestRecords(): void {
    try {
      localStorage.setItem('ff.best', JSON.stringify(Object.fromEntries(bestRecords)));
    } catch {
      /* storage unavailable */
    }
  }

  /** The best-solution record for a room, if one has been stored (enables Replay). */
  function bestRecord(roomNum: number): string | undefined {
    return bestRecords.get(roomNum);
  }

  /**
   * Store a solve's full move record as the room's best when it beats the stored
   * count (mirrors recordScore's keep-minimum guard so record + count stay in sync;
   * the original's `nej` slot). Called on a genuine win with the winning srecord.
   */
  function recordBest(roomNum: number, rec: string, moves: number): void {
    const prev = scores.get(roomNum);
    if (prev === undefined || moves <= prev) {
      bestRecords.set(roomNum, rec);
      saveBestRecords();
    }
  }

  /**
   * Force a room's best record and move count, bypassing the keep-minimum guards
   * that recordBest/recordScore apply. Exists for the `__ff.markBest` test hook,
   * which has to be able to plant an arbitrary record; nothing in the game should
   * use it. Kept here rather than letting callers reach for saveBestRecords() and
   * saveScores() directly, so persistence stays inside the store.
   */
  function forceBest(roomNum: number, rec: string, moves: number): void {
    bestRecords.set(roomNum, rec);
    scores.set(roomNum, moves);
    saveBestRecords();
    saveScores();
  }

  return {
    /** Solved (1-based) room numbers. Mutated in place by the caller (`solved.add(n)`). */
    solved,
    /** Rooms completed via the cheat — shown as kCheat on the map. */
    cheated,
    /** Room number -> best (lowest) move count on a genuine solve. */
    scores,
    /** Room number -> milliseconds spent inside it, across every visit and session. */
    playTime,
    /** Room number -> the full move record of its best solve (enables Replay). */
    bestRecords,
    saveSolved,
    saveCheated,
    recordScore,
    recordBest,
    bestRecord,
    casHry,
    startRoomClock,
    stopRoomClock,
    forceBest,
  };
}
