// Server-side signature checks for wallet sign-in. Message signing only: no transactions.
import "server-only";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { verifyMessage, isAddress, getAddress } from "viem";

export type Chain = "solana" | "evm";

export function normalizeAddress(chain: Chain, address: string): string | null {
  if (chain === "evm") return isAddress(address) ? getAddress(address) : null;
  try {
    return base58.decode(address).length === 32 ? address : null;
  } catch {
    return null;
  }
}

export async function verifyWalletSignature(chain: Chain, address: string, message: string, signature: string): Promise<boolean> {
  try {
    if (chain === "evm") {
      return await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` });
    }
    const pub = base58.decode(address);
    const sig = base58.decode(signature);
    if (pub.length !== 32 || sig.length !== 64) return false;
    return ed25519.verify(sig, new TextEncoder().encode(message), pub);
  } catch {
    return false;
  }
}

export function signInMessage(p: { domain: string; address: string; chain: Chain; nonce: string; issuedAt: string; brand: string }): string {
  return [
    `${p.domain} wants you to sign in to ${p.brand} with your ${p.chain === "evm" ? "Ethereum" : "Solana"} account:`,
    p.address,
    "",
    "Sign in to post high scores. This is a signature only: no transaction, no fees, no token approvals.",
    "",
    `URI: https://${p.domain}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
  ].join("\n");
}
