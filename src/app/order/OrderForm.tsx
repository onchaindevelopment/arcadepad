"use client";
import { useEffect, useId, useState } from "react";

const EMPTY = { coinName: "", ticker: "", chain: "Solana", contract: "", game: "Breakout (ported from LBreakout2)", mascot: "", colors: "", links: "", contact: "", timeline: "No rush", notes: "", website: "" };
type Form = typeof EMPTY;
const DRAFT_KEY = "gp_order_draft";
const SENT_KEY = "gp_orders_sent";

function load<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export function OrderForm() {
  const [f, setF] = useState<Form>(EMPTY);
  const [rights, setRights] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState<{ id: string; coin: string; at: number }[]>([]);
  const id = useId();

  useEffect(() => {
    // Restore the draft after mount (localStorage isn't available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setF({ ...EMPTY, ...load<Partial<Form>>(DRAFT_KEY, {}) });
    setSent(load(SENT_KEY, []));
  }, []);

  function set<K extends keyof Form>(k: K, v: string) {
    const next = { ...f, [k]: v };
    setF(next);
    save(DRAFT_KEY, next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setMsg("");
    try {
      const r = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, ticker: f.ticker.replace(/^\$/, "").toUpperCase(), rightsConfirmed: rights }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not send.");
      const list = [{ id: d.id, coin: f.coinName, at: Date.now() }, ...sent].slice(0, 10);
      setSent(list);
      save(SENT_KEY, list);
      save(DRAFT_KEY, {});
      setF(EMPTY);
      setRights(false);
      setState("sent");
      setMsg(`Request ${d.id} received. We'll get back to you on the contact you left.`);
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : "Could not send.");
    }
  }

  const L = (k: keyof Form, label: string, hint?: string) => (
    <label htmlFor={`${id}-${k}`} className="block font-semibold">
      {label}
      {hint && <span className="ml-1 font-normal text-soft">{hint}</span>}
    </label>
  );

  return (
    <form onSubmit={submit} className="slab grid gap-5 p-5 sm:p-7" aria-describedby={`${id}-status`}>
      <h2 className="text-2xl font-extrabold">Tell us about your coin</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          {L("coinName", "Coin name")}
          <input id={`${id}-coinName`} className="field" required maxLength={60} value={f.coinName} onChange={(e) => set("coinName", e.target.value)} placeholder="Moon Otter" />
        </div>
        <div className="grid gap-1.5">
          {L("ticker", "Ticker")}
          <input id={`${id}-ticker`} className="field uppercase" required maxLength={12} value={f.ticker} onChange={(e) => set("ticker", e.target.value)} placeholder="$OTTER" />
        </div>
        <div className="grid gap-1.5">
          {L("chain", "Chain")}
          <select id={`${id}-chain`} className="field" value={f.chain} onChange={(e) => set("chain", e.target.value)}>
            {["Solana", "Base", "Ethereum", "Other"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          {L("contract", "Contract address", "(optional)")}
          <input id={`${id}-contract`} className="field font-mono text-sm" maxLength={100} value={f.contract} onChange={(e) => set("contract", e.target.value)} placeholder="Leave empty if not launched" />
        </div>
      </div>
      <div className="grid gap-1.5">
        {L("game", "Which game?")}
        <select id={`${id}-game`} className="field" value={f.game} onChange={(e) => set("game", e.target.value)}>
          <option>Breakout (ported from LBreakout2)</option>
          <option>Something else from the open-source catalogue (tell us in notes)</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        {L("mascot", "Your mascot", "(describe it, personality, signature moves)")}
        <textarea id={`${id}-mascot`} className="field min-h-24" maxLength={1000} value={f.mascot} onChange={(e) => set("mascot", e.target.value)} placeholder="A sleepy otter in a space helmet who loves clams" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          {L("colors", "Brand colours")}
          <input id={`${id}-colors`} className="field" maxLength={200} value={f.colors} onChange={(e) => set("colors", e.target.value)} placeholder="#5B8CFF, cream, hot pink" />
        </div>
        <div className="grid gap-1.5">
          {L("timeline", "Timeline")}
          <select id={`${id}-timeline`} className="field" value={f.timeline} onChange={(e) => set("timeline", e.target.value)}>
            {["No rush", "Within a month", "Within two weeks", "ASAP"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-1.5">
        {L("links", "Links", "(site, X, Telegram, art files)")}
        <textarea id={`${id}-links`} className="field min-h-20" maxLength={600} value={f.links} onChange={(e) => set("links", e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        {L("contact", "How do we reach you?", "(Telegram, X or email)")}
        <input id={`${id}-contact`} className="field" required maxLength={120} value={f.contact} onChange={(e) => set("contact", e.target.value)} placeholder="@yourhandle" />
      </div>
      <div className="grid gap-1.5">
        {L("notes", "Anything else?")}
        <textarea id={`${id}-notes`} className="field min-h-20" maxLength={2000} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      <div className="hidden" aria-hidden>
        <label>
          Website <input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website", e.target.value)} />
        </label>
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--grape)]" checked={rights} onChange={(e) => setRights(e.target.checked)} required />
        <span>I own this coin&apos;s mascot and branding, or have written permission to use them, and I understand scores can&apos;t be tied to prizes or token rewards.</span>
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <button className="btn btn-hot" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send request"}
        </button>
        <p id={`${id}-status`} role="status" className={`font-semibold ${state === "error" ? "text-hot" : ""}`}>
          {msg}
        </p>
      </div>
      {sent.length > 0 && (
        <div className="rounded-2xl border-2 border-dashed border-line p-4">
          <p className="pixel text-xs uppercase text-soft">Your requests (this browser)</p>
          <ul className="mt-2 grid gap-1 text-sm">
            {sent.map((s) => (
              <li key={s.id}>
                <span className="font-mono">{s.id}</span> · {s.coin} · {new Date(s.at).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-sm text-soft">We store what you type here to answer your request, and nothing else. See Fair play &amp; privacy.</p>
    </form>
  );
}
