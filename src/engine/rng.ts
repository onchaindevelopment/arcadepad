/*
 * rng.ts - seeded 32-bit pseudo random number generator (mulberry32).
 * Game Port, GPL-3.0-or-later.
 *
 * Integer operations only (Math.imul, shifts, xor), so the sequence is
 * identical in every JavaScript engine. Replaces the C library rand() calls
 * of the original game; every random decision of a run comes from one Rng
 * owned by the Game instance.
 */

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Next unsigned 32-bit integer. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Like C `rand() % n`: integer in [0, n). */
  int(n: number): number {
    return this.next() % n;
  }

  /** Like LBreakout2 RANDOM(lo, hi): integer in [lo, hi]. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  /** Internal state, e.g. for snapshots. */
  get state(): number {
    return this.s >>> 0;
  }
}
