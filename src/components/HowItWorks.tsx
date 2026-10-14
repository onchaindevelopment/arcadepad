"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { THEMES } from "@/themes";
import { GameThumb } from "./GameThumb";
import { MascotStatic } from "./Mascot";

const STEP_MS = 6000;
const glorp = THEMES[0];
const P = glorp.palette;

const STEPS = [
  { title: "Pick a game", caption: "Choose from the arcade: classics, originals, quick one-tap games.", color: "var(--sky)" },
  { title: "Drop in your mascot", caption: "Upload your art. It becomes pixel art with your palette and ticker.", color: "var(--hot)" },
  { title: "Play in your colours", caption: "Every game wears your skin: mascot, colours, sounds and music.", color: "var(--sun)" },
  { title: "Server checks the run", caption: "The server replays every run from its inputs. Cheated scores don't count.", color: "var(--mint)" },
  { title: "Share the score", caption: "Each run gets a score card and a link. Your community does the rest.", color: "var(--orange)" },
];

/** Pixel arrow cursor. */
function Cursor({ className = "" }: { className?: string }) {
  const rows = ["#.......", "##......", "#o#.....", "#oo#....", "#ooo#...", "#oooo#..", "#oo###..", "##.#o#..", "#..#o#..", "....##.."];
  return (
    <svg viewBox="0 0 8 10" width={22} height={28} shapeRendering="crispEdges" className={`hiw-cursor absolute z-20 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)] ${className}`} aria-hidden>
      {rows.flatMap((r, y) => r.split("").map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={c === "#" ? "#0b0320" : "#fff"} />)))}
    </svg>
  );
}

function PickScene() {
  const tiles = [
    ["Breakout", "#ff2e88"],
    ["Moon Pinball", "#2ee6ff"],
    ["Snake", "#3dffb0"],
    ["Block Drop", "#ffd23d"],
    ["Maze Dash", "#8b5cff"],
    ["Star Swarm", "#ff7a1a"],
  ];
  return (
    <div className="relative mx-auto grid h-full w-full max-w-[460px] grid-cols-3 content-center gap-2.5 sm:gap-3">
      {tiles.map(([name, c], i) => (
        <div
          key={name}
          className={`hiw-tile relative grid aspect-[4/3] place-items-end overflow-hidden rounded-xl p-2 ${i === 1 ? "hiw-picked" : ""}`}
          style={{ background: `linear-gradient(160deg, ${c}, ${c}55 60%, #0b0320)`, animationDelay: `${i * 0.08}s` }}
        >
          <span className="pixel text-[0.72rem] uppercase leading-tight text-white drop-shadow sm:text-[0.72rem]">{name}</span>
          {i === 1 && <span className="hiw-badge sign absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sun px-2 py-0.5 text-[0.72rem] text-ink">Selected</span>}
        </div>
      ))}
      <Cursor className="hiw-cursor-pick" />
    </div>
  );
}

function SkinScene() {
  const swatches = [P.primary, P.secondary, P.accent, ...(P.bricks ?? []).slice(0, 2)];
  return (
    <div className="flex h-full items-center justify-center gap-4 sm:gap-8">
      <div className="relative grid h-28 w-28 place-items-center rounded-2xl border-2 border-dashed border-white/40 sm:h-36 sm:w-36">
        <span className="hiw-blurry absolute">
          <MascotStatic theme={glorp} size={88} className="blur-[6px]" />
        </span>
        <span className="hiw-crisp absolute">
          <MascotStatic theme={glorp} size={88} />
        </span>
        <span className="pixel absolute -bottom-6 text-[0.72rem] uppercase tracking-widest text-dim">mascot.png</span>
      </div>
      <span className="sign text-2xl text-sun">→</span>
      <div>
        <div className="flex gap-1.5">
          {swatches.map((c, i) => (
            <span key={i} className="hiw-swatch h-7 w-7 rounded-md border border-black/40 sm:h-9 sm:w-9" style={{ background: c, animationDelay: `${0.9 + i * 0.15}s` }} />
          ))}
        </div>
        <p className="sign mt-4 text-2xl sm:text-3xl" style={{ color: P.primary }}>
          <span className="hiw-type inline-block overflow-hidden whitespace-nowrap align-bottom">${glorp.coin.ticker}</span>
          <span className="blink">_</span>
        </p>
        <p className="pixel mt-1 text-[0.72rem] uppercase tracking-widest text-dim">ticker · palette · sounds</p>
      </div>
    </div>
  );
}

function PlayScene() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative aspect-[4/3] h-full max-h-[260px] overflow-hidden rounded-xl" style={{ background: P.bg, boxShadow: `0 0 40px -10px ${P.primary}` }}>
        <GameThumb gameId="breakout" theme={glorp} label="Breakout in the GLORP skin" />
        <span className="pixel absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[0.72rem] uppercase" style={{ color: P.primary }}>
          ${glorp.coin.ticker} breakout
        </span>
      </div>
    </div>
  );
}

function VerifyScene() {
  const lines = ["> run received · 3,421 inputs", "> seed issued by server: 4242", "> replaying on the same engine…"];
  return (
    <div className="relative mx-auto flex h-full max-w-[460px] flex-col justify-center font-mono text-[0.72rem] sm:text-[0.82rem]">
      {lines.map((l, i) => (
        <p key={l} className="hiw-line text-mint/90" style={{ animationDelay: `${0.2 + i * 0.6}s` }}>
          {l}
        </p>
      ))}
      <div className="hiw-line mt-3 h-3 overflow-hidden rounded-full border border-mint/50" style={{ animationDelay: "1.9s" }}>
        <div className="hiw-bar h-full bg-mint" style={{ animationDelay: "2s" }} />
      </div>
      <p className="hiw-line mt-3 text-base font-bold text-white sm:text-lg" style={{ animationDelay: "3.3s" }}>
        ✓ Score 12,400 verified
      </p>
      <span className="hiw-stamp sign absolute right-0 top-1/2 rounded-lg border-4 border-mint px-3 py-1 text-xl text-mint sm:text-2xl">Verified</span>
    </div>
  );
}

function ShareScene() {
  return (
    <div className="relative flex h-full items-center justify-center gap-5">
      <div className="hiw-card relative w-[min(260px,62%)] rounded-2xl p-4" style={{ background: `linear-gradient(160deg, ${P.bg2}, ${P.bg})`, boxShadow: `0 0 0 2px ${P.primary}, 0 20px 40px -12px rgba(0,0,0,0.7)` }}>
        <div className="flex items-center gap-3">
          <MascotStatic theme={glorp} size={52} />
          <div>
            <p className="pixel text-[0.72rem] uppercase" style={{ color: P.primary }}>
              ${glorp.coin.ticker} · breakout
            </p>
            <p className="sign text-3xl leading-none text-white">12,400</p>
          </div>
        </div>
        <p className="pixel mt-3 text-[0.72rem] uppercase tracking-widest text-white/60">replay-verified · rank #1</p>
      </div>
      <div className="relative flex flex-col gap-2">
        <span className="hiw-press btn btn-sm">Post on X</span>
        <span className="btn btn-plain btn-sm">Copy link</span>
        <Cursor className="hiw-cursor-share" />
      </div>
      <span className="hiw-toast sign absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-mint px-3 py-1 text-[0.7rem] text-ink">Link copied!</span>
    </div>
  );
}

const SCENES = [PickScene, SkinScene, PlayScene, VerifyScene, ShareScene];

/** "How it works" as an arcade cabinet whose screen plays a five-step walkthrough. */
export function HowItWorks() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduce, setReduce] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const visible = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the user's motion preference once
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting), { threshold: 0.3 });
    io.observe(boxRef.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (paused || reduce) return;
    const t = window.setTimeout(() => {
      if (visible.current && !document.hidden) setI((n) => (n + 1) % STEPS.length);
      else setI((n) => n); // re-arm
    }, STEP_MS);
    return () => window.clearTimeout(t);
  }, [i, paused, reduce]);

  const go = useCallback((d: number) => setI((n) => (n + d + STEPS.length) % STEPS.length), []);
  const step = STEPS[i];
  const Scene = SCENES[i];

  return (
    <div ref={boxRef} className="relative mx-auto max-w-[900px]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* Cabinet */}
      <div className="relative border-2 border-white bg-black p-3 shadow-[6px_6px_0_rgba(255,210,61,0.9)] sm:p-4">
        {/* Side art stripes */}

        {/* Marquee */}
        <div className="relative mb-3 overflow-hidden px-6 py-3 text-center" style={{ background: "#fff" }}>
          <div className="bulbs" aria-hidden />
          <p className="sign no-shadow text-lg text-ink sm:text-2xl">How it works</p>
        </div>

        {/* Screen */}
        <div className="crt relative overflow-hidden border-2 border-white/20 bg-[#070707] px-4 pb-4 pt-4 sm:px-7 sm:pt-6">
          <div className="flex items-start justify-between gap-3">
            <p className="sign no-shadow text-3xl leading-none sm:text-5xl" style={{ color: step.color }}>
              0{i + 1}
              <span className="text-base text-white/40 sm:text-xl">/0{STEPS.length}</span>
            </p>
            <p className="pixel text-right text-[0.72rem] uppercase tracking-[0.18em] text-white/50">
              Step {i + 1} of {STEPS.length}
            </p>
          </div>
          <h3 key={`t${i}`} className="hiw-title sign mt-3 text-center text-2xl text-white sm:text-4xl" style={{ textShadow: `3px 3px 0 ${step.color}` }}>
            {step.title}
          </h3>
          <div key={`s${i}`} className="mt-4 h-[200px] sm:h-[260px]">
            <Scene />
          </div>
          <p className="mt-4 text-center text-sm text-soft sm:text-base">{step.caption}</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div key={`p${i}-${paused}`} className="h-full rounded-full" style={{ background: step.color, animation: paused || reduce ? "none" : `hiw-progress ${STEP_MS}ms linear forwards`, width: paused || reduce ? "100%" : undefined }} />
          </div>
        </div>

        {/* Control panel */}
        <div className="mt-3 flex items-center justify-between gap-3 border-2 border-white/20 px-4 py-3">
          <button type="button" className="btn btn-plain btn-sm" onClick={() => go(-1)} aria-label="Previous step">
            ◀ Back
          </button>
          <div className="flex items-center gap-2" role="tablist" aria-label="Steps">
            {STEPS.map((s, k) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                aria-selected={k === i}
                aria-label={`Step ${k + 1}: ${s.title}`}
                onClick={() => setI(k)}
                className="h-4 w-4 rounded-full border-2 border-black/50 transition-transform hover:scale-110"
                style={{ background: k === i ? s.color : "#3a1a72", boxShadow: k === i ? `0 0 12px ${s.color}` : "none" }}
              />
            ))}
          </div>
          <button type="button" className="btn btn-hot btn-sm" onClick={() => go(1)} aria-label="Next step">
            Next ▶
          </button>
        </div>
      </div>
    </div>
  );
}
