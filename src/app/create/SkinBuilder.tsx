"use client";
import { useEffect, useId, useMemo, useState } from "react";
import type { GameMeta } from "@/games/core/types";
import { THEMES } from "@/themes";
import { SOUND_STYLES, buildTheme, dominantColors, pixelateImage, sanitizeTickerInput, type SkinInput, type SoundStyle } from "@/themes/build";
import { gridToSvg } from "@/themes/pixel";
import { GameHost } from "@/components/GameHost";

const STARTERS = THEMES.map((t) => ({ id: t.id, label: t.mascot.name, grid: t.mascot.idle, pixels: t.pixels }));

const DEFAULT: SkinInput = {
  name: "Moon Otter",
  ticker: "OTTER",
  chain: "solana",
  mascot: { grid: STARTERS[0].grid, pixels: STARTERS[0].pixels },
  colors: { bg: "#1B1446", primary: "#7CF0C8", secondary: "#FF7AB6", accent: "#FFD166" },
  dark: true,
  sound: "squishy",
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SkinBuilder({ games }: { games: GameMeta[] }) {
  const id = useId();
  const [input, setInput] = useState<SkinInput>(DEFAULT);
  const [gameId, setGameId] = useState(games[0]?.id ?? "breakout");
  const [imgError, setImgError] = useState<string | null>(null);
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [rights, setRights] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  const debounced = useDebounced(input, 450);
  const theme = useMemo(() => buildTheme(debounced), [debounced]);
  const themeKey = useMemo(() => JSON.stringify(debounced).length + ":" + debounced.colors.primary + debounced.colors.bg + debounced.ticker + debounced.name + debounced.sound + debounced.dark + debounced.mascot.grid.join(""), [debounced]);
  const meta = games.find((g) => g.id === gameId) ?? games[0];
  const set = <K extends keyof SkinInput>(k: K, v: SkinInput[K]) => setInput((p) => ({ ...p, [k]: v }));
  const setColor = (k: keyof SkinInput["colors"], v: string) => setInput((p) => ({ ...p, colors: { ...p.colors, [k]: v } }));

  async function onFile(f: File | undefined) {
    setImgError(null);
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type) || f.size > 8_000_000) {
      setImgError("Use a PNG, JPG, WebP or GIF under 8 MB.");
      return;
    }
    try {
      const m = await pixelateImage(f);
      setInput((p) => ({ ...p, mascot: m }));
    } catch {
      setImgError("Couldn't read that image.");
    }
  }

  function matchMascot() {
    const c = dominantColors(input.mascot);
    if (c.length) setInput((p) => ({ ...p, colors: { ...p.colors, primary: c[0], secondary: c[1] ?? p.colors.secondary, accent: c[2] ?? p.colors.accent } }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setMsg("");
    try {
      const t = buildTheme(input);
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coinName: t.coin.name,
          ticker: t.coin.ticker,
          chain: t.coin.chain,
          game: "All games (self-serve skin)",
          mascot: "Pixel mascot attached (built in the skin builder)",
          colors: `${input.colors.primary}, ${input.colors.secondary}, ${input.colors.accent} on ${input.colors.bg}`,
          contact,
          notes,
          rightsConfirmed: rights,
          skin: JSON.stringify(t),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not send.");
      setState("sent");
      setMsg(`Skin ${d.id} received. We'll get back to you on ${contact}.`);
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : "Could not send.");
    }
  }

  const L = (htmlFor: string, text: string, hint?: string) => (
    <label htmlFor={`${id}-${htmlFor}`} className="block font-semibold">
      {text}
      {hint && <span className="ml-1 font-normal text-soft">{hint}</span>}
    </label>
  );

  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[22rem_1fr]">
      <div className="grid content-start gap-5">
        <section className="slab grid gap-4 p-5">
          <h2 className="text-xl font-extrabold">1. Your coin</h2>
          <div className="grid gap-1.5">
            {L("name", "Name")}
            <input id={`${id}-name`} className="field" maxLength={24} value={input.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              {L("ticker", "Ticker")}
              <input id={`${id}-ticker`} className="field uppercase" maxLength={7} value={input.ticker} onChange={(e) => set("ticker", sanitizeTickerInput(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              {L("chain", "Chain")}
              <select id={`${id}-chain`} className="field" value={input.chain} onChange={(e) => set("chain", e.target.value as SkinInput["chain"])}>
                <option value="solana">Solana</option>
                <option value="base">Base</option>
                <option value="ethereum">Ethereum</option>
              </select>
            </div>
          </div>
        </section>

        <section className="slab grid gap-4 p-5">
          <h2 className="text-xl font-extrabold">2. Your mascot</h2>
          <div className="flex items-center gap-4">
            <span
              className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl border-2 border-line [&>svg]:h-20 [&>svg]:w-20"
              style={{ background: input.dark ? input.colors.bg : "#fff6e9", imageRendering: "pixelated" }}
              role="img"
              aria-label="Your pixel mascot"
              dangerouslySetInnerHTML={{ __html: gridToSvg(input.mascot.grid, input.mascot.pixels) }}
            />
            <div className="grid gap-2 text-sm">
              <label className="btn btn-sun btn-sm cursor-pointer">
                Upload image
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <span className="text-soft">Square art on a plain or transparent background works best.</span>
            </div>
          </div>
          {imgError && (
            <p role="alert" className="text-sm font-semibold text-hot">
              {imgError}
            </p>
          )}
          <div className="flex flex-wrap gap-2" aria-label="Starter mascots">
            {STARTERS.map((s) => (
              <button key={s.id} type="button" className="chip" onClick={() => set("mascot", { grid: s.grid, pixels: s.pixels })}>
                Use {s.label}
              </button>
            ))}
          </div>
        </section>

        <section className="slab grid gap-4 p-5">
          <h2 className="text-xl font-extrabold">3. Colours &amp; sound</h2>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["bg", "Background"],
                ["primary", "Primary"],
                ["secondary", "Secondary"],
                ["accent", "Accent"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 font-semibold">
                <input type="color" value={input.colors[k]} onChange={(e) => setColor(k, e.target.value)} className="h-10 w-12 cursor-pointer rounded-lg border-2 border-line bg-transparent" />
                {label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-plain btn-sm" onClick={matchMascot}>
              Match my mascot
            </button>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={input.dark} onChange={(e) => set("dark", e.target.checked)} className="h-4 w-4 accent-[var(--grape)]" />
              Dark style
            </label>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 font-semibold">Sound style</legend>
            {(Object.keys(SOUND_STYLES) as SoundStyle[]).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="radio" name={`${id}-sound`} checked={input.sound === k} onChange={() => set("sound", k)} className="accent-[var(--grape)]" />
                {SOUND_STYLES[k].label}
              </label>
            ))}
          </fieldset>
        </section>
      </div>

      <div className="grid min-w-0 content-start gap-5">
        <nav aria-label="Preview game" className="flex flex-wrap gap-2">
          {games.map((g) => (
            <button key={g.id} type="button" onClick={() => setGameId(g.id)} aria-pressed={g.id === gameId} className={`chip !text-[0.7rem] ${g.id === gameId ? "!bg-sun !text-[#1a1033]" : ""}`}>
              {g.name}
            </button>
          ))}
        </nav>
        <GameHost key={`${meta.id}-${themeKey}`} meta={meta} theme={theme} title={`${theme.coin.name} ${meta.name}`} practice />

        <form onSubmit={submit} className="slab grid gap-4 p-5 sm:p-6">
          <h2 className="text-xl font-extrabold">4. Put it live</h2>
          <p className="text-soft">We check the skin, turn on leaderboards for it and send you your coin&apos;s arcade link. Nothing is charged here.</p>
          <div className="grid gap-1.5">
            {L("contact", "How do we reach you?", "(Telegram, X or email)")}
            <input id={`${id}-contact`} className="field" required maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@yourhandle" />
          </div>
          <div className="grid gap-1.5">
            {L("notes", "Anything else?", "(links, which games matter most)")}
            <textarea id={`${id}-notes`} className="field min-h-20" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--grape)]" checked={rights} onChange={(e) => setRights(e.target.checked)} required />
            <span>I own this coin&apos;s mascot and branding, or have written permission to use them, and I understand scores can&apos;t be tied to prizes or token rewards.</span>
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <button className="btn btn-hot" disabled={state === "sending" || state === "sent"}>
              {state === "sending" ? "Sending…" : state === "sent" ? "Sent ✓" : "Send my skin"}
            </button>
            <p role="status" className={`font-semibold ${state === "error" ? "text-hot" : ""}`}>
              {msg}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
