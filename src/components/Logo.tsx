
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
const COLORS: Record<string, string> = { k: "#111", s: "#fff3c2", y: "#ffc83d" };

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
      <LogoMark size={26} />
      <span className="display text-[1.35rem] leading-none tracking-[-0.02em]">ArcadePad</span>
    </span>
  );
}

/** Round white badge with the coin mark, used in the header. */
export function LogoBadge({ size = 46 }: { size?: number }) {
  return (
    <span className="grid place-items-center rounded-full bg-white shadow-[var(--soft-shadow)] transition-transform duration-300 hover:scale-[1.04]" style={{ width: size, height: size }}>
      <LogoMark size={Math.round(size * 0.62)} />
    </span>
  );
}
