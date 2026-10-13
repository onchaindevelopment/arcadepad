"use client";
// Browser side of wallet sign-in. Uses injected wallets directly (no SDKs):
// Solana (Phantom, Solflare, Backpack...) via window.solana-style providers,
// EVM (MetaMask, Rabby, Coinbase...) via window.ethereum. Message signing only.
import { base58 } from "@scure/base";

export type WalletKind = "phantom" | "solflare" | "backpack" | "evm" | "dev";

interface SolanaProvider {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(msg: Uint8Array, enc?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
  publicKey?: { toString(): string };
}
interface EvmProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

type W = Window & {
  phantom?: { solana?: SolanaProvider };
  solana?: SolanaProvider;
  solflare?: SolanaProvider;
  backpack?: { solana?: SolanaProvider };
  ethereum?: EvmProvider;
};

export interface WalletOption {
  kind: WalletKind;
  label: string;
  chain: "solana" | "evm";
}

export function availableWallets(): WalletOption[] {
  const w = window as W;
  const out: WalletOption[] = [];
  if (w.phantom?.solana || w.solana?.isPhantom) out.push({ kind: "phantom", label: "Phantom", chain: "solana" });
  if (w.solflare) out.push({ kind: "solflare", label: "Solflare", chain: "solana" });
  if (w.backpack?.solana) out.push({ kind: "backpack", label: "Backpack", chain: "solana" });
  if (w.ethereum) out.push({ kind: "evm", label: "Ethereum / Base wallet", chain: "evm" });
  if (process.env.NODE_ENV !== "production") out.push({ kind: "dev", label: "Dev test wallet (local only)", chain: "solana" });
  return out;
}

function solProvider(kind: WalletKind): SolanaProvider | undefined {
  const w = window as W;
  if (kind === "phantom") return w.phantom?.solana ?? w.solana;
  if (kind === "solflare") return w.solflare;
  if (kind === "backpack") return w.backpack?.solana;
}

async function devWallet() {
  const { ed25519 } = await import("@noble/curves/ed25519.js");
  let sk: Uint8Array;
  const saved = sessionStorage.getItem("gp_dev_wallet");
  if (saved) sk = base58.decode(saved);
  else {
    sk = ed25519.utils.randomSecretKey();
    sessionStorage.setItem("gp_dev_wallet", base58.encode(sk));
  }
  return {
    address: base58.encode(ed25519.getPublicKey(sk)),
    sign: async (m: string) => base58.encode(ed25519.sign(new TextEncoder().encode(m), sk)),
  };
}

async function connect(kind: WalletKind): Promise<{ address: string; chain: "solana" | "evm"; sign: (m: string) => Promise<string> }> {
  if (kind === "dev") return { chain: "solana", ...(await devWallet()) };
  if (kind === "evm") {
    const eth = (window as W).ethereum;
    if (!eth) throw new Error("No Ethereum wallet found.");
    const [address] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    return {
      address,
      chain: "evm",
      sign: async (m) => {
        const hex = "0x" + Array.from(new TextEncoder().encode(m), (b) => b.toString(16).padStart(2, "0")).join("");
        return (await eth.request({ method: "personal_sign", params: [hex, address] })) as string;
      },
    };
  }
  const p = solProvider(kind);
  if (!p) throw new Error("Wallet not found.");
  const res = await p.connect();
  const address = (res?.publicKey ?? p.publicKey)!.toString();
  return {
    address,
    chain: "solana",
    sign: async (m) => {
      const out = await p.signMessage(new TextEncoder().encode(m), "utf8");
      const sig = out instanceof Uint8Array ? out : out.signature;
      return base58.encode(sig);
    },
  };
}

/** Full sign-in: connect, fetch the server-written message, sign it, verify. */
export async function signIn(kind: WalletKind): Promise<{ address: string; chain: string }> {
  const wallet = await connect(kind);
  const nonceRes = await fetch("/api/auth/nonce", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chain: wallet.chain, address: wallet.address }),
  });
  const n = await nonceRes.json();
  if (!nonceRes.ok) throw new Error(n.error ?? "Could not start sign-in.");
  const signature = await wallet.sign(n.message);
  const v = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: n.token, signature }),
  });
  const out = await v.json();
  if (!v.ok) throw new Error(out.error ?? "Sign-in failed.");
  return out;
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" });
}

export function shortAddr(a: string | null | undefined) {
  if (!a) return "";
  return a.startsWith("0x") ? `${a.slice(0, 6)}…${a.slice(-4)}` : `${a.slice(0, 4)}…${a.slice(-4)}`;
}
