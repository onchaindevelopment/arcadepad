// Tiny WebAudio synth: theme packs describe sounds as recipes, nothing is sampled.
import type { MusicRecipe, SfxName, SfxRecipe } from "@/themes/types";
import { hzOf, sequence, type Song, type Step } from "./music";

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
  /** Song from the library; null plays the skin's own 16-step theme loop. */
  private song: Song | null = null;
  private seq: Step[] = [];

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

  /** Pick a library song (null = skin theme loop). Restarts playback if music is running. */
  setSong(song: Song | null) {
    const wasPlaying = this.musicTimer !== null;
    this.stopMusic();
    this.song = song;
    this.seq = song ? sequence(song) : [];
    if (wasPlaying) this.startMusic();
  }

  startMusic() {
    if (!this.ctx || this.musicTimer !== null || !this.musicOn) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    const tick = () => {
      if (!this.ctx) return;
      if (this.song) {
        const stepDur = 60 / this.song.bpm / 4;
        while (this.nextTime < this.ctx.currentTime + 0.25) {
          this.scheduleStep(this.seq[this.step], this.nextTime, stepDur);
          this.step = (this.step + 1) % this.seq.length;
          this.nextTime += stepDur;
        }
        return;
      }
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

  private tone(wave: OscillatorType, hz: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.musicGain) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = wave;
    o.frequency.value = hz;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.musicGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseHit(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number) {
    if (!this.ctx || !this.musicGain || !this.noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.musicGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private scheduleStep(st: Step | undefined, t: number, stepDur: number) {
    if (!st || !this.ctx || !this.musicGain) return;
    // Skin voices: the theme's lead and bass waveforms colour every song.
    if (st.lead) this.tone(this.music.lead, hzOf(st.lead.midi), t, stepDur * st.lead.len * 0.92, 0.42);
    if (st.bass) this.tone(this.music.bass, hzOf(st.bass.midi), t, stepDur * st.bass.len * 0.9, 0.7);
    if (st.arp) this.tone("triangle", hzOf(st.arp.midi), t, stepDur * st.arp.len * 0.8, 0.16);
    if (st.kick) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g).connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.18);
    }
    if (st.snare) {
      this.noiseHit(t, 0.13, 0.45, "bandpass", 1900);
      this.tone("triangle", 190, t, 0.08, 0.25);
    }
    if (st.hat) this.noiseHit(t, 0.035, 0.18, "highpass", 7500);
    if (st.crash) this.noiseHit(t, 0.7, 0.3, "highpass", 5000);
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
