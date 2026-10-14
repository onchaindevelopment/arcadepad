
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
      <span className={`sign chrome leading-none ${size === "lg" ? "text-[1.6rem]" : "text-[1.25rem]"}`}>ArcadePad</span>
    </span>
  );
}

/** Lit coin badge for the header. */
export function LogoBadge({ size = 46 }: { size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-full transition-transform duration-300 hover:rotate-[-8deg] hover:scale-[1.06]"
      style={{ width: size, height: size, background: "radial-gradient(circle at 35% 30%, #3a1a72, #12062a)", boxShadow: "0 0 0 2px #ffd23d, 0 0 0 5px rgba(255,210,61,0.18), 0 0 22px rgba(255,210,61,0.45)" }}
    >
      <LogoMark size={Math.round(size * 0.66)} />
    </span>
  );
}
