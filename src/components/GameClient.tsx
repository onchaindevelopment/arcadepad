"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Game, encodeInputs, runLevels } from "@/engine";
import { FIELD_W, STEP_MS, type FrameInput, type GameEvent, type GameView } from "@/engine/types";
import type { SfxName, ThemePack } from "@/themes/types";
import { Renderer } from "@/game/renderer";
import { Synth } from "@/game/audio";
import { Mascot } from "./Mascot";
import { WalletButton, useWallet } from "./WalletButton";

type Phase = "title" | "loading" | "playing" | "paused" | "over";
type Mood = "idle" | "happy" | "sad";
interface Hud {
  score: number;
  lives: number;
  level: number;
  levelTitle: string;
}
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

const KEY_SPEED = 9;
// The cabinet bezel is always the dark ink colour, so its text is always light.
const BEZEL_TEXT = "#FFF8EE";
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function sfxFor(e: GameEvent): SfxName | null {
  switch (e.t) {
    case "paddle": return "paddle";
    case "wall": return "wall";
    case "brickhit": return "brick";
    case "brickgone": return "brickgone";
    case "explode": return "explode";
    case "extra": return e.good ? "extraGood" : "extraBad";
    case "shot": return "shot";
    case "launch": return "launch";
    case "lifelost": return "lost";
    case "levelclear": return "levelclear";
    case "gameover": return "gameover";
    case "won": return "won";
    default: return null;
  }
}

export function GameClient({ theme }: { theme: ThemePack }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("title");
  const [hud, setHud] = useState<Hud>({ score: 0, lives: 3, level: 0, levelTitle: "" });
  const [mood, setMood] = useState<Mood>("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [muted, setMuted] = useState(false);
  const [wallet] = useWallet();
  const [copied, setCopied] = useState(false);

  // Mutable game state that the RAF loop reads without re-rendering.
  const g = useRef({
    game: null as Game | null,
    renderer: null as Renderer | null,
    synth: null as Synth | null,
    inputs: [] as FrameInput[],
    run: null as { runId: string; ranked: boolean } | null,
    raf: 0,
    acc: 0,
    last: 0,
    targetX: FIELD_W / 2,
    keys: { left: false, right: false },
    fireHeld: false,
    firePressed: false,
    phase: "title" as Phase,
    hud: { score: 0, lives: 3, level: 0, levelTitle: "" } as Hud,
    moodTimer: 0,
    toastTimer: 0,
    view: null as GameView | null,
    /** Dev-only autoplay used by automated play-tests. */
    autoplay: null as null | ((v: GameView) => number),
    finishFn: null as null | (() => Promise<void>),
    loopFn: null as null | ((t: number) => void),
  });

  const setPhaseBoth = useCallback((p: Phase) => {
    g.current.phase = p;
    setPhase(p);
  }, []);

  // Renderer + synth live for the component's lifetime.
  useEffect(() => {
    const s = g.current;
    // Dev-only hook for automated play-testing (never shipped in production builds).
    if (process.env.NODE_ENV !== "production") (window as unknown as { __gp?: typeof s }).__gp = s;
    s.renderer = new Renderer(canvasRef.current!, theme);
    s.synth = new Synth(theme.sfx, theme.music);
    let muteSaved = false;
    try {
      muteSaved = localStorage.getItem("gp_muted") === "1";
    } catch {}
    s.synth.setMuted(muteSaved);
    // Restoring a per-browser preference after mount keeps hydration consistent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(muteSaved);
    // Title screen preview: a fresh level standing still.
    const preview = new Game({ seed: 1, levels: runLevels(theme.coin.ticker) });
    s.view = preview.view();
    s.renderer.draw(s.view, 16);
    let raf = 0;
    const idle = (t: number) => {
      if (s.phase === "title" || s.phase === "over") {
        s.renderer!.draw(s.view!, 16);
      }
      raf = requestAnimationFrame(idle);
      void t;
    };
    raf = requestAnimationFrame(idle);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(s.raf);
      s.synth?.dispose();
    };
  }, [theme]);

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
        if (s.autoplay && s.view) {
          s.targetX = s.autoplay(s.view);
          s.firePressed = true;
        }
        if (s.keys.left) s.targetX -= KEY_SPEED;
        if (s.keys.right) s.targetX += KEY_SPEED;
        s.targetX = Math.max(0, Math.min(FIELD_W, s.targetX));
        const input: FrameInput = { x: Math.round(s.targetX), fire: s.fireHeld || s.firePressed };
        s.firePressed = false;
        s.inputs.push(input);
        const v = s.game.step(input);
        s.view = v;
        s.renderer!.events(v.events);
        for (const e of v.events) {
          const snd = sfxFor(e);
          if (snd) s.synth!.play(snd);
          if (e.t === "levelclear") {
            flashMood("happy", 1600);
            showToast(pick(theme.copy.levelClear));
          } else if (e.t === "lifelost") {
            flashMood("sad", 1500);
            showToast(pick(theme.copy.lifeLost));
          } else if (e.t === "extra" && e.good) flashMood("happy", 700);
        }
        if (s.game.done) {
          s.renderer!.draw(v, dt);
          void finish();
          return;
        }
      }
      if (s.acc > STEP_MS * 6) s.acc = 0; // dropped frames: don't spiral
      const v = s.view!;
      s.renderer!.draw(v, dt);
      const h = s.hud;
      if (h.score !== v.score || h.lives !== v.lives || h.level !== v.level) {
        s.hud = { score: v.score, lives: v.lives, level: v.level, levelTitle: v.levelTitle };
        setHud(s.hud);
      }
      s.raf = requestAnimationFrame(s.loopFn!);
    },
    [finish, flashMood, showToast, theme],
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

  const start = useCallback(async () => {
    const s = g.current;
    s.synth?.unlock();
    setResult(null);
    setPhaseBoth("loading");
    let seed: number;
    s.run = null;
    try {
      const r = await fetch("/api/run/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ theme: theme.id }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      seed = d.seed;
      s.run = { runId: d.runId, ranked: d.ranked };
    } catch {
      seed = crypto.getRandomValues(new Uint32Array(1))[0];
      showToast("Offline: practice run, score won't be saved", 2600);
    }
    s.game = new Game({ seed, levels: runLevels(theme.coin.ticker) });
    s.inputs = [];
    s.targetX = FIELD_W / 2;
    s.view = s.game.view();
    s.hud = { score: 0, lives: s.view.lives, level: 0, levelTitle: s.view.levelTitle };
    setHud(s.hud);
    showToast(theme.copy.start, 2600);
    resume();
  }, [resume, setPhaseBoth, showToast, theme]);

  // Input
  useEffect(() => {
    const s = g.current;
    const wrap = wrapRef.current!;
    const toField = (clientX: number) => {
      const r = canvasRef.current!.getBoundingClientRect();
      return ((clientX - r.left) / r.width) * FIELD_W;
    };
    const onMove = (e: PointerEvent) => {
      if (s.phase === "playing") s.targetX = toField(e.clientX);
    };
    const onDown = (e: PointerEvent) => {
      if (s.phase !== "playing") return;
      s.targetX = toField(e.clientX);
      s.fireHeld = true;
      s.firePressed = true;
      if (e.pointerType !== "mouse") wrap.setPointerCapture(e.pointerId);
    };
    const onUp = () => (s.fireHeld = false);
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") s.keys.left = down;
      else if (k === "arrowright" || k === "d") s.keys.right = down;
      else if (k === " " || k === "arrowup" || k === "w") {
        if (s.phase === "playing") {
          s.fireHeld = down;
          if (down) s.firePressed = true;
        }
      } else if (down && (k === "p" || k === "escape")) {
        if (s.phase === "playing") pause();
        else if (s.phase === "paused") resume();
      } else if (down && k === "m") {
        setMuted((m) => {
          const n = !m;
          s.synth?.setMuted(n);
          try {
            localStorage.setItem("gp_muted", n ? "1" : "0");
          } catch {}
          return n;
        });
      } else return;
      if (s.phase === "playing" || s.phase === "paused") e.preventDefault();
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const vis = () => document.hidden && pause();
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    document.addEventListener("visibilitychange", vis);
    return () => {
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [pause, resume]);

  const toggleMute = () => {
    const n = !muted;
    setMuted(n);
    g.current.synth?.setMuted(n);
    try {
      localStorage.setItem("gp_muted", n ? "1" : "0");
    } catch {}
  };

  const p = theme.palette;
  const shareUrl = result?.scoreId ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${result.scoreId}` : "";
  const shareText = result ? `I scored ${result.score.toLocaleString("en-US")} in ${theme.game.title} $${theme.coin.ticker} 🕹️ Can you beat it?` : "";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
      <div>
        {/* Cabinet */}
        <div className="slab overflow-hidden p-2.5 sm:p-3" style={{ background: p.ink }}>
          <div className="mb-2.5 flex items-center justify-between gap-3 px-2 text-sm sm:text-base" style={{ color: BEZEL_TEXT }}>
            <span className="pixel" aria-label={`Score ${hud.score}`}>
              <span style={{ color: p.primary }}>SCORE</span> {hud.score.toLocaleString("en-US")}
            </span>
            <span className="pixel hidden sm:inline" style={{ color: p.accent }}>
              LV {hud.level + 1}
            </span>
            <span className="pixel" aria-label={`${hud.lives} lives`}>
              {"♥".repeat(Math.max(0, Math.min(hud.lives, 9)))}
              <span className="opacity-30">{hud.lives <= 0 ? "♥" : ""}</span>
            </span>
          </div>
          <div
            ref={wrapRef}
            tabIndex={0}
            role="application"
            aria-label={`${theme.game.title}. Move with mouse, touch or arrow keys. Space or click to launch and fire. P to pause, M to mute.`}
            className="crt relative touch-none select-none overflow-hidden rounded-[14px] outline-none focus-visible:ring-4"
            style={{ cursor: phase === "playing" ? "none" : "default", background: p.bg }}
          >
            <canvas ref={canvasRef} className="block aspect-[4/3] h-auto w-full" style={{ imageRendering: "pixelated" }} />

            {toast && phase === "playing" && (
              <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center" aria-hidden>
                <span className="pixel pop-in inline-block rounded-xl border-2 px-4 py-2 text-sm sm:text-lg" style={{ background: p.ink, color: p.primary, borderColor: p.primary }}>
                  {toast}
                </span>
              </div>
            )}

            {(phase === "title" || phase === "loading") && (
              <div className="absolute inset-0 grid place-items-center p-4 text-center" style={{ background: `${p.bg}d9`, color: p.text }}>
                <div className="pop-in grid justify-items-center">
                  <Mascot theme={theme} size={112} className="floaty" />
                  <p className="pixel mt-3 text-sm sm:text-base" style={{ color: p.primary }}>
                    ${theme.coin.ticker} PRESENTS
                  </p>
                  <h2 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-5xl">{theme.game.title}</h2>
                  <p className="mt-2 max-w-md opacity-85">{theme.game.tagline}</p>
                  <button className="btn mt-6 text-lg" style={{ background: p.primary }} onClick={start} disabled={phase === "loading"} autoFocus>
                    {phase === "loading" ? "Loading…" : "▶ Insert coin"}
                  </button>
                  <p className="mt-3 text-xs opacity-70">{wallet.address ? "Signed in: this run goes on the leaderboard." : "Playing as guest. Connect a wallet to rank."}</p>
                </div>
              </div>
            )}

            {phase === "paused" && (
              <div className="absolute inset-0 grid place-items-center" style={{ background: `${p.bg}cc`, color: p.text }}>
                <div className="grid justify-items-center gap-4">
                  <p className="pixel text-2xl">PAUSED</p>
                  <button className="btn" style={{ background: p.primary }} onClick={resume} autoFocus>
                    Resume
                  </button>
                </div>
              </div>
            )}

            {phase === "over" && result && (
              <div className="absolute inset-0 grid place-items-center overflow-y-auto p-4 text-center" style={{ background: `${p.bg}e6`, color: p.text }}>
                <div className="pop-in grid justify-items-center">
                  <Mascot theme={theme} mood={result.status === "won" ? "happy" : "sad"} size={80} />
                  <p className="pixel mt-2 text-sm" style={{ color: p.accent }}>
                    {result.status === "won" ? "ALL CLEAR" : "GAME OVER"}
                  </p>
                  <p className="text-5xl font-extrabold tabular-nums sm:text-7xl">{result.score.toLocaleString("en-US")}</p>
                  <p className="mt-1 opacity-80">{result.status === "won" ? theme.copy.won : pick(theme.copy.gameOver)}</p>
                  <button className="btn mt-5" style={{ background: p.primary }} onClick={start} autoFocus>
                    ↻ Play again
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-2 text-xs" style={{ color: `${BEZEL_TEXT}b3` }}>
            <span className="pixel">MOUSE / TOUCH / ← → · SPACE FIRE · P PAUSE</span>
            <button className="pixel rounded-full border px-2 py-0.5" style={{ borderColor: `${BEZEL_TEXT}55`, color: BEZEL_TEXT }} onClick={toggleMute} aria-pressed={muted}>
              {muted ? "SOUND OFF" : "SOUND ON"}
            </button>
          </div>
        </div>

        <div aria-live="polite" className="sr-only">
          {phase === "over" && result ? `Game over. Score ${result.score}. ${result.scoreId ? "Score verified." : ""}` : ""}
        </div>

        {/* Results / share */}
        {phase === "over" && result && (
          <section className="slab pop-in mt-6 p-5 sm:p-6" aria-label="Your run">
            {!result.scoreId && !result.error && !result.offline && <p className="font-semibold">Verifying your run on the server…</p>}
            {result.offline && <p className="font-semibold">Practice run (offline). Scores are saved when the server can be reached.</p>}
            {result.error && (
              <p role="alert" className="font-semibold text-hot">
                {result.error}
              </p>
            )}
            {result.scoreId && (
              <div className="grid gap-5 md:grid-cols-[1.4fr_1fr] md:items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/card/${result.scoreId}`} width={1200} height={630} alt={`Score card: ${result.score} points`} className="h-auto w-full rounded-2xl border-2 border-line" />
                <div>
                  <p className="chip">✓ Verified by server replay</p>
                  <p className="mt-3 text-lg font-bold">
                    {result.ranked ? (result.rank ? `Rank #${result.rank} on the $${theme.coin.ticker} board` : "On the board") : "Guest run: not on the leaderboard"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
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
                    <a className="btn btn-sm btn-plain" href={`/api/card/${result.scoreId}?download=1`}>
                      Download card
                    </a>
                  </div>
                  {!result.ranked && (
                    <div className="mt-4">
                      <p className="mb-2 text-sm text-soft">Sign in with a wallet to put your next run on the leaderboard.</p>
                      <WalletButton compact />
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Side panel */}
      <aside className="grid content-start gap-4">
        <div className="slab grid justify-items-center p-4 text-center" style={{ background: p.bg2, color: p.text }}>
          <Mascot theme={theme} mood={mood} size={120} label={`${theme.mascot.name} looks ${mood === "idle" ? "ready" : mood}`} />
          <p className="pixel mt-2 text-sm" style={{ color: p.primary }}>
            {theme.mascot.name.toUpperCase()}
          </p>
          <p className="text-sm opacity-80">{hud.levelTitle || "Ready"}</p>
        </div>
        <div className="slab p-4">
          <p className="font-bold">Ranked runs</p>
          <p className="mt-1 text-sm text-soft">Sign a message with your wallet (no transaction) and your verified scores go on the board.</p>
          <div className="mt-3">
            <WalletButton compact />
          </div>
        </div>
        <Link href={`/leaderboard?coin=${theme.id}`} className="btn btn-plain">
          ${theme.coin.ticker} leaderboard →
        </Link>
        <p className="px-1 text-xs text-soft">${theme.coin.ticker} is a fictional demo coin. Scores are bragging rights only: no prizes, no token rewards.</p>
      </aside>
    </div>
  );
}
