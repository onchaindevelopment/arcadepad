import { notFound } from "next/navigation";
import { Suspense } from "react";
import { QaGrid } from "./QaGrid";

// Dev-only visual QA: every game fast-forwarded by its bot, in every skin.
export default function QaPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <QaGrid />
    </Suspense>
  );
}
