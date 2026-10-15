"use client";
// Site-wide sound: the original "Title Screen" chiptune plus UI blips, all played live by
// the WebAudio synth (nothing sampled), shared by the header speaker button, menus and the
// game shelf. Browsers allow audio only after a user gesture, so nothing plays until the
// first click/tap/key.
import { Synth } from "@/game/audio";
import { getSong } from "@/game/music";
import { THEMES } from "@/themes";
import type { SfxName } from "@/themes/types";

const KEY = "ap_sound";
const SONG = "title-screen";

let synth: Synth | null = null;
let on = true;
let loaded = false;
let playing = false;
let suppressed = false; // a game is running or we're on a full-screen game route
const subs = new Set<() => void>();

function init() {
  if (loaded) return;
  loaded = true;
  try {
    on = localStorage.getItem(KEY) !== "off";
  } catch {}
}

function get(): Synth {
  if (!synth) {
    const t = THEMES[0];
    synth = new Synth(t.sfx, t.music);
    synth.setSong(getSong(SONG) ?? null);
  }
  return synth;
}

function startMusic() {
  if (playing) return;
  get().startMusic();
  playing = true;
}

function stopMusic() {
  synth?.stopMusic();
  playing = false;
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
    get().unlock();
    if (on && !suppressed) startMusic();
  },
  blip(name: SfxName) {
    init();
    if (!on || suppressed) return;
    const s = get();
    s.unlock();
    s.play(name);
  },
  toggle() {
    init();
    on = !on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {}
    get().unlock();
    if (on && !suppressed) {
      startMusic();
      get().play("extraGood");
    } else {
      stopMusic();
    }
    emit();
  },
  /** Games bring their own music: stop the site tune while one runs. */
  suppress(v: boolean) {
    suppressed = v;
    if (v) stopMusic();
  },
  pause() {
    stopMusic();
  },
  resumeIfOn() {
    if (synth && on && !suppressed) startMusic();
  },
};
