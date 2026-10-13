"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { loadGame } from "@/games/client";
import { BTN, STEP_MS, type GameDef, type GameEngine, type GameMeta, type GameRenderer, type Hud, type Input } from "@/games/core/types";
import { encodeInputs } from "@/games/core/replay";
import type { ThemePack } from "@/themes/types";
import { Synth } from "@/game/audio";
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
export function GameHost({ meta, theme, title, practice = false }: { meta: GameMeta; theme: ThemePack; title: string; practice?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
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
    // Restoring a per-browser preference after mount keeps hydration consistent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const start = useCallback(async () => {
    const s = g.current;
    if (!s.def) return;
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
  }, [meta.id, practice, resume, setPhaseBoth, showToast, theme]);

  // Input wiring
  useEffect(() => {
    const s = g.current;
    const wrap = wrapRef.current!;
    const toField = (cx: number, cy: number) => {
      const r = canvasRef.current!.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(meta.field.w, Math.round(((cx - r.left) / r.width) * meta.field.w))),
        y: Math.max(0, Math.min(meta.field.h, Math.round(((cy - r.top) / r.height) * meta.field.h))),
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

  const toggleMute = () => {
    const n = !muted;
    setMuted(n);
    g.current.synth?.setMuted(n);
    try {
      localStorage.setItem("gp_muted", n ? "1" : "0");
    } catch {}
  };

  const p = theme.palette;
  const portrait = meta.field.h > meta.field.w;
  const shareUrl = result?.scoreId ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${result.scoreId}` : "";
  const shareText = result ? `I scored ${result.score.toLocaleString("en-US")} in ${title} $${theme.coin.ticker} 🕹️ Can you beat it?` : "";

  return (
    <div className={practice ? "grid gap-6" : "grid gap-6 lg:grid-cols-[1fr_17rem]"}>
      <div className="min-w-0">
        <div className={`slab mx-auto overflow-hidden p-2.5 sm:p-3 ${portrait ? "max-w-[30rem]" : ""}`} style={{ background: p.ink }}>
          <div className="mb-2.5 flex items-center justify-between gap-3 px-2 text-sm sm:text-base" style={{ color: BEZEL_TEXT }}>
            <span className="pixel" aria-label={`Score ${hud.score}`}>
              <span style={{ color: p.primary }}>SCORE</span> {hud.score.toLocaleString("en-US")}
            </span>
            {hud.level !== undefined && (
              <span className="pixel hidden sm:inline" style={{ color: p.accent }}>
                LV {hud.level}
              </span>
            )}
            {hud.lives !== undefined ? (
              <span className="pixel" aria-label={`${hud.lives} lives`}>
                {"♥".repeat(Math.max(0, Math.min(hud.lives, 9)))}
              </span>
            ) : (
              <span className="pixel truncate text-xs opacity-80">{hud.label}</span>
            )}
          </div>
          <div
            ref={wrapRef}
            tabIndex={0}
            role="application"
            aria-label={`${title}. ${meta.controls} P to pause, M to mute.`}
            className="crt relative mx-auto touch-none select-none overflow-hidden rounded-[14px] outline-none"
            style={{ cursor: phase === "playing" && meta.input.pointer ? "crosshair" : "default", background: p.bg, aspectRatio: `${meta.field.w} / ${meta.field.h}`, maxHeight: portrait ? "72vh" : undefined }}
          >
            <canvas ref={canvasRef} className="block h-full w-full" style={{ imageRendering: "pixelated" }} />

            {toast && phase === "playing" && (
              <div className="pointer-events-none absolute inset-x-0 top-[36%] px-3 text-center" aria-hidden>
                <span className="pixel pop-in inline-block rounded-xl border-2 px-4 py-2 text-sm sm:text-lg" style={{ background: p.ink, color: p.primary, borderColor: p.primary }}>
                  {toast}
                </span>
              </div>
            )}

            {(phase === "loading" || phase === "title" || phase === "starting") && (
              <div className="absolute inset-0 grid place-items-center overflow-y-auto p-4 text-center" style={{ background: `${p.bg}d9`, color: p.text }}>
                <div className="pop-in grid justify-items-center">
                  <Mascot theme={theme} size={portrait ? 96 : 104} className="floaty" />
                  <p className="pixel mt-3 text-xs sm:text-sm" style={{ color: p.primary }}>
                    ${theme.coin.ticker} PRESENTS
                  </p>
                  <h2 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-5xl">{title}</h2>
                  <p className="mt-2 max-w-md text-sm opacity-85 sm:text-base">{meta.tagline}</p>
                  <button className="btn mt-5 text-lg" style={{ background: p.primary }} onClick={start} disabled={phase !== "title"} autoFocus>
                    {phase === "title" ? "▶ Insert coin" : "Loading…"}
                  </button>
                  <p className="mt-3 text-xs opacity-70">{meta.controls}</p>
                  {!practice && <p className="mt-1 text-xs opacity-60">{wallet.address ? "Signed in: this run goes on the leaderboard." : "Playing as guest. Connect a wallet to rank."}</p>}
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
                  <Mascot theme={theme} mood={result.status === "won" ? "happy" : "sad"} size={76} />
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
            <span className="pixel truncate">{meta.controls.toUpperCase()}</span>
            <button className="pixel rounded-full border px-2 py-0.5" style={{ borderColor: `${BEZEL_TEXT}55`, color: BEZEL_TEXT }} onClick={toggleMute} aria-pressed={muted}>
              {muted ? "SOUND OFF" : "SOUND ON"}
            </button>
          </div>
        </div>

        <div aria-live="polite" className="sr-only">
          {phase === "over" && result ? `Game over. Score ${result.score}. ${result.scoreId ? "Score verified." : ""}` : ""}
        </div>

        {phase === "over" && result && (
          <section className="slab pop-in mt-6 p-5 sm:p-6" aria-label="Your run">
            {!result.scoreId && !result.error && !result.offline && <p className="font-semibold">Verifying your run on the server…</p>}
            {result.offline && <p className="font-semibold">{practice ? "Preview run. Scores and leaderboards switch on when this skin goes live." : "Practice run (offline). Scores are saved when the server can be reached."}</p>}
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
                    {result.ranked ? (result.rank ? `Rank #${result.rank} on the $${theme.coin.ticker} ${meta.name} board` : "On the board") : "Guest run: not on the leaderboard"}
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

      {!practice && <aside className="grid content-start gap-4">
        <div className="slab grid justify-items-center p-4 text-center" style={{ background: p.bg2, color: p.text }}>
          <Mascot theme={theme} mood={mood} size={120} label={`${theme.mascot.name} looks ${mood === "idle" ? "ready" : mood}`} />
          <p className="pixel mt-2 text-sm" style={{ color: p.primary }}>
            {theme.mascot.name.toUpperCase()}
          </p>
          <p className="text-sm opacity-80">{hud.label || "Ready"}</p>
        </div>
        <div className="slab p-4">
          <p className="font-bold">Ranked runs</p>
          <p className="mt-1 text-sm text-soft">Sign a message with your wallet (no transaction) and your verified scores go on the board.</p>
          <div className="mt-3">
            <WalletButton compact />
          </div>
        </div>
        <Link href={`/leaderboard?game=${meta.id}&coin=${theme.id}`} className="btn btn-plain">
          ${theme.coin.ticker} {meta.name} board →
        </Link>
        <p className="px-1 text-xs text-soft">
          {meta.credits.basedOn === "Original" ? "An ArcadePad original." : `Based on ${meta.credits.basedOn} (${meta.credits.licence}).`} {theme.coin.fictional ? `$${theme.coin.ticker} is a fictional demo coin. ` : ""}Scores are bragging rights only: no prizes, no token rewards.
        </p>
      </aside>}
    </div>
  );
}
