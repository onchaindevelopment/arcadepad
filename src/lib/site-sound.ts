"use client";
// Site-wide sound: title-screen chiptune + UI blips, shared by the header speaker button,
// menus and the game shelf. Browsers allow audio only after a user gesture, so nothing
// plays until the first click/tap/key.
import { Synth } from "@/game/audio";
import { getSong } from "@/game/music";
import { THEMES } from "@/themes";
import type { SfxName } from "@/themes/types";

const KEY = "ap_sound";
let synth: Synth | null = null;
let on = true;
let musicPlaying = false;
let suppressed = false; // a game is running or we're on a full-screen game route
const subs = new Set<() => void>();

function get(): Synth {
  if (!synth) {
    const t = THEMES[0];
    synth = new Synth(t.sfx, t.music);
    synth.setSong(getSong("versus") ?? null);
    try {
      on = localStorage.getItem(KEY) !== "off";
    } catch {}
  }
  return synth;
}

const emit = () => subs.forEach((f) => f());

export const siteSound = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
  isOn: () => (synth ? on : (() => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } })()),
  /** Call from any user gesture: unlocks audio and starts the title music once. */
  wake() {
    const s = get();
    s.unlock();
    if (on && !musicPlaying && !suppressed) {
      s.startMusic();
      musicPlaying = true;
    }
  },
  blip(name: SfxName) {
    const s = get();
    if (!on || suppressed) return;
    s.unlock();
    s.play(name);
  },
  toggle() {
    const s = get();
    on = !on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {}
    s.unlock();
    if (on && !suppressed) {
      s.startMusic();
      musicPlaying = true;
      s.play("extraGood");
    } else {
      s.stopMusic();
      musicPlaying = false;
    }
    emit();
  },
  /** Games bring their own music: pause the title tune while one runs. */
  suppress(v: boolean) {
    suppressed = v;
    if (!synth) return;
    if (v) {
      synth.stopMusic();
      musicPlaying = false;
    }
  },
  pause() {
    synth?.stopMusic();
    musicPlaying = false;
  },
  resumeIfOn() {
    if (synth && on && !suppressed && !musicPlaying) {
      synth.startMusic();
      musicPlaying = true;
    }
  },
};
