"use client";
import { useState } from "react";

/** Copy-link and report controls for a launched arcade. */
export function ArcadeActions({ slug, ticker }: { slug: string; ticker: string }) {
  const [copied, setCopied] = useState(false);
  const [report, setReport] = useState<"idle" | "confirm" | "sent" | "error">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/a/${slug}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  const send = async () => {
    try {
      const r = await fetch(`/api/arcades/${slug}/report`, { method: "POST" });
      setReport(r.ok ? "sent" : "error");
    } catch {
      setReport("error");
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <button type="button" className="btn btn-plain" onClick={copy}>
        {copied ? "Link copied ✓" : `Share $${ticker} arcade`}
      </button>
      {report === "idle" && (
        <button type="button" className="text-sm font-medium text-dim underline-offset-4 hover:text-white hover:underline" onClick={() => setReport("confirm")}>
          Report this arcade
        </button>
      )}
      {report === "confirm" && (
        <span className="flex items-center gap-2 text-sm">
          <span className="text-soft">Report as abusive, impersonation or a scam?</span>
          <button type="button" className="btn btn-hot btn-sm" onClick={send}>
            Report
          </button>
          <button type="button" className="text-dim hover:text-white" onClick={() => setReport("idle")}>
            Cancel
          </button>
        </span>
      )}
      {report === "sent" && <span className="text-sm font-medium text-mint">Thanks. We&apos;ll take a look.</span>}
      {report === "error" && <span className="text-sm font-medium text-hot">Couldn&apos;t send the report. Try again later.</span>}
    </div>
  );
}
