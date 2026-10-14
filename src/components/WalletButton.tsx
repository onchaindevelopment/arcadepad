"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { availableWallets, shortAddr, signIn, signOut, type WalletOption } from "@/lib/wallet-client";

export interface WalletState {
  address: string | null;
  chain: string | null;
}

// Shared state across buttons on the page via a tiny event bus.
const EVT = "gp-wallet";
export function useWallet(): [WalletState, (s: WalletState) => void] {
  const [state, setState] = useState<WalletState>({ address: null, chain: null });
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => alive && setState({ address: d.address ?? null, chain: d.chain ?? null }))
      .catch(() => {});
    const on = (e: Event) => setState((e as CustomEvent<WalletState>).detail);
    window.addEventListener(EVT, on);
    return () => {
      alive = false;
      window.removeEventListener(EVT, on);
    };
  }, []);
  const set = useCallback((s: WalletState) => window.dispatchEvent(new CustomEvent(EVT, { detail: s })), []);
  return [state, set];
}

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const [wallet, setWallet] = useWallet();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<WalletOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function pick(o: WalletOption) {
    setBusy(true);
    setError(null);
    try {
      const r = await signIn(o.kind);
      setWallet({ address: r.address, chain: r.chain });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in cancelled.");
    } finally {
      setBusy(false);
    }
  }

  if (wallet.address) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="chip hidden sm:inline-flex" title={wallet.address}>
          <span className="h-2 w-2 rounded-full bg-mint" aria-hidden /> {shortAddr(wallet.address)}
        </span>
        <button
          className="btn btn-plain btn-sm"
          onClick={async () => {
            await signOut();
            setWallet({ address: null, chain: null });
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button className={compact ? "btn btn-plain h-full !px-5" : "btn"} aria-expanded={open} aria-haspopup="dialog" onClick={() => {
          if (!open) setOptions(availableWallets());
          setOpen(!open);
        }}>
        Connect wallet
      </button>
      {open && (
        <div role="dialog" aria-label="Sign in with a wallet" className="slab pop-in absolute right-0 z-40 mt-3 w-[min(22rem,calc(100vw-2rem))] p-4 text-left">
          <p className="font-bold">Sign in to post scores</p>
          <p className="mt-1 text-sm text-soft">You sign one message to prove the wallet is yours. No transaction, no fees, no approvals.</p>
          <ul className="mt-3 grid gap-2">
            {options.map((o) => (
              <li key={o.kind}>
                <button className="btn btn-plain w-full justify-between" disabled={busy} onClick={() => pick(o)}>
                  <span>{o.label}</span>
                  <span className="chip">{o.chain === "evm" ? "EVM" : "SOL"}</span>
                </button>
              </li>
            ))}
          </ul>
          {options.length === 0 && (
            <p className="mt-3 text-sm">
              No wallet found in this browser. On a phone, open this page inside your wallet app&apos;s browser (Phantom, Solflare, MetaMask, Coinbase Wallet).
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-hot">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
