"use client";
import { useEffect, useRef, useState } from "react";

/** Counts up to `to` once, when scrolled into view (easeOutCubic). */
export function CountUp({ to, decimals = 0, suffix = "", duration = 1500, delay = 480 }: { to: number; decimals?: number; suffix?: string; duration?: number; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(to);
  useEffect(() => {
    const el = ref.current!;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start from zero once mounted (server renders the final value)
    setV(0);
    let raf = 0;
    let timer = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        timer = window.setTimeout(() => {
          const t0 = performance.now();
          const tick = (t: number) => {
            const k = Math.min(1, (t - t0) / duration);
            setV(to * (1 - Math.pow(1 - k, 3)));
            if (k < 1) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        }, delay);
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [to, duration, delay]);
  return (
    <span ref={ref} className="tabular-nums">
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}
