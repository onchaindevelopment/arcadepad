"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { loadGame } from "@/games/client";
import { BTN, STEP_MS, type GameDef, type GameEngine, type GameMeta, type GameRenderer, type Hud, type Input } from "@/games/core/types";
import { encodeInputs } from "@/games/core/replay";
import type { ThemePack } from "@/themes/types";
import { Synth } from "@/game/audio";
import { SONGS, defaultSongFor, getSong } from "@/game/music";
import { Mascot } from "./Mascot";
import { WalletButton, useWallet } from "./WalletButton";

type Phase = "loading" | "title" | "starting" | "playing" | "paused" | "over";
type Mood = "idle" | "happy" | "sad";
interface Result {
  score: number;
  level: number;
  status: string;
  scoreId?: string;
  rank?: number | null;
  ranked?: boolean;
  error?: string;
  offline?: boolean;
}

// The cabinet bezel is always the dark ink colour, so its text is always light.
const BEZEL_TEXT = "#FFF8EE";
const PULSE_FRAMES = 4;
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const KEYMAP: Record<string, number> = {
  arrowup: BTN.UP, w: BTN.UP,
  arrowdown: BTN.DOWN, s: BTN.DOWN,
  arrowleft: BTN.LEFT, a: BTN.LEFT,
  arrowright: BTN.RIGHT, d: BTN.RIGHT,
  " ": BTN.FIRE, enter: BTN.FIRE,
  x: BTN.ALT, shift: BTN.ALT,
};

/** practice: preview mode for unpublished skins (no server run, no leaderboard, no side panel). */
/**
 * Full-screen game stage: fills its container (the play page makes that the whole
 * viewport), scales the game to fit with letterboxing, never scrolls.
 * practice: preview mode for unpublished skins (no server run, no leaderboard).
 */
export function GameHost({
  meta,
  theme,
  title,
  practice = false,
  backHref,
  skinLinks = [],
}: {
  meta: GameMeta;
  theme: ThemePack;
  title: string;
  practice?: boolean;
  backHref?: string;
  skinLinks?: { href: string; label: string }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [isFs, setIsFs] = useState(false);
  // Music: a library song id, "theme" (the skin's own loop) or "off".
  const songKey = `gp_song_${meta.id}`;
  const [songId, setSongId] = useState<string>(() => defaultSongFor(meta.id));
  const [phase, setPhase] = useState<Phase>("loading");
  const [hud, setHud] = useState<Hud>({ score: 0 });
  const [mood, setMood] = useState<Mood>("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [wallet] = useWallet();

  const g = useRef({
    def: null as GameDef<unknown> | null,
    game: null as GameEngine<unknown> | null,
    renderer: null as GameRenderer<unknown> | null,
    synth: null as Synth | null,
    inputs: [] as Input[],
    run: null as { runId: string; ranked: boolean } | null,
    raf: 0,
    idleRaf: 0,
    acc: 0,
    last: 0,
    px: Math.round(meta.field.w / 2),
    py: Math.round(meta.field.h / 2),
    held: 0,
    pulses: new Map<number, number>(),
    firePressed: false,
    phase: "loading" as Phase,
    hudKey: "",
    moodTimer: 0,
    toastTimer: 0,
    swipeStart: null as null | { x: number; y: number; id: number },
    /** Dev-only autoplay used by automated play-tests. */
    autoplay: false,
    loopFn: null as null | ((t: number) => void),
    finishFn: null as null | (() => Promise<void>),
  });

  const setPhaseBoth = useCallback((p: Phase) => {
    g.current.phase = p;
    setPhase(p);
  }, []);

  // Load the game definition + renderer, show an idle preview.
  useEffect(() => {
    const s = g.current;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __gp?: typeof s }).__gp = s;
    let alive = true;
    s.synth = new Synth(theme.sfx, theme.music);
    let saved = false;
    try {
      saved = localStorage.getItem("gp_muted") === "1";
    } catch {}
    s.synth.setMuted(saved);
    let savedSong = defaultSongFor(meta.id);
    try {
      const v = localStorage.getItem(`gp_song_${meta.id}`);
      if (v && (v === "off" || v === "theme" || getSong(v))) savedSong = v;
    } catch {}
    s.synth.setSong(getSong(savedSong) ?? null);
    s.synth.musicOn = savedSong !== "off";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSongId(savedSong);
    // Restoring a per-browser preference after mount keeps hydration consistent.
    setMuted(saved);
    loadGame(meta.id).then(({ def, createRenderer }) => {
      if (!alive) return;
      s.def = def;
      s.renderer = createRenderer(canvasRef.current!, theme);
      s.game = def.create(1, { ticker: theme.coin.ticker });
      const idle = (t: number) => {
        if (s.phase !== "playing") s.renderer?.draw(s.game!.view(), 16);
        s.idleRaf = requestAnimationFrame(idle);
        void t;
      };
      s.idleRaf = requestAnimationFrame(idle);
      setPhaseBoth("title");
    });
    return () => {
      alive = false;
      cancelAnimationFrame(s.raf);
      cancelAnimationFrame(s.idleRaf);
      s.renderer?.dispose?.();
      s.synth?.dispose();
    };
  }, [meta.id, theme, setPhaseBoth]);

  const flashMood = useCallback((m: Mood, ms: number) => {
    window.clearTimeout(g.current.moodTimer);
    setMood(m);
    g.current.moodTimer = window.setTimeout(() => setMood("idle"), ms);
  }, []);
  const showToast = useCallback((t: string, ms = 1600) => {
    window.clearTimeout(g.current.toastTimer);
    setToast(t);
    g.current.toastTimer = window.setTimeout(() => setToast(null), ms);
  }, []);

  const finish = useCallback(async () => {
    const s = g.current;
    cancelAnimationFrame(s.raf);
    s.synth?.stopMusic();
    const res = s.game!.result();
    setPhaseBoth("over");
    flashMood(res.status === "won" ? "happy" : "sad", 4000);
    const base: Result = { score: res.score, level: res.level, status: res.status };
    if (!s.run) {
      setResult({ ...base, offline: true });
      return;
    }
    setResult(base);
    try {
      const r = await fetch("/api/run/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: s.run.runId, inputs: encodeInputs(s.inputs), score: res.score, frames: res.frames }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not verify this run.");
      setResult({ ...base, scoreId: d.scoreId, rank: d.rank, ranked: d.ranked });
    } catch (e) {
      setResult({ ...base, error: e instanceof Error ? e.message : "Could not verify this run." });
    }
  }, [flashMood, setPhaseBoth]);

  const currentInput = useCallback((): Input => {
    const s = g.current;
    let b = s.held;
    for (const [bit, n] of s.pulses) {
      if (n > 0) {
        b |= bit;
        s.pulses.set(bit, n - 1);
      }
    }
    if (s.firePressed) b |= BTN.FIRE;
    s.firePressed = false;
    if (s.autoplay && s.def?.bot && s.game) return s.def.bot(s.game.view(), s.game.frame);
    return meta.input.pointer ? { x: s.px, y: s.py, b } : { x: 0, y: 0, b };
  }, [meta.input.pointer]);

  const loop = useCallback(
    (t: number) => {
      const s = g.current;
      if (s.phase !== "playing" || !s.game) return;
      const dt = Math.min(100, t - (s.last || t));
      s.last = t;
      s.acc += dt;
      let steps = 0;
      while (s.acc >= STEP_MS && steps < 6) {
        s.acc -= STEP_MS;
        steps++;
        const input = currentInput();
        s.inputs.push(input);
        s.game.step(input);
        const evts = s.game.events;
        if (evts.length) {
          s.renderer!.onEvents(evts, s.game.view());
          for (const e of evts) {
            if (e.sfx) s.synth!.play(e.sfx);
            if (e.mood) flashMood(e.mood, e.mood === "sad" ? 1500 : 900);
            if (e.toast === "levelClear") showToast(pick(theme.copy.levelClear));
            else if (e.toast === "lifeLost") showToast(pick(theme.copy.lifeLost));
          }
        }
        if (s.game.done) {
          s.renderer!.draw(s.game.view(), dt);
          void finish();
          return;
        }
      }
      if (s.acc > STEP_MS * 6) s.acc = 0;
      s.renderer!.draw(s.game.view(), dt);
      const h = s.game.hud();
      const key = `${h.score}|${h.lives}|${h.level}|${h.label}`;
      if (key !== s.hudKey) {
        s.hudKey = key;
        setHud(h);
      }
      s.raf = requestAnimationFrame(s.loopFn!);
    },
    [currentInput, finish, flashMood, showToast, theme],
  );

  useEffect(() => {
    g.current.loopFn = loop;
    g.current.finishFn = finish;
  }, [loop, finish]);

  const resume = useCallback(() => {
    const s = g.current;
    s.last = 0;
    s.acc = 0;
    setPhaseBoth("playing");
    s.synth?.startMusic();
    s.raf = requestAnimationFrame(loop);
    wrapRef.current?.focus();
  }, [loop, setPhaseBoth]);

  const pause = useCallback(() => {
    const s = g.current;
    if (s.phase !== "playing") return;
    cancelAnimationFrame(s.raf);
    s.synth?.stopMusic();
    setPhaseBoth("paused");
  }, [setPhaseBoth]);

  const enterFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el || document.fullscreenElement || !document.fullscreenEnabled) return;
    el.requestFullscreen({ navigationUI: "hide" })
      .then(() => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return o.lock?.(meta.field.w > meta.field.h ? "landscape" : "portrait");
      })
      .catch(() => {});
  }, [meta.field.h, meta.field.w]);

  const start = useCallback(async () => {
    const s = g.current;
    if (!s.def) return;
    if (!practice && window.matchMedia("(pointer: coarse)").matches) enterFullscreen();
    s.synth?.unlock();
    setResult(null);
    setPhaseBoth("starting");
    let seed: number;
    s.run = null;
    if (practice) seed = crypto.getRandomValues(new Uint32Array(1))[0];
    else try {
      const r = await fetch("/api/run/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game: meta.id, theme: theme.id }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      seed = d.seed;
      s.run = { runId: d.runId, ranked: d.ranked };
    } catch {
      seed = crypto.getRandomValues(new Uint32Array(1))[0];
      showToast("Offline: practice run, score won't be saved", 2600);
    }
    s.game = s.def.create(seed, { ticker: theme.coin.ticker });
    s.inputs = [];
    s.held = 0;
    s.pulses.clear();
    s.hudKey = "";
    setHud(s.game.hud());
    showToast(theme.copy.start.replace(/Click or press Space to [a-z]+\./i, "").trim() || "Go!", 2200);
    resume();
  }, [enterFullscreen, meta.id, practice, resume, setPhaseBoth, showToast, theme]);

  // Input wiring
  useEffect(() => {
    const s = g.current;
    const wrap = wrapRef.current!;
    // The canvas is object-fit: contain, so map through the letterboxed content box.
    const toField = (cx: number, cy: number) => {
      const r = canvasRef.current!.getBoundingClientRect();
      const k = Math.min(r.width / meta.field.w, r.height / meta.field.h);
      const ox = r.left + (r.width - meta.field.w * k) / 2;
      const oy = r.top + (r.height - meta.field.h * k) / 2;
      return {
        x: Math.max(0, Math.min(meta.field.w, Math.round((cx - ox) / k))),
        y: Math.max(0, Math.min(meta.field.h, Math.round((cy - oy) / k))),
      };
    };
    const onMove = (e: PointerEvent) => {
      if (s.phase !== "playing") return;
      const p = toField(e.clientX, e.clientY);
      s.px = p.x;
      s.py = p.y;
    };
    const onDown = (e: PointerEvent) => {
      if (s.phase !== "playing") return;
      const p = toField(e.clientX, e.clientY);
      s.px = p.x;
      s.py = p.y;
      if (meta.input.swipe && e.pointerType !== "mouse") {
        s.swipeStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      s.held |= BTN.FIRE;
      s.firePressed = true;
      if (e.pointerType !== "mouse") wrap.setPointerCapture(e.pointerId);
    };
    const onUp = (e: PointerEvent) => {
      s.held &= ~BTN.FIRE;
      const st = s.swipeStart;
      if (st && st.id === e.pointerId) {
        s.swipeStart = null;
        const dx = e.clientX - st.x;
        const dy = e.clientY - st.y;
        const tm = meta.input.touchMap ?? {};
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) s.pulses.set(tm.tap ?? BTN.FIRE, PULSE_FRAMES);
        else if (Math.abs(dx) > Math.abs(dy)) s.pulses.set(dx > 0 ? (tm.right ?? BTN.RIGHT) : (tm.left ?? BTN.LEFT), PULSE_FRAMES);
        else s.pulses.set(dy > 0 ? (tm.down ?? BTN.DOWN) : (tm.up ?? BTN.UP), PULSE_FRAMES);
      }
    };
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const k = e.key.toLowerCase();
      if (down && (k === "p" || k === "escape")) {
        if (s.phase === "playing") pause();
        else if (s.phase === "paused") resume();
        e.preventDefault();
        return;
      }
      if (down && k === "m") {
        setMuted((m) => {
          const n = !m;
          s.synth?.setMuted(n);
          try {
            localStorage.setItem("gp_muted", n ? "1" : "0");
          } catch {}
          return n;
        });
        return;
      }
      const bit = KEYMAP[k];
      if (!bit) return;
      if (down) {
        if (!(s.held & bit) && bit === BTN.FIRE) s.firePressed = true;
        s.held |= bit;
      } else s.held &= ~bit;
      if (s.phase === "playing" || s.phase === "paused") e.preventDefault();
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => (s.held = 0);
    const vis = () => document.hidden && pause();
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    return () => {
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [meta.field.h, meta.field.w, meta.input.swipe, meta.input.touchMap, pause, resume]);

  const songChoices = [defaultSongFor(meta.id), ...SONGS.map((x) => x.id).filter((id) => id !== defaultSongFor(meta.id)), "theme", "off"];
  const songLabel = (id: string) => (id === "off" ? "Music off" : id === "theme" ? `$${theme.coin.ticker} theme` : (getSong(id)?.name ?? id));
  const cycleSong = () => {
    const next = songChoices[(songChoices.indexOf(songId) + 1) % songChoices.length];
    setSongId(next);
    try {
      localStorage.setItem(songKey, next);
    } catch {}
    const syn = g.current.synth;
    if (!syn) return;
    syn.unlock();
    syn.musicOn = next !== "off";
    syn.setSong(getSong(next) ?? null);
    if (next === "off") syn.stopMusic();
    else if (g.current.phase === "playing") syn.startMusic();
    showToast(`♪ ${songLabel(next)}`, 1400);
  };

  const toggleMute = () => {
    const n = !muted;
    setMuted(n);
    g.current.synth?.setMuted(n);
    try {
      localStorage.setItem("gp_muted", n ? "1" : "0");
    } catch {}
  };

  // Track the playfield size so overlays scale to fit (they never scroll).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      ro.disconnect();
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else enterFullscreen();
  };

  const p = theme.palette;
  const shareUrl = result?.scoreId ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${result.scoreId}` : "";
  const shareText = result ? `I scored ${result.score.toLocaleString("en-US")} in ${title} $${theme.coin.ticker} 🕹️ Can you beat it?` : "";
  // Overlay sizing from the playfield height: everything shrinks to fit, nothing scrolls.
  const H = box.h || 600;
  const compact = H < 420;
  const tiny = H < 300;
  const mascotPx = Math.round(Math.max(36, Math.min(108, H * 0.17)));
  const titlePx = Math.round(Math.max(20, Math.min(56, H * 0.085)));
  const scorePx = Math.round(Math.max(30, Math.min(96, H * 0.16)));
  const overlayBg = `${p.bg}e6`;
  const barBtn = "pixel shrink-0 rounded-full border px-2.5 py-1 text-[0.62rem] leading-none sm:text-[0.7rem]";
  const statusLine = result
    ? result.offline
      ? practice
        ? "Preview run: leaderboards switch on when this skin goes live."
        : "Practice run (offline): score not saved."
      : result.error
        ? result.error
        : !result.scoreId
          ? "Verifying your run…"
          : result.ranked
            ? `✓ Verified · ${result.rank ? `Rank #${result.rank} on the $${theme.coin.ticker} board` : "on the board"}`
            : "✓ Verified · guest run (not ranked)"
    : "";

  return (
    <div ref={stageRef} className="game-stage relative flex h-full w-full flex-col overflow-hidden" style={{ background: p.bg, color: p.text }}>
      {/* Top bar */}
      <div className="relative z-20 flex shrink-0 items-center gap-2 px-2.5 py-2 sm:gap-3 sm:px-4" style={{ background: p.ink, color: BEZEL_TEXT }}>
        {backHref && (
          <Link href={backHref} className={barBtn} style={{ borderColor: `${BEZEL_TEXT}55` }} aria-label="Back to game page">
            ←
          </Link>
        )}
        <Mascot theme={theme} mood={mood} size={26} className="shrink-0" />
        <span className="hidden min-w-0 truncate text-sm font-extrabold sm:inline">{title}</span>
        <span className="pixel ml-auto shrink-0 text-xs sm:text-sm" aria-label={`Score ${hud.score}`}>
          <span style={{ color: p.primary }}>SCORE</span> {hud.score.toLocaleString("en-US")}
        </span>
        {hud.lives !== undefined && (
          <span className="pixel shrink-0 text-xs sm:text-sm" aria-label={`${hud.lives} lives`}>
            {"♥".repeat(Math.max(0, Math.min(hud.lives, 6)))}
          </span>
        )}
        {hud.label && <span className="pixel hidden max-w-[12rem] truncate text-[0.65rem] opacity-80 md:inline">{hud.label}</span>}
        <button className={`${barBtn} max-w-[9rem] truncate`} style={{ borderColor: `${BEZEL_TEXT}55` }} onClick={cycleSong} aria-label={`Music: ${songLabel(songId)}. Click for next track.`} title="Next music track">
          ♪<span className="ml-1 hidden sm:inline">{songLabel(songId)}</span>
        </button>
        <button className={barBtn} style={{ borderColor: `${BEZEL_TEXT}55` }} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Sound off" : "Sound on"}>
          {muted ? "🔇" : "🔊"}
        </button>
        <button className={barBtn} style={{ borderColor: `${BEZEL_TEXT}55` }} onClick={toggleFullscreen} aria-pressed={isFs} aria-label={isFs ? "Exit full screen" : "Full screen"}>
          {isFs ? "⤡" : "⤢"}
        </button>
      </div>

      {/* Playfield: the canvas scales to fit (letterboxed), overlays sit on top */}
      <div
        ref={wrapRef}
        tabIndex={0}
        role="application"
        aria-label={`${title}. ${meta.controls} P to pause, M to mute.`}
        className="crt relative min-h-0 flex-1 touch-none select-none overflow-hidden outline-none"
        style={{ cursor: phase === "playing" && meta.input.pointer ? "crosshair" : "default" }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full object-contain" style={{ imageRendering: "pixelated" }} />

        {toast && phase === "playing" && (
          <div className="pointer-events-none absolute inset-x-0 top-[30%] px-3 text-center" aria-hidden>
            <span className="pixel pop-in inline-block rounded-xl border-2 px-4 py-2 text-sm sm:text-lg" style={{ background: p.ink, color: p.primary, borderColor: p.primary }}>
              {toast}
            </span>
          </div>
        )}

        {(phase === "loading" || phase === "title" || phase === "starting") && (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-3 text-center" style={{ background: overlayBg }}>
            <div className="pop-in flex max-h-full max-w-xl flex-col items-center" style={{ gap: compact ? 6 : 10 }}>
              <Mascot theme={theme} size={mascotPx} className="floaty" />
              {!tiny && (
                <p className="pixel text-xs" style={{ color: p.primary }}>
                  ${theme.coin.ticker} PRESENTS
                </p>
              )}
              <h2 className="font-extrabold leading-none tracking-tight" style={{ fontSize: titlePx }}>
                {title}
              </h2>
              {!compact && <p className="max-w-md text-sm opacity-85 sm:text-base">{meta.tagline}</p>}
              <button className="btn text-lg" style={{ background: p.primary }} onClick={start} disabled={phase !== "title"} autoFocus>
                {phase === "title" ? "▶ Insert coin" : "Loading…"}
              </button>
              {!tiny && <p className="max-w-md text-xs opacity-70">{meta.controls}</p>}
              {meta.field.w > meta.field.h * 1.4 && box.h > box.w * 1.2 && (
                <p className="pixel text-[0.65rem]" style={{ color: p.primary }}>
                  ↻ TURN YOUR PHONE SIDEWAYS FOR A BIGGER VIEW
                </p>
              )}
              {!compact && !practice && (
                <p className="text-xs opacity-60">{wallet.address ? "Signed in: this run goes on the leaderboard." : "Playing as guest. Connect a wallet to rank."}</p>
              )}
              {!compact && skinLinks.length > 0 && (
                <p className="flex flex-wrap justify-center gap-2 text-xs">
                  {skinLinks.map((l) => (
                    <Link key={l.href} href={l.href} className="chip !text-[0.6rem]">
                      {l.label}
                    </Link>
                  ))}
                </p>
              )}
            </div>
          </div>
        )}

        {phase === "paused" && (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{ background: `${p.bg}cc` }}>
            <div className="flex flex-col items-center gap-4">
              <p className="pixel text-2xl">PAUSED</p>
              <button className="btn" style={{ background: p.primary }} onClick={resume} autoFocus>
                Resume
              </button>
            </div>
          </div>
        )}

        {phase === "over" && result && (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-3 text-center" style={{ background: overlayBg }}>
            <div className="pop-in flex max-h-full max-w-xl flex-col items-center" style={{ gap: compact ? 4 : 8 }}>
              {!tiny && <Mascot theme={theme} mood={result.status === "won" ? "happy" : "sad"} size={Math.round(mascotPx * 0.8)} />}
              <p className="pixel text-xs sm:text-sm" style={{ color: p.accent }}>
                {result.status === "won" ? "ALL CLEAR" : "GAME OVER"}
              </p>
              <p className="font-extrabold leading-none tabular-nums" style={{ fontSize: scorePx }}>
                {result.score.toLocaleString("en-US")}
              </p>
              {!compact && <p className="opacity-80">{result.status === "won" ? theme.copy.won : pick(theme.copy.gameOver)}</p>}
              <p className="text-xs font-semibold sm:text-sm" role="status">
                {statusLine}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button className="btn" style={{ background: p.primary }} onClick={start} autoFocus>
                  ↻ Play again
                </button>
                {result.scoreId && (
                  <>
                    <a className="btn btn-sm btn-sun" href={`https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer">
                      Post on X
                    </a>
                    <button
                      className="btn btn-sm btn-plain"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(shareUrl);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        } catch {}
                      }}
                    >
                      {copied ? "Copied!" : "Copy link"}
                    </button>
                    {!tiny && (
                      <a className="btn btn-sm btn-plain" href={`/s/${result.scoreId}`} target="_blank" rel="noopener noreferrer">
                        Score card
                      </a>
                    )}
                  </>
                )}
              </div>
              {!practice && !compact && result.scoreId && !result.ranked && (
                <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                  <span className="opacity-80">Sign in to rank your next run:</span>
                  <WalletButton compact />
                </div>
              )}
              {!practice && !tiny && (
                <Link href={`/leaderboard?game=${meta.id}&coin=${theme.id}`} className="text-xs underline opacity-80">
                  ${theme.coin.ticker} {meta.name} leaderboard
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      <div aria-live="polite" className="sr-only">
        {phase === "over" && result ? `Game over. Score ${result.score}. ${result.scoreId ? "Score verified." : ""}` : ""}
      </div>
    </div>
  );
}
