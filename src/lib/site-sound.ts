"use client";
// Site-wide sound: a looping background track plus synth UI blips, shared by the header
// speaker button, menus and the game shelf. Browsers allow audio only after a user
// gesture, so nothing plays until the first click/tap/key.
//
// Music: "Insert Coin" by megupets (opengameart.org/content/insert-coin), CC0.
import { Synth } from "@/game/audio";
import { THEMES } from "@/themes";
import type { SfxName } from "@/themes/types";

const KEY = "ap_sound";
const TRACK = "/music/insert-coin.mp3";
const VOLUME = 0.35;

let synth: Synth | null = null;
let track: HTMLAudioElement | null = null;
let on = true;
let loaded = false;
let suppressed = false; // a game is running or we're on a full-screen game route
const subs = new Set<() => void>();

function init() {
  if (loaded) return;
  loaded = true;
  try {
    on = localStorage.getItem(KEY) !== "off";
  } catch {}
}

function getSynth(): Synth {
  if (!synth) {
    const t = THEMES[0];
    synth = new Synth(t.sfx, t.music);
  }
  return synth;
}

function getTrack(): HTMLAudioElement {
  if (!track) {
    track = new Audio(TRACK);
    track.loop = true;
    track.preload = "auto";
    track.volume = VOLUME;
  }
  return track;
}

function playTrack() {
  const t = getTrack();
  if (!t.paused) return;
  void t.play().catch(() => {});
}

const emit = () => subs.forEach((f) => f());

export const siteSound = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
  isOn: () => {
    init();
    return on;
  },
  /** Call from any user gesture: unlocks audio and starts the music once. */
  wake() {
    init();
    getSynth().unlock();
    if (on && !suppressed) playTrack();
  },
  blip(name: SfxName) {
    init();
    if (!on || suppressed) return;
    const s = getSynth();
    s.unlock();
    s.play(name);
  },
  toggle() {
    init();
    on = !on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {}
    getSynth().unlock();
    if (on && !suppressed) {
      playTrack();
      getSynth().play("extraGood");
    } else {
      track?.pause();
    }
    emit();
  },
  /** Games bring their own music: pause the site track while one runs. */
  suppress(v: boolean) {
    suppressed = v;
    if (v) track?.pause();
  },
  pause() {
    track?.pause();
  },
  resumeIfOn() {
    if (track && on && !suppressed) playTrack();
  },
};
