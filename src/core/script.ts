/**
 * Room-script runtime: the dialog scheduler (addd/addm/addv/dialogy,
 * URoom.pas:684-825) plus the context helpers that the ported per-room
 * `Programky`/`InitProgramky` procedures use (zije, natoceni, dist, look_at,
 * Vars, random, ...).
 *
 * The per-room programs (src/rooms/*) are faithful ports of the generated
 * `TRoom.<ROOM>_Programky` code and drive scripted dialogue, object animations
 * (afaze) and puzzle state. They run once per frame; `dialogy` plays queued
 * speech one line at a time, waiting for each voice to finish.
 */
import type { Item, Room } from './room.js';
import { Dir } from './dir.js';

/** natoceni facing codes (URoom.pas:420-421). */
export const SMER_VLEVO = 1;
export const SMER_VPRAVO = 2;
/** Dialogue speaker priorities (mluvi_*, URoom.pas:435-436). */
export const MLUVI_MALA = 1;
export const MLUVI_VELKA = 2;

interface DialogEntry {
  delay: number;
  zvuk: string;
  prior: number;
  promSet?: (val: number) => void;
}

/** Plays a named voice + subtitle; returns how many frames it lasts. */
export type TalkFn = (name: string, prior: number) => number;

/** Environmental-sound hooks (Snd/SndCyc/KSnd/Music); no-ops in headless tests. */
export interface SoundFns {
  snd?: (name: string, prior: number) => void;
  sndcyc?: (name: string, prior: number) => void;
  sndvol?: (name: string, prior: number, vol: number) => void;
  ksnd?: (prior: number) => void;
  music?: (name: string, prior: number) => void;
  musiccyc?: (name: string, prior: number) => void;
  talkNow?: (name: string, prior: number) => number;
}

/** Persistent script state captured in a save (Vars + roompole/globpole + flags). */
export interface ScriptSnapshot {
  vars: number[][];
  roompole: number[];
  globpole: number[];
  zvykacka: boolean;
  gspec: number;
}

export interface RoomScript {
  readonly name: string;
  init(s: Script): void;
  prog(s: Script): void;
}

export class Script {
  /** Frame counter (Room.count); the host keeps this in sync each frame. */
  count = 0;
  /**
   * gfaze (URoom.pas): the current move-animation frame, 0 on the first tick of a
   * move. The host syncs it each tick before `prog`. Paired with an item's
   * `dir<>dir_no`, `gfaze===0` fires an action exactly once as a push begins.
   */
  gfaze = 0;
  /**
   * atRest (gstav===stav_klid): true when the room is settled (no move/fall/exit
   * animating). The host syncs it each tick before `prog`. Spec9 only acts at rest,
   * matching the original's `if gstav<>stav_klid then exit`.
   */
  atRest = true;
  /** gstav===stav_otocka: true while the active fish is playing its turn animation.
   *  Set by the host each tick (phase==='turn'). Used by KAJUTA2's live parrot. */
  turning = false;
  /** gstav (URoom.pas:397-408): the game motion state as a number — stav_klid=0,
   *  stav_padani=1, stav_vlevo=2, stav_vpravo=3, stav_nahoru=4, stav_dolu=5,
   *  stav_otocka=6, stav_ven=7. Set by the host each tick (CHODBA gates on it). */
  gstav = 0;
  /** Canvas display offset (display px), set by rooms that physically move the view.
   *  MOTOR traces a circle here (the original moves the OS window Left/Top). The host
   *  applies it to the canvas transform each frame; reset per room. */
  screenOffset: { x: number; y: number } = { x: 0, y: 0 };
  /** Attempt number (pokus); increments on restart. */
  pokus = 1;
  /** StdHlaskySmrti (URoom.pas:246): when false, the room suppresses the standard
   *  death-commentary lines (StdSmrt). Reset true per room load; rooms opt out in init. */
  stdHlaskySmrti = true;
  /** MusName (URoom.pas:1212): the room's looping-music track name, set by the host.
   *  Passed to `musiccyc(MusName, -999)` by rooms that re-cue their music (KANKAN). */
  musName = '';
  /** natvrdo (URoom.pas:254): ZELVA's "telepathic devil" possession. While 1, the
   *  host force-swims fish `tvrdaryba` (1 = little, 2 = big) toward (tvrdex, tvrdey),
   *  ignoring player input, and clears it once the fish arrives (najdi_smer = dir_no). */
  natvrdo = 0;
  tvrdaryba = 0;
  tvrdex = 0;
  tvrdey = 0;

  /** roompole[0..99] (URoom.pas:443): per-room integer scratch. Zeroed on room CHANGE
   *  (TRoom.Init) but PRESERVED across a restart (TRoom.Restart) — the host carries it
   *  over so restart-latch dialogue survives the attempt. */
  readonly roompole: number[] = new Array<number>(100).fill(0);
  /**
   * globpole[0..1023] (URoom.pas:442): a global integer array. In the original it
   * persists across rooms and in saves; here it is scoped per room, which is
   * behaviourally identical for rooms (e.g. KNIHOVNA) that initialise every slot
   * they read in their InitProgramky.
   */
  readonly globpole: number[] = new Array<number>(1024).fill(0);

  private queue: DialogEntry[] = [];
  private voiceEndCount = 0;
  private aktdialzvuk = 0;
  private lastprom: ((v: number) => void) | undefined;

  /** showmode: the room is running its scripted demonstration (help.cap autoplay). */
  showmode = false;
  /** Host hook to launch the briefcase cutscene (InitKufrDemo). */
  onKufrDemo: (() => void) | null = null;
  /** Host hook to start the automatic demonstration (KUFRIK help.cap replay). */
  onShowmode: (() => void) | null = null;
  /** Host hook to end the room as a WIN (konec:=1; RoomVysl:=LengthOfRecord).
   *  Used by SCORE, whose win is a puzzle solve rather than a fish exit / push-out. */
  onWin: (() => void) | null = null;

  /** zavermode (URoom.pas:27017): the ending room (ZAVER) blocks all player fish input
   *  except system restart/exit while its finale cutscene plays. Set in ZAVER's init. */
  zavermode = false;

  /** cas_hry (URoom.pas:23472): total play time in days (Delphi Now units). ZAVER's
   *  finale narrates round(cas_hry*24) as a spoken hour count. The host sets it to the
   *  elapsed session time; exact cross-session accumulation is deferred. */
  casHry = 0;

  /** globtit (URoom.pas:164): a text fragment substituted for `@` in the next subtitle. */
  globtit = '';
  /**
   * ShodLod state (URoom.pas:26285): a ship falls from the sky when a battleship is
   * sunk. `padalod` = -1 when idle, else kterou+100 while a ship is falling; lodni*
   * are its position/velocity. The falling-ship RENDER is deferred (cosmetic); the
   * state machine runs so subsequent sinks re-trigger it.
   */
  padalod = -1;
  lodniX = 0;
  lodniY = 0;
  lodniDX = 0;
  lodniDY = 0;

  /** zvykacka: the "chewing gum" easter-egg flag, set by the idle chatter (vyber_hlasku group 5). */
  zvykacka = false;
  /** TrepatRoom: screen-shake flag, toggled by a chatter line (the big fish shouts "halo!"). */
  trepat = 0;

  /** InitKufrDemo (URoom.pas:2860): start the briefcase story cutscene. */
  startKufrDemo(): void {
    this.onKufrDemo?.();
  }

  /** Start the automatic demonstration (KUFRIK showmode, URoom.pas:19932). */
  startShowmode(): void {
    this.onShowmode?.();
  }

  constructor(
    readonly room: Room,
    private readonly talk: TalkFn,
    private readonly isPlaying: (prior: number) => boolean = () => false,
    private readonly sound: SoundFns = {},
    private readonly isTalking: (prior: number) => boolean = () => false,
  ) {}

  /**
   * Snapshot the script's persistent state (the "already said"/progress flags) so
   * a save can restore it — the original re-derives these by re-running Programky
   * during a suppressed load replay; the port restores them directly. Captures
   * every object's Vars plus roompole/globpole and the gum flag.
   */
  snapshot(): ScriptSnapshot {
    return {
      vars: this.room.items.map((it) => [...it.vars]),
      roompole: [...this.roompole],
      globpole: [...this.globpole],
      zvykacka: this.zvykacka,
      gspec: this.room.gspec,
    };
  }

  /** Restore a snapshot onto a freshly-built room (after the move replay). */
  applySnapshot(s: ScriptSnapshot): void {
    for (let i = 0; i < s.vars.length; i++) {
      const it = this.room.items[i];
      if (it && s.vars[i]) it.vars = [...s.vars[i]!];
    }
    for (let i = 0; i < this.roompole.length; i++) this.roompole[i] = s.roompole[i] ?? 0;
    for (let i = 0; i < this.globpole.length; i++) this.globpole[i] = s.globpole[i] ?? 0;
    this.zvykacka = s.zvykacka;
    this.room.gspec = s.gspec ?? this.room.gspec;
  }

  // ----- context helpers used by the ported room programs -----

  /** Pascal random(n): 0..n-1 (random(<=0) = 0). */
  random(n: number): number {
    return n <= 0 ? 0 : Math.floor(Math.random() * n);
  }

  alive(which: 'little' | 'big'): boolean {
    return this.room.alive[which];
  }
  venku(which: 'little' | 'big'): boolean {
    return this.room.venku[which];
  }
  /** natoceni = smer_vpravo? */
  facingRight(which: 'little' | 'big'): boolean {
    return this.room.facingRight[which];
  }

  item(i: number): Item {
    return this.room.items[i]!;
  }

  /** Vars^ of an object, allocating `n` slots on first use (getmem in InitProgramky). */
  vars(i: number, n = 0): number[] {
    const it = this.room.items[i]!;
    if (it.vars.length < n + 1) {
      const grown = new Array<number>(n + 1).fill(0);
      for (let k = 0; k < it.vars.length; k++) grown[k] = it.vars[k]!;
      it.vars = grown;
    }
    return it.vars;
  }

  xdist(a: number, b: number): number {
    return this.room.xdist(a, b);
  }
  ydist(a: number, b: number): number {
    return this.room.ydist(a, b);
  }
  dist(a: number, b: number): number {
    return this.room.dist(a, b);
  }
  lookAt(fish: number, obj: number): boolean {
    return this.room.lookAt(fish, obj);
  }
  /** najdi_smer (URoom.pas:26449): the next BFS step for a fish toward (x,y), or
   *  Dir.no if unreachable. Used by ZELVA to test whether a possession target is
   *  reachable before committing (the host then drives the actual walk). */
  najdiSmer(which: 'little' | 'big', x: number, y: number): number {
    return this.room.findDir(which, x, y);
  }
  /** Room grid dimensions (rwidth/rheight). */
  get rwidth(): number {
    return this.room.width;
  }
  get rheight(): number {
    return this.room.height;
  }
  /** WAmp/WPer (URoom.pas): the water-wobble amplitude/period of the background.
   *  PUZZLE jitters these while the "computer" speaks, then restores them. */
  get wamp(): number {
    return this.room.wamp;
  }
  set wamp(v: number) {
    this.room.wamp = v;
  }
  get wper(): number {
    return this.room.wper;
  }
  set wper(v: number) {
    this.room.wper = v;
  }
  /** tlaceno (URoom.pas): true this step when a fish is actively pushing a foreign
   *  object. ZX gates a couple of "you're pushing steel" comments on it. */
  get tlaceno(): boolean {
    return this.room.tlaceno;
  }
  /** cobj[mala]/cobj[velka]: the little/big fish item indices. */
  get littleIdx(): number {
    return this.room.littleIdx;
  }
  get bigIdx(): number {
    return this.room.bigIdx;
  }

  /**
   * FArray[x,y] (URoom.pas:47): the occupant of a grid cell — an item index, or
   * the sentinels ITEM_WALL (0) / ITEM_WATER (255, empty). Rebuilds the grid so
   * the value is current for this tick (priprav_pole runs before Programky).
   */
  farray(x: number, y: number): number {
    return this.room.cellOccupant(x, y);
  }

  /** delay[mala/velka]: frames since the player last acted (idle timer). */
  delay(which: 'little' | 'big'): number {
    return this.room.idle[which];
  }
  /** busy[mala/velka]: the fish's talking state. */
  busy(which: 'little' | 'big'): number {
    return this.room.busy[which];
  }
  /** Set busy[mala/velka] (e.g. via addset from a dialogue sequence). */
  setBusy(which: 'little' | 'big', v: number): void {
    this.room.busy[which] = v;
  }
  /** playing(prior): is a voice of this priority still sounding? */
  playing(prior: number): boolean {
    return this.isPlaying(prior);
  }
  /** Snd (RSound.pas): play an environmental effect tracked by priority. */
  snd(name: string, prior: number): void {
    this.sound.snd?.(name, prior);
  }
  /** SndCyc: play a looping environmental effect that sounds until killed. */
  sndcyc(name: string, prior: number): void {
    this.sound.sndcyc?.(name, prior);
  }
  /** sndvol (RSound.pas): play an effect at a specific volume (0..max_volume=64). */
  sndvol(name: string, prior: number, vol: number): void {
    this.sound.sndvol?.(name, prior, vol);
  }
  /** KSnd: stop the environmental effect of a given priority. */
  ksnd(prior: number): void {
    this.sound.ksnd?.(prior);
  }
  /** Music (RSound.pas): play a one-shot music-channel track tracked by priority. */
  music(name: string, prior: number): void {
    this.sound.music?.(name, prior);
  }
  /** MusicCyc (RSound.pas): like `music`, but loops the whole sample (cycle=0). */
  musiccyc(name: string, prior: number): void {
    this.sound.musiccyc?.(name, prior);
  }
  /** Talk (RSound.pas): play a voice immediately (with subtitle) — not queued via addd. */
  talkNow(name: string, prior: number): number {
    return this.sound.talkNow?.(name, prior) ?? this.talk(name, prior);
  }
  /** nah(a,b) (URoom.pas:3207): a random integer in the inclusive range [a,b]. */
  nah(a: number, b: number): number {
    return this.random(b - a + 1) + a;
  }
  /**
   * talking(prior) (RSound.pas): is that voice still "talking" — i.e. more than the
   * ~0.4535s lip-sync lead remains? Accepts a fish (`'little'`=1/`'big'`=2) or a raw
   * priority. Distinct from `playing()`, which stays true for the whole sample.
   */
  talking(which: 'little' | 'big' | number): boolean {
    const prior = which === 'little' ? 1 : which === 'big' ? 2 : which;
    return this.isTalking(prior);
  }
  /** xicht[mala/velka]: the fish's current face-frame index (0 = neutral). */
  xicht(which: 'little' | 'big'): number {
    return this.room.xicht[which];
  }
  /** Set xicht[mala/velka]: a face expression (head-frame index) for this fish. */
  setXicht(which: 'little' | 'big', v: number): void {
    this.room.xicht[which] = v;
  }
  /** aktivni: which fish (mala/velka) the player currently controls. */
  aktivni(): 'little' | 'big' {
    return this.room.aktivni;
  }

  /**
   * StdKrajniHlaska (URoom.pas:2984): when a fish first reaches a room border, now and
   * then it comments ("cil-m/v-hlaska0..3"). Returns true when a comment was enqueued
   * (the caller then usually calls stdKonecKrajniHlasky). No-op while a dialog runs.
   */
  stdKrajniHlaska(): boolean {
    const r = this.room;
    if (!r.alive.little || !r.alive.big || this.isDialog()) return false;
    const li = r.items[r.littleIdx]!;
    const bi = r.items[r.bigIdx]!;
    const pomL = li.x === 0 || li.y === 0 || li.x + 3 === r.width || li.y + 1 === r.height;
    const pomB = bi.x === 0 || bi.y === 0 || bi.x + 4 === r.width || bi.y + 2 === r.height;

    let ukraje = 0;
    if (!r.bylaukraje.little && pomL) ukraje = 1;
    else if (!r.bylaukraje.big && pomB) ukraje = 2;
    r.bylaukraje.little = pomL;
    r.bylaukraje.big = pomB;

    if (ukraje > 0) {
      r.hlasitkraj++;
      if (r.hlasitkraj === r.kdyhlasitkraj) {
        r.kdyhlasitkraj++;
        r.hlasitkraj = this.random(r.kdyhlasitkraj);
        let cislo = this.random(3);
        if (cislo === r.poslhlaskakraje) cislo = 3;
        r.poslhlaskakraje = cislo;
        if (ukraje === 1) this.addm(0, 'cil-m-hlaska' + String.fromCharCode(cislo + 48));
        else this.addv(0, 'cil-v-hlaska' + String.fromCharCode(cislo + 48));
        return true;
      }
    }
    return false;
  }
  /** StdKonecKrajniHlasky (URoom.pas:3023): originally addset(vzdy_tit,0) — the port
   * always shows subtitles, so this is a no-op (kept for a faithful call site). */
  stdKonecKrajniHlasky(): void {
    /* vzdy_tit is not needed: the port always renders subtitles. */
  }

  /**
   * Spec9 (URoom.pas:2439): mark item `idx` (an a×b block) as exiting once a fish
   * pushes it to a room edge (spec:=9, dir toward the edge, faziVen slide frames).
   * When the last-needed item reaches the edge (kolikjede === room.vytlacit), both
   * fish acknowledge with a "jo!" cheer (or the chewing-gum gag). SPUNT drives this;
   * the host's gspec=9 handling then slides the item off and wins.
   */
  spec9(idx: number, a: number, b: number): void {
    if (!this.atRest) return; // gstav<>stav_klid then exit (URoom.pas:2441)
    const it = this.room.items[idx]!;
    if (it.spec === 11 || it.spec === 9) return;
    let kolikjede = 0;
    // Four INDEPENDENT edge checks (URoom.pas:2449-2452): at a corner more than one
    // fires and the LAST match wins (overwrites dir/faziVen) — not an else-if chain.
    if (it.x === 0) {
      it.spec = 9;
      it.dir = Dir.left;
      it.faziVen = 3 * a;
    }
    if (it.y === 0) {
      it.spec = 9;
      it.dir = Dir.up;
      it.faziVen = 3 * b;
    }
    if (it.x + a === this.room.width) {
      it.spec = 9;
      it.dir = Dir.right;
      it.faziVen = 3 * a;
    }
    if (it.y + b === this.room.height) {
      it.spec = 9;
      it.dir = Dir.down;
      it.faziVen = 3 * b;
    }
    if (it.spec === 9) kolikjede++;
    if (kolikjede === this.room.vytlacit && kolikjede > 0 && this.alive('little') && this.alive('big')) {
      if (this.zvykacka && !this.talking(MLUVI_MALA)) {
        this.talkNow('ob-m-zvykacka', MLUVI_MALA);
      } else {
        const d = (): string => String.fromCharCode(48 + this.random(5));
        if (!this.talking(MLUVI_MALA)) this.talkNow('jo-m-' + d(), MLUVI_MALA);
        if (!this.talking(MLUVI_VELKA)) this.talkNow('jo-v-' + d(), MLUVI_VELKA);
      }
    }
  }

  /** ShodLod (URoom.pas:26285): start a ship falling from the sky (when one is sunk). */
  shodLod(kterou: number): void {
    if (this.padalod !== -1) return;
    this.padalod = kterou + 100;
    this.lodniX = 150 + this.random(300);
    this.lodniY = -100;
    this.lodniDX = this.random(3) - 1;
    this.lodniDY = 4 + this.random(7);
  }
  /** Advance a falling ship each tick; clears `padalod` once it drops off-screen so
   * the next sink can trigger another (VyresLode's motion, minus the render). */
  tickShodLod(): void {
    if (this.padalod === -1) return;
    this.lodniX += this.lodniDX;
    this.lodniY += this.lodniDY;
    if (this.lodniY > 500) this.padalod = -1;
  }

  // ----- dialog scheduler -----

  /** addd (URoom.pas:684): enqueue a delayed action; `set` writes via `promSet`. */
  addd(delay: number, zvuk: string, prior: number, promSet?: (v: number) => void): void {
    this.queue.push(promSet ? { delay, zvuk, prior, promSet } : { delay, zvuk, prior });
  }
  /** addm: the small fish speaks after `delay` frames. */
  addm(delay: number, name: string): void {
    this.addd(delay, name, MLUVI_MALA);
  }
  /** addv: the big fish speaks. */
  addv(delay: number, name: string): void {
    this.addd(delay, name, MLUVI_VELKA);
  }
  /** addset: set a variable when reached in the queue. */
  addset(set: (v: number) => void, value: number): void {
    this.addd(0, 'set', value, set);
  }
  adddel(doba: number): void {
    this.addd(doba, 'del', 0);
  }

  /** resetanim (URoom.pas:763): rewind an object's animation cursor. */
  resetanim(cobj: number): void {
    const it = this.room.items[cobj]!;
    it.posAnim = 1;
    it.delAnim = 0;
    it.labelAnim = 1;
  }

  /** setanim (URoom.pas:773): load a new Anim string and rewind. */
  setanim(cobj: number, s: string): void {
    this.resetanim(cobj);
    this.room.items[cobj]!.anim = s;
  }

  /** endanim (URoom.pas:757): the object's Anim string has run to the end. */
  endanim(cobj: number): boolean {
    const it = this.room.items[cobj]!;
    return it.posAnim > it.anim.length && it.anim !== '';
  }

  /**
   * cislo (URoom.pas:831): parse a number from an Anim string at the 1-based
   * cursor `cur.i`, advancing it. `?a-b` yields a random a..b (the separator
   * between a and b is skipped); a leading `-` is a sign.
   */
  private cislo(s: string, cur: { i: number }): number {
    const ch = (): string => s.charAt(cur.i - 1); // '' when past the end
    if (ch() === '?') {
      cur.i++;
      const pom1 = this.cislo(s, cur);
      cur.i++; // skip the separator between the two bounds
      const pom2 = this.cislo(s, cur);
      return pom2 >= pom1 ? pom1 + this.random(pom2 - pom1 + 1) : 0;
    }
    let sign = 1;
    if (ch() === '-') {
      sign = -1;
      cur.i++;
    }
    let result = 0;
    while (ch() >= '0' && ch() <= '9') {
      result = result * 10 + (ch().charCodeAt(0) - 48);
      cur.i++;
    }
    return sign * result;
  }

  /**
   * goanim (URoom.pas:829): advance an object's Anim-string animation by one
   * tick. Commands: a<n> set frame (afaze), d<n> delay n ticks, s<slot>,<val>
   * set a Var, l/g label & goto, r restart, `?a-b` random. A LOWERCASE command
   * yields (ends this tick); an UPPERCASE one keeps executing in the same tick.
   */
  goanim(cobj: number): void {
    const it = this.room.items[cobj]!;
    if (it.delAnim > 0) {
      it.delAnim--;
      return;
    }
    if (it.posAnim > it.anim.length) {
      it.anim = '';
      it.posAnim = 1;
      return;
    }
    const cur = { i: it.posAnim };
    let prikaz: string;
    let guard = 0; // defensive: real Anim strings always yield, but a malformed
    const maxSteps = it.anim.length * 4 + 64; // loop (e.g. 'LG') must not hang the tick
    do {
      prikaz = it.anim.charAt(cur.i - 1);
      cur.i++;
      switch (prikaz) {
        case 'd': {
          it.delAnim = this.cislo(it.anim, cur) - 1;
          if (it.delAnim < 0) {
            prikaz = 'D'; // 'd0' → keep going this tick (fall through, no yield)
            it.delAnim = 0;
          }
          break;
        }
        case 'a':
        case 'A':
          it.afaze = this.cislo(it.anim, cur);
          break;
        case 's':
        case 'S': {
          const slot = this.cislo(it.anim, cur);
          cur.i++; // skip the separator before the value
          while (it.vars.length <= slot) it.vars.push(0);
          it.vars[slot] = this.cislo(it.anim, cur);
          break;
        }
        case 'l':
        case 'L':
          it.labelAnim = cur.i;
          break;
        case 'g':
        case 'G':
          cur.i = it.labelAnim;
          break;
        case 'r':
        case 'R':
          cur.i = 1;
          break;
      }
      if (++guard > maxSteps) {
        it.anim = ''; // malformed/looping string: drop it rather than hang
        it.posAnim = 1;
        return;
      }
    } while (!(prikaz >= 'a' && prikaz <= 'z') && cur.i <= it.anim.length);
    it.posAnim = cur.i;
  }

  isDialog(): boolean {
    return this.queue.length > 0 || this.aktdialzvuk !== 0;
  }
  noDialog(): boolean {
    return !this.isDialog();
  }

  clearDialog(): void {
    this.queue.length = 0;
    this.aktdialzvuk = 0;
  }

  /** dialogy (URoom.pas:779): advance the speech queue, one line at a time. */
  dialogy(count: number): void {
    this.count = count;
    if (this.aktdialzvuk !== 0) {
      if (this.aktdialzvuk >= 10000) {
        if (this.room.items[this.aktdialzvuk - 10000]!.anim !== '') return;
        this.aktdialzvuk = 0;
      } else if (count < this.voiceEndCount) {
        return; // still talking
      } else {
        this.aktdialzvuk = 0;
        this.lastprom?.(0);
      }
    }
    const d = this.queue[0];
    if (!d) return;
    if (d.delay > 0) {
      d.delay--;
      return;
    }
    if (d.zvuk === 'set') {
      d.promSet?.(d.prior);
    } else if (d.zvuk === 'del') {
      // pure delay, already consumed
    } else if (d.zvuk.startsWith('ANIMWAIT')) {
      this.setanim(d.prior, d.zvuk.slice(8));
      this.aktdialzvuk = d.prior + 10000;
    } else if (d.zvuk.startsWith('ANIM')) {
      this.setanim(d.prior, d.zvuk.slice(4));
    } else {
      this.aktdialzvuk = d.prior;
      this.voiceEndCount = count + this.talk(d.zvuk, d.prior);
      d.promSet?.(d.prior);
      this.lastprom = d.promSet;
    }
    this.queue.shift();
  }
}

export { Dir };
