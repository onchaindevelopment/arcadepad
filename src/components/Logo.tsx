
// Pixel arcade token: a coin with an "A" on it.
const TOKEN = [
  "...kkkkkk...",
  ".kksssssskk.",
  ".ksyyyyyyyk.",
  "ksyyykkyyyyk",
  "ksyykyykyyyk",
  "ksyykyykyyyk",
  "ksyykkkkyyyk",
  "ksyykyykyyyk",
  "ksyykyykyyyk",
  ".kyyyyyyyyk.",
  ".kkyyyyyykk.",
  "...kkkkkk...",
];
const COLORS: Record<string, string> = { k: "#1a1033", s: "#fff3c2", y: "#ffc83d" };

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} shapeRendering="crispEdges" aria-hidden>
      {TOKEN.flatMap((row, y) =>
        row.split("").map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={COLORS[c]} />)),
      )}
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="drop-shadow-[0_0_12px_rgba(255,210,61,0.45)]">
        <LogoMark size={28} />
      </span>
      <span className="pixel text-[0.95rem] font-bold tracking-[0.12em]">
        ARCADE<span className="text-hot">PAD</span>
      </span>
    </span>
  );
}
