// ArcadePad chiptune library: original songs, sequenced from chord progressions,
// handwritten lead lines and drum styles. All compositions are original to
// ArcadePad (GPL-3.0-or-later). Played by the WebAudio synth in audio.ts.

export type BassStyle = "pulse" | "walk" | "long" | "bounce";
export type ArpStyle = "up16" | "updown8" | "broken" | "none";
export type DrumStyle = "four" | "drive" | "half" | "lofi" | "march";

export interface Section {
  /** 4 chords, one per 8 steps (32 steps of 16th notes). e.g. "Cm", "Ab", "Bb7", "G". */
  chords: [string, string, string, string];
  /** 32 tokens: note ("E5"), "." rest, "-" hold previous. */
  lead: string;
}

export interface Song {
  id: string;
  name: string;
  bpm: number;
  bass: BassStyle;
  arp: ArpStyle;
  drums: DrumStyle;
  sections: Record<string, Section>;
  order: string; // e.g. "AABA"
}

const NOTE_INDEX: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };

export function midiOf(note: string): number {
  const m = /^([A-G](?:#|b)?)(\d)$/.exec(note);
  if (!m) return -1;
  return (Number(m[2]) + 1) * 12 + NOTE_INDEX[m[1]];
}
export const hzOf = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function chordTones(chord: string): number[] {
  const m = /^([A-G](?:#|b)?)(m7|maj7|m|7|sus4|dim)?$/.exec(chord);
  if (!m) return [0, 4, 7];
  const root = NOTE_INDEX[m[1]];
  const q = m[2] ?? "";
  const iv = q === "m" ? [0, 3, 7] : q === "m7" ? [0, 3, 7, 10] : q === "7" ? [0, 4, 7, 10] : q === "maj7" ? [0, 4, 7, 11] : q === "sus4" ? [0, 5, 7] : q === "dim" ? [0, 3, 6] : [0, 4, 7];
  return iv.map((i) => root + i);
}

export interface Step {
  lead?: { midi: number; len: number };
  bass?: { midi: number; len: number };
  arp?: { midi: number; len: number };
  kick?: boolean;
  snare?: boolean;
  hat?: boolean;
  /** Accent for open hats / crashes at section starts. */
  crash?: boolean;
}

const DRUMS: Record<DrumStyle, { kick: string; snare: string; hat: string }> = {
  four: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "..x...x...x...x." },
  drive: { kick: "x.....x.x.....x.", snare: "....x.......x...", hat: "xxxxxxxxxxxxxxxx" },
  half: { kick: "x.........x.....", snare: "........x.......", hat: "x.x.x.x.x.x.x.x." },
  lofi: { kick: "x......x..x.....", snare: "....x.......x..x", hat: "x.x.x.xxx.x.x.x." },
  march: { kick: "x...x...x...x...", snare: "..x...x...x.x.x.", hat: "x...x...x...x..." },
};

/** Expand a song into a flat list of 16th-note steps. */
export function sequence(song: Song): Step[] {
  const out: Step[] = [];
  const d = DRUMS[song.drums];
  for (let si = 0; si < song.order.length; si++) {
    const sec = song.sections[song.order[si]];
    const lead = sec.lead.trim().split(/\s+/);
    for (let i = 0; i < 32; i++) {
      const st: Step = {};
      const chord = chordTones(sec.chords[Math.floor(i / 8)]);
      const root = chord[0];
      // Lead: note with length = 1 + following holds.
      const tok = lead[i] ?? ".";
      if (tok !== "." && tok !== "-") {
        let len = 1;
        while (lead[i + len] === "-") len++;
        const midi = midiOf(tok);
        if (midi > 0) st.lead = { midi, len };
      }
      // Bass
      const b = i % 8;
      const bassRoot = 36 + root; // C2-based
      if (song.bass === "pulse" && b % 2 === 0) st.bass = { midi: bassRoot, len: 1 };
      else if (song.bass === "walk" && b % 2 === 0) st.bass = { midi: bassRoot + [0, 7, 12, 7][b / 2], len: 2 };
      else if (song.bass === "long" && b === 0) st.bass = { midi: bassRoot, len: 8 };
      else if (song.bass === "bounce" && (b === 0 || b === 3 || b === 6)) st.bass = { midi: bassRoot + (b === 3 ? 12 : 0), len: 2 };
      // Arpeggio over the chord, an octave above the bass's octave + 2.
      const tones = [...chord, chord[0] + 12];
      if (song.arp === "up16") st.arp = { midi: 60 + tones[i % tones.length], len: 1 };
      else if (song.arp === "updown8" && i % 2 === 0) {
        const seq = [...tones, ...tones.slice(1, -1).reverse()];
        st.arp = { midi: 60 + seq[(i / 2) % seq.length], len: 2 };
      } else if (song.arp === "broken" && i % 4 !== 3) st.arp = { midi: 60 + tones[(i * 2) % tones.length], len: 1 };
      // Drums (16-step patterns repeat twice per section).
      const k = i % 16;
      st.kick = d.kick[k] === "x";
      st.snare = d.snare[k] === "x";
      st.hat = d.hat[k] === "x";
      if (i === 0 && si > 0 && song.order[si] !== song.order[si - 1]) st.crash = true;
      out.push(st);
    }
  }
  return out;
}

export const SONGS: Song[] = [
  {
    // Site theme: driving arcade-fighter energy, A minor.
    id: "versus",
    name: "Versus",
    bpm: 156,
    bass: "pulse",
    arp: "up16",
    drums: "drive",
    order: "AABCAB",
    sections: {
      A: { chords: ["Am", "F", "G", "E"], lead: "A4 . A4 . C5 . A4 . E5 - D5 . C5 . B4 . A4 - - . G4 . A4 . C5 . D5 . E5 - G5 ." },
      B: { chords: ["Dm", "Am", "E", "E"], lead: "A5 - - . G5 . E5 . F5 - E5 . D5 . C5 . D5 - - . E5 . D5 . C5 . B4 . G#4 - B4 ." },
      C: { chords: ["F", "G", "E", "Am"], lead: "C5 . C5 . E5 . G5 . F5 - E5 . D5 . C5 . E5 . E5 . G#5 . B5 . A5 - - - A5 . . ." },
    },
  },
  {
    // Site title screen: bright, bouncy, loops cleanly.
    id: "title-screen",
    name: "Title Screen",
    bpm: 132,
    bass: "bounce",
    arp: "updown8",
    drums: "four",
    order: "AABC",
    sections: {
      A: { chords: ["C", "Am", "F", "G"], lead: "C5 . E5 . G5 . C6 - B5 . G5 . E5 - - . A4 . C5 . F5 . A5 - G5 . F5 . D5 - - ." },
      B: { chords: ["C", "Am", "F", "G"], lead: "E5 . G5 . C6 . E6 - D6 . C6 . A5 - - . F5 . A5 . C6 . A5 - B5 . D6 . G5 - - ." },
      C: { chords: ["F", "G", "Em", "Am"], lead: "A5 - C6 . A5 . G5 - B5 - G5 . F5 . E5 - G5 - E5 . D5 . C5 - E5 . G5 . C6 - - - " },
    },
  },
  {
    id: "insert-coin",
    name: "Insert Coin",
    bpm: 140,
    bass: "pulse",
    arp: "updown8",
    drums: "four",
    order: "AABA",
    sections: {
      A: { chords: ["C", "G", "Am", "F"], lead: "E5 - G5 . C6 - B5 . A5 - G5 . E5 - . . D5 - E5 . G5 - E5 . F5 - A5 . G5 - - -" },
      B: { chords: ["F", "G", "Em", "Am"], lead: "A5 . A5 . G5 - F5 . E5 - D5 . E5 - - . F5 . F5 . E5 - D5 . C5 - D5 . E5 - - -" },
    },
  },
  {
    id: "moon-chase",
    name: "Moon Chase",
    bpm: 152,
    bass: "bounce",
    arp: "up16",
    drums: "drive",
    order: "AABB",
    sections: {
      A: { chords: ["Am", "F", "C", "G"], lead: "A5 . C6 . E6 - D6 C6 B5 - A5 . G5 . A5 - C6 . A5 . E5 - G5 A5 B5 - G5 . D5 - - ." },
      B: { chords: ["Dm", "Am", "E", "Am"], lead: "F5 - A5 - D6 - C6 - A5 . G5 . F5 . E5 . G#5 - B5 - E6 - D6 - C6 . B5 . A5 - - -" },
    },
  },
  {
    id: "candle-wax",
    name: "Candle Wax",
    bpm: 104,
    bass: "long",
    arp: "broken",
    drums: "lofi",
    order: "ABAB",
    sections: {
      A: { chords: ["Fmaj7", "Em7", "Dm7", "Cmaj7"], lead: "A5 - - . G5 - E5 - . . C5 - D5 - - - F5 - E5 . D5 - C5 - . . A4 - C5 - - -" },
      B: { chords: ["Dm7", "G7", "Cmaj7", "Am7"], lead: "F5 - E5 - D5 - - . G5 - F5 . E5 - D5 - E5 - - - G5 - - . C6 - B5 . A5 - - -" },
    },
  },
  {
    id: "pump-it",
    name: "Pump It",
    bpm: 168,
    bass: "pulse",
    arp: "up16",
    drums: "drive",
    order: "AABA",
    sections: {
      A: { chords: ["Em", "C", "D", "B"], lead: "E5 E5 G5 . B5 . E6 . D6 . B5 . G5 . A5 B5 C6 . B5 . A5 . F#5 . A5 . D#5 - F#5 - B5 ." },
      B: { chords: ["C", "D", "Em", "Em"], lead: "G5 - C6 - E6 - D6 . C6 . D6 - F#6 - D6 . B5 - E6 - - - G6 - F#6 - E6 - - - . ." },
    },
  },
  {
    id: "neon-slope",
    name: "Neon Slope",
    bpm: 128,
    bass: "walk",
    arp: "up16",
    drums: "four",
    order: "AABA",
    sections: {
      A: { chords: ["Cm", "Ab", "Eb", "Bb"], lead: "G5 - - . Eb5 - G5 - C6 - - . Bb5 - Ab5 - G5 - - . Eb5 - F5 - G5 - Bb5 - F5 - - -" },
      B: { chords: ["Ab", "Bb", "Gm", "Cm"], lead: "C6 - Bb5 - Ab5 - G5 - D6 - C6 - Bb5 - F5 - Bb5 - D6 - G6 - F6 - Eb6 - D6 - C6 - - -" },
    },
  },
  {
    id: "bubble-tea",
    name: "Bubble Tea",
    bpm: 118,
    bass: "bounce",
    arp: "updown8",
    drums: "half",
    order: "AABA",
    sections: {
      A: { chords: ["G", "Em", "C", "D"], lead: "B5 . D6 . B5 . G5 . E5 - G5 . B5 - . . C6 . E6 . C6 . G5 . A5 - B5 . A5 - . ." },
      B: { chords: ["C", "D", "Bm", "Em"], lead: "E6 - D6 . C6 - B5 . A5 - - . F#5 - A5 . D6 - C6 . B5 - A5 . G5 - E5 - - - . ." },
    },
  },
  {
    id: "boss-bear",
    name: "Boss Bear",
    bpm: 136,
    bass: "pulse",
    arp: "broken",
    drums: "march",
    order: "AABB",
    sections: {
      A: { chords: ["Dm", "Dm", "Bb", "A"], lead: "D5 . D5 . F5 . E5 . D5 . C5 . D5 - - . A5 . A5 . G5 . F5 . E5 . C#5 . E5 - - ." },
      B: { chords: ["Gm", "Dm", "Bb", "A7"], lead: "G5 - Bb5 - D6 - C6 . Bb5 . A5 - F5 - D5 - Bb5 - A5 . G5 . F5 . E5 . C#6 - E6 - A5 -" },
    },
  },
  {
    id: "lofi-orbit",
    name: "Lo-fi Orbit",
    bpm: 88,
    bass: "long",
    arp: "broken",
    drums: "lofi",
    order: "AB",
    sections: {
      A: { chords: ["Am7", "Dm7", "Gsus4", "Cmaj7"], lead: "E5 - - - G5 - A5 - . . C6 - B5 - G5 - A5 - - - . . D5 - E5 - G5 - - - . ." },
      B: { chords: ["Fmaj7", "Em7", "Dm7", "G7"], lead: "A5 - G5 - E5 - - - F5 - E5 - D5 - C5 - E5 - - - D5 - - - B4 - D5 - G5 - - -" },
    },
  },
];

/** Default track per game (mood), others fall back by index. */
const GAME_SONG: Record<string, string> = {
  quest: "insert-coin", pins: "pump-it", hex: "neon-slope", crawler: "boss-bear", crates: "lofi-orbit", echo: "bubble-tea", tanks: "boss-bear", checkers: "lofi-orbit", digger: "moon-chase",
  defense: "boss-bear", lander: "lofi-orbit", bridge: "bubble-tea", swarm: "boss-bear", whack: "pump-it", beat: "neon-slope", trails: "moon-chase", four: "lofi-orbit", bomber: "insert-coin",
  breakout: "insert-coin", pinball: "insert-coin", slope: "neon-slope", lanes: "pump-it", runner: "pump-it",
  sling: "bubble-tea", blocks: "candle-wax", maze: "moon-chase", invaders: "boss-bear", rocks: "boss-bear",
  flap: "bubble-tea", jumper: "neon-slope", hopper: "insert-coin", slice: "moon-chase", snake: "moon-chase",
  bubbles: "bubble-tea", cave: "neon-slope", target: "lofi-orbit", duel: "pump-it", stack: "lofi-orbit",
  merge: "lofi-orbit", helix: "neon-slope", colorhop: "bubble-tea", match3: "candle-wax", pulse: "pump-it",
  blob: "lofi-orbit", turf: "moon-chase", hill: "insert-coin", gridfit: "candle-wax", barrage: "boss-bear",
  solitaire: "lofi-orbit", sweeper: "candle-wax", putt: "bubble-tea", hoops: "pump-it", puck: "moon-chase",
  towers: "boss-bear", racer: "neon-slope", chain: "insert-coin", tiles: "candle-wax",
};

export function defaultSongFor(gameId: string): string {
  return GAME_SONG[gameId] ?? SONGS[Math.abs([...gameId].reduce((a, c) => a + c.charCodeAt(0), 0)) % SONGS.length].id;
}

export function getSong(id: string): Song | undefined {
  return SONGS.find((s) => s.id === id);
}
