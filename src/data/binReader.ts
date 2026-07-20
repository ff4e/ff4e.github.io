/**
 * Sequential little-endian byte reader, modelling Turbo/Borland Pascal's
 * `blockread(f, buf, n)` semantics used throughout the original engine
 * (URoom.pas TRoom.Init). Every read advances a cursor; overruns throw.
 *
 * The Delphi loader reads into a 1 KB `buf` union and reinterprets it as
 * bytes / words (u16 LE) / longints (i32 LE) / a Pascal shortstring. This
 * reader exposes the same primitives so the FFR parser can mirror the
 * `blockread` sequence one-to-one.
 */
export class ByteReader {
  private readonly view: DataView;
  private off = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get offset(): number {
    return this.off;
  }

  get length(): number {
    return this.buf.length;
  }

  get atEnd(): boolean {
    return this.off === this.buf.length;
  }

  get remaining(): number {
    return this.buf.length - this.off;
  }

  private require(n: number): void {
    if (this.off + n > this.buf.length) {
      throw new RangeError(
        `read past end: need ${n} byte(s) at offset ${this.off}, only ${this.remaining} remaining`,
      );
    }
  }

  /** Unsigned 8-bit. */
  u8(): number {
    this.require(1);
    return this.buf[this.off++]!;
  }

  /** Unsigned 16-bit, little-endian (Pascal `word`). */
  u16(): number {
    this.require(2);
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }

  /** Signed 32-bit, little-endian (Pascal `integer`/`longint`). */
  i32(): number {
    this.require(4);
    const v = this.view.getInt32(this.off, true);
    this.off += 4;
    return v;
  }

  /** Copy of the next `n` raw bytes; advances the cursor. */
  bytes(n: number): Uint8Array {
    this.require(n);
    const out = this.buf.subarray(this.off, this.off + n);
    this.off += n;
    return out;
  }

  /** Skip `n` bytes. */
  skip(n: number): void {
    this.require(n);
    this.off += n;
  }
}
