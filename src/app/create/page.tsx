import type { Metadata } from "next";
import { GAMES, gameMeta } from "@/games/registry";
import { SkinBuilder } from "./SkinBuilder";

export const metadata: Metadata = {
  title: "Launchpad",
  description: "Launch your coin's arcade instantly: upload your mascot, pick colours and sounds, and go live with every game and its own leaderboards.",
};

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
      <p className="kicker">Instant launch · free</p>
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5rem)] leading-[0.98]">
        Launchpad
        <br />
        <span className="neon-text">live in two minutes.</span>
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-soft">
        Drop in your mascot, pick colours and a sound style, and test every game in your coin&apos;s skin right here. Your image is turned into pixel art in your browser. When it looks
        right, hit Launch: your arcade is live at once with all {GAMES.length} games and its own leaderboards.
      </p>
      <SkinBuilder games={GAMES.map(gameMeta)} />
    </div>
  );
}
