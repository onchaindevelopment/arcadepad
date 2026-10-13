// Tiny WebAudio synth: theme packs describe sounds as recipes, nothing is sampled.
import type { MusicRecipe, SfxName, SfxRecipe } from "@/themes/types";

const NOTE_INDEX: Record<string, number> = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };

function noteHz(n: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(n);
  if (!m) return 0;
  const midi = (Number(m[2]) + 1) * 12 + NOTE_INDEX[m[1]];
  return 440 * 2 ** ((midi - 69) / 12);
}

export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private lastPlayed: Partial<Record<SfxName, number>> = {};
  muted = false;
  musicOn = true;

  constructor(private sfx: Record<SfxName, SfxRecipe>, private music: MusicRecipe) {}

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.02);
  }

  play(name: SfxName) {
    const ctx = this.ctx;
    const r = this.sfx[name];
    if (!ctx || !this.master || !r || this.muted) return;
    // Rate-limit identical sounds so multiball chaos doesn't clip.
    const now = ctx.currentTime;
    if ((this.lastPlayed[name] ?? -1) > now - 0.03) return;
    this.lastPlayed[name] = now;

    const g = ctx.createGain();
    g.gain.setValueAtTime(r.vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + r.dur);
    g.connect(this.master);

    if (r.wave === "noise") {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(r.f0, now);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, r.f1), now + r.dur);
      src.connect(f).connect(g);
      src.start(now);
      src.stop(now + r.dur);
      return;
    }
    const o = ctx.createOscillator();
    o.type = r.wave;
    if (r.arp?.length) {
      const stepDur = r.dur / r.arp.length;
      r.arp.forEach((semi, i) => o.frequency.setValueAtTime(r.f0 * 2 ** (semi / 12), now + i * stepDur));
    } else {
      o.frequency.setValueAtTime(r.f0, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, r.f1), now + r.dur);
    }
    o.connect(g);
    o.start(now);
    o.stop(now + r.dur + 0.02);
  }

  startMusic() {
    if (!this.ctx || this.musicTimer !== null || !this.musicOn) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    const tick = () => {
      if (!this.ctx) return;
      const stepDur = 60 / this.music.bpm / 4;
      while (this.nextTime < this.ctx.currentTime + 0.2) {
        this.scheduleNote(this.music.leadSteps, this.music.lead, this.step, this.nextTime, stepDur, 0.5);
        this.scheduleNote(this.music.bassSteps, this.music.bass, this.step, this.nextTime, stepDur, 0.8);
        this.step = (this.step + 1) % 16;
        this.nextTime += stepDur;
      }
    };
    tick();
    this.musicTimer = window.setInterval(tick, 50);
  }

  stopMusic() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private scheduleNote(steps: string[], wave: OscillatorType, i: number, t: number, stepDur: number, vol: number) {
    const n = steps[i];
    if (!n || n === "." || n === "-" || !this.ctx || !this.musicGain) return;
    let len = 1;
    while (steps[(i + len) % 16] === "-" && len < 16) len++;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = wave;
    o.frequency.value = noteHz(n);
    const d = stepDur * len * 0.9;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g).connect(this.musicGain);
    o.start(t);
    o.stop(t + d + 0.02);
  }

  dispose() {
    this.stopMusic();
    void this.ctx?.close();
    this.ctx = null;
  }
}
