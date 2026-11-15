/** Small shared pieces of the Pocket design. */
import Link from "next/link";
import type { ReadingContext } from "@/lib/reading";
import { positionHeadline, positionProgress } from "@/lib/reading";

export const KIND_LABEL: Record<string, string> = {
  character: "Character",
  place: "Place",
  artefact: "Artefact",
  faction: "Faction",
  other: "Other",
};

export function Avatar({ name, large }: { name: string; large?: boolean }) {
  const initial = name.replace(/^(the|a|an)\s+/i, "").trim().charAt(0).toUpperCase() || "?";
  return (
    <span className={large ? "av av-lg" : "av"} aria-hidden="true">
      {initial}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress" aria-hidden="true">
      <div style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

/** The Reader's position: a card on Look up (phone) and at the foot of the rail (desktop). */
export function PositionCard({ ctx, compact }: { ctx: ReadingContext; compact?: boolean }) {
  const book = ctx.currentBook?.title ?? ctx.series.name;
  const headline = positionHeadline(ctx);
  if (compact) {
    return (
      <Link href="/position" className="card rail-position">
        <span className="secondary">{book}</span>
        <span className="strong">{headline}</span>
        <ProgressBar value={positionProgress(ctx)} />
      </Link>
    );
  }
  return (
    <div className="card position-card">
      <div className="position-row">
        <div className="stack-2">
          <span className="secondary">{book}</span>
          <span className="card-title">{headline}</span>
        </div>
        <Link href="/position" className="chip chip-soft">
          Change
        </Link>
      </div>
      <ProgressBar value={positionProgress(ctx)} />
    </div>
  );
}
