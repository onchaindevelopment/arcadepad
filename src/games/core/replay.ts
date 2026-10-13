/*
 * Generic input recording + server replay for all games.
 * Encoding: a run-length list of frames. Each record is
 *   varint(repeat count of the previous frame) then zigzag-varint dx,
 *   zigzag-varint dy and one byte of buttons; a final varint closes the stream.
 * Idle frames (most frames in grid and turn games) cost almost nothing.
 * Stream: "1." + base64url(bytes).
 * ArcadePad, GPL-3.0-or-later.
 */
import type { GameCtx, GameDef, GameResult, Input } from "./types.ts";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INV: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

function pushVarint(out: number[], n: number) {
  if (n < 0 || !Number.isInteger(n)) throw new Error("varint out of range");
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}
const zig = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzig = (n: number) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function toB64(bytes: number[]): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
    for (let k = 0; k < chars; k++) s += B64[(n >> (18 - 6 * k)) & 63];
  }
  return s;
}
function fromB64(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const v = k < chunk.length ? B64_INV[chunk[k]] : 0;
      if (v === undefined) throw new Error("bad replay encoding");
      n = (n << 6) | v;
    }
    const bytes = chunk.length === 4 ? 3 : chunk.length === 3 ? 2 : chunk.length === 2 ? 1 : 0;
    for (let k = 0; k < bytes; k++) out.push((n >> (16 - 8 * k)) & 255);
  }
  return Uint8Array.from(out);
}

export function encodeInputs(inputs: readonly Input[]): string {
  const bytes: number[] = [];
  let px = 0, py = 0, pb = 0;
  let repeat = 0;
  let first = true;
  for (const f of inputs) {
    if (!first && f.x === px && f.y === py && f.b === pb) {
      repeat++;
      continue;
    }
    pushVarint(bytes, repeat);
    pushVarint(bytes, zig(f.x - px));
    pushVarint(bytes, zig(f.y - py));
    bytes.push(f.b & 0xff);
    px = f.x; py = f.y; pb = f.b;
    repeat = 0;
    first = false;
  }
  pushVarint(bytes, repeat);
  return "1." + toB64(bytes);
}

export function decodeInputs(s: string, maxFrames = Infinity): Input[] {
  if (!s.startsWith("1.")) throw new Error("unknown replay version");
  const bytes = fromB64(s.slice(2));
  let i = 0;
  const readVarint = () => {
    let n = 0, mul = 1, b: number;
    do {
      if (i >= bytes.length) throw new Error("truncated replay");
      b = bytes[i++];
      n += (b & 0x7f) * mul;
      mul *= 128;
      if (mul > 2 ** 35) throw new Error("varint too long");
    } while (b & 0x80);
    return n;
  };
  const out: Input[] = [];
  let x = 0, y = 0, b = 0;
  let started = false;
  while (true) {
    const repeat = readVarint();
    if (started) for (let k = 0; k < repeat; k++) {
      out.push({ x, y, b });
      if (out.length > maxFrames) throw new Error("replay too long");
    }
    if (i >= bytes.length) break;
    x += unzig(readVarint());
    y += unzig(readVarint());
    if (i >= bytes.length) throw new Error("truncated replay");
    b = bytes[i++];
    out.push({ x, y, b });
    started = true;
    if (out.length > maxFrames) throw new Error("replay too long");
  }
  return out;
}

/** Re-run a game from its seed and recorded inputs. */
export function replayGame(def: GameDef, seed: number, ctx: GameCtx, encoded: string): GameResult {
  const inputs = decodeInputs(encoded, def.maxFrames);
  const g = def.create(seed, ctx);
  for (const inp of inputs) {
    if (g.done) break;
    g.step(inp);
  }
  return g.result();
}
