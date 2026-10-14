
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

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size === "lg" ? 34 : 28} />
      <span className={`sign leading-none text-white ${size === "lg" ? "text-[1.8rem]" : "text-[1.45rem]"}`}>ARCADEPAD</span>
    </span>
  );
}

/** The gold coin mark, used in the header. */
export function LogoBadge({ size = 34 }: { size?: number }) {
  return (
    <span className="grid place-items-center transition-transform duration-200 group-hover:-rotate-12" style={{ width: size, height: size }}>
      <LogoMark size={size} />
    </span>
  );
}
