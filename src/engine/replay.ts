/*
 * replay.ts - compact input recording and server-side replay.
 * Game Port, GPL-3.0-or-later.
 *
 * Encoding (version 2): per frame the x delta (dx = x - previous x, start
 * x = 320) and the fire flag are coded with an adaptive binary range coder
 * (LZMA style, integer arithmetic only):
 *   - fire: one adaptive bit, context = previous fire;
 *   - dx: zigzag(dx) as a 6-bit tree symbol, context = zigzag(previous dx)
 *     capped at 15; symbol 63 escapes to 11 raw-coded bits.
 * Runs of identical deltas/fire states (idle mouse, smooth motion, held
 * fire) cost a few hundredths of a bit per frame, which is the run-length
 * part. Stream: [version=2][varint frame count][range coder bytes], then
 * base64url without padding.
 */

import { FIELD_W } from "./types.ts";
import type { FrameInput, RunConfig, RunResult } from "./types.ts";
import { Game, quantizeX } from "./game.ts";

const VERSION = 2;
const START_X = FIELD_W >> 1;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const PROB_BITS = 11;
const PROB_INIT = 1 << (PROB_BITS - 1);
const MOVE_BITS = 5;
const TOP = 0x1000000;
const DX_CTX = 16;
const ESCAPE = 63;
const RAW_BITS = 11;

function zig(n: number): number {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}
function unzig(n: number): number {
  return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
}

function pushVarint(out: number[], v: number): void {
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

function toBase64Url(bytes: number[]): string {
  let s = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[n >>> 18] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    s += B64[n >>> 18] + B64[(n >>> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += B64[n >>> 18] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63];
  }
  return s;
}

function fromBase64Url(s: string): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64.indexOf(s[i]);
    if (v < 0) throw new Error("replay: invalid character");
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 0xff);
    }
  }
  return out;
}

/** Adaptive probabilities shared by encoder and decoder. */
class Model {
  readonly fire = new Uint16Array(2).fill(PROB_INIT);
  readonly dx = new Uint16Array(DX_CTX * 64).fill(PROB_INIT);
  readonly raw = new Uint16Array(1 << RAW_BITS).fill(PROB_INIT);
}

class RangeEncoder {
  private low = 0; // < 2^40, kept in a double
  private range = 0xffffffff;
  private cache = 0;
  private cacheSize = 1;
  readonly out: number[];

  constructor(out: number[]) {
    this.out = out;
  }

  private shiftLow(): void {
    if (this.low < 0xff000000 || this.low >= 0x100000000) {
      const carry = this.low >= 0x100000000 ? 1 : 0;
      let temp = this.cache;
      do {
        this.out.push((temp + carry) & 0xff);
        temp = 0xff;
      } while (--this.cacheSize !== 0);
      this.cache = Math.floor(this.low / TOP) & 0xff;
    }
    this.cacheSize++;
    this.low = (this.low % TOP) * 256;
  }

  bit(probs: Uint16Array, i: number, bit: number): void {
    const p = probs[i];
    const bound = (this.range >>> PROB_BITS) * p;
    if (bit === 0) {
      this.range = bound;
      probs[i] = p + (((1 << PROB_BITS) - p) >> MOVE_BITS);
    } else {
      this.low += bound;
      this.range -= bound;
      probs[i] = p - (p >> MOVE_BITS);
    }
    while (this.range < TOP) {
      this.range *= 256;
      this.shiftLow();
    }
  }

  tree(probs: Uint16Array, base: number, bits: number, value: number): void {
    let m = 1;
    for (let k = bits - 1; k >= 0; k--) {
      const b = (value >>> k) & 1;
      this.bit(probs, base + m, b);
      m = (m << 1) | b;
    }
  }

  finish(): void {
    for (let i = 0; i < 5; i++) this.shiftLow();
  }
}

class RangeDecoder {
  private range = 0xffffffff;
  private code = 0;
  private pos: number;
  private readonly data: number[];

  constructor(data: number[], pos: number) {
    this.data = data;
    this.pos = pos;
    for (let i = 0; i < 5; i++) this.code = ((this.code * 256) + this.next()) >>> 0;
  }

  private next(): number {
    return this.pos < this.data.length ? this.data[this.pos++] : 0;
  }

  bit(probs: Uint16Array, i: number): number {
    const p = probs[i];
    const bound = (this.range >>> PROB_BITS) * p;
    let b: number;
    if (this.code < bound) {
      this.range = bound;
      probs[i] = p + (((1 << PROB_BITS) - p) >> MOVE_BITS);
      b = 0;
    } else {
      this.code -= bound;
      this.range -= bound;
      probs[i] = p - (p >> MOVE_BITS);
      b = 1;
    }
    while (this.range < TOP) {
      this.range *= 256;
      this.code = ((this.code * 256) + this.next()) >>> 0;
    }
    return b;
  }

  tree(probs: Uint16Array, base: number, bits: number): number {
    let m = 1;
    for (let k = 0; k < bits; k++) m = (m << 1) | this.bit(probs, base + m);
    return m - (1 << bits);
  }
}

/** Encode per-step inputs (x is quantised like the engine does). */
export function encodeInputs(inputs: readonly FrameInput[]): string {
  const bytes: number[] = [VERSION];
  pushVarint(bytes, inputs.length);
  const enc = new RangeEncoder(bytes);
  const model = new Model();
  let prevX = START_X;
  let prevZ = 0;
  let prevFire = 0;
  for (const inp of inputs) {
    const x = quantizeX(inp.x);
    const fire = inp.fire ? 1 : 0;
    enc.bit(model.fire, prevFire, fire);
    const z = zig(x - prevX);
    const ctx = (prevZ < DX_CTX ? prevZ : DX_CTX - 1) * 64;
    if (z < ESCAPE) enc.tree(model.dx, ctx, 6, z);
    else {
      enc.tree(model.dx, ctx, 6, ESCAPE);
      enc.tree(model.raw, 0, RAW_BITS, z);
    }
    prevX = x;
    prevZ = z;
    prevFire = fire;
  }
  enc.finish();
  return toBase64Url(bytes);
}

/** Decode inputs produced by encodeInputs. Throws on malformed data. */
export function decodeInputs(s: string): FrameInput[] {
  const bytes = fromBase64Url(s);
  if (bytes.length === 0 || bytes[0] !== VERSION) throw new Error("replay: bad version");
  let pos = 1;
  let count = 0;
  let mul = 1;
  for (let k = 0; ; k++) {
    if (k >= 5 || pos >= bytes.length) throw new Error("replay: bad header");
    const b = bytes[pos++];
    count += (b & 0x7f) * mul;
    if (b < 0x80) break;
    mul *= 0x80;
  }
  if (count > 10000000) throw new Error("replay: too many frames");
  const dec = new RangeDecoder(bytes, pos);
  const model = new Model();
  const out: FrameInput[] = [];
  let x = START_X;
  let prevZ = 0;
  let prevFire = 0;
  for (let i = 0; i < count; i++) {
    const fire = dec.bit(model.fire, prevFire);
    const ctx = (prevZ < DX_CTX ? prevZ : DX_CTX - 1) * 64;
    let z = dec.tree(model.dx, ctx, 6);
    if (z === ESCAPE) z = dec.tree(model.raw, 0, RAW_BITS);
    x += unzig(z);
    if (x < 0 || x > FIELD_W) throw new Error("replay: x out of range");
    out.push({ x, fire: fire === 1 });
    prevZ = z;
    prevFire = fire;
  }
  return out;
}

/** Run a fresh game over the inputs until it is done or inputs run out. */
export function replay(cfg: RunConfig, encoded: string, opts?: { maxFrames?: number }): RunResult {
  const inputs = decodeInputs(encoded);
  const game = new Game(cfg);
  const limit = opts?.maxFrames !== undefined ? Math.min(opts.maxFrames, inputs.length) : inputs.length;
  for (let i = 0; i < limit && !game.done; i++) game.step(inputs[i]);
  return game.result();
}

/** Client helper: quantises each step's input and keeps the run's inputs. */
export class InputRecorder {
  readonly inputs: FrameInput[] = [];

  /** Record one step; feed the returned input to Game.step(). */
  record(x: number, fire: boolean): FrameInput {
    const input: FrameInput = { x: quantizeX(x), fire: fire === true };
    this.inputs.push(input);
    return input;
  }

  get frames(): number {
    return this.inputs.length;
  }

  encode(): string {
    return encodeInputs(this.inputs);
  }

  reset(): void {
    this.inputs.length = 0;
  }
}
