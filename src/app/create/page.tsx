import type { Metadata } from "next";
import { GAMES, gameMeta } from "@/games/registry";
import { SkinBuilder } from "./SkinBuilder";

export const metadata: Metadata = {
  title: "Launch your arcade",
  description: "Upload your mascot, pick your colours and sounds, and play every ArcadePad game in your coin's skin, live in your browser.",
};

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
      <p className="kicker">Launchpad</p>
      <h1 className="mt-4 text-[clamp(2.4rem,6vw,4.4rem)] font-semibold leading-[0.98] tracking-[-0.04em]">
        Launch your arcade
        <br />
        <span className="neon-text">in two minutes.</span>
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-soft">
        Drop in your mascot, pick colours and a sound style, and play every game in your coin&apos;s skin right here. Your image is turned into pixel art in your browser and is never uploaded.
        When it looks right, send it to us and we&apos;ll put it live.
      </p>
      <SkinBuilder games={GAMES.map(gameMeta)} />
    </div>
  );
}
