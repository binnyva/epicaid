"use client";
import { useOptimistic, useTransition, type ReactNode } from "react";
import { setFinished } from "../actions";

/** One Finished Book checkbox; saves as soon as it is ticked. */
export function FinishedToggle({ bookId, finished, children }: { bookId: string; finished: boolean; children: ReactNode }) {
  const [optimistic, setOptimistic] = useOptimistic(finished);
  const [, start] = useTransition();
  return (
    <label className="check-row">
      <span className="stack-2 grow">{children}</span>
      <input
        type="checkbox"
        checked={optimistic}
        onChange={(e) => {
          const next = e.target.checked;
          start(async () => {
            setOptimistic(next);
            const form = new FormData();
            form.set("bookId", bookId);
            form.set("finished", next ? "1" : "0");
            await setFinished(form);
          });
        }}
      />
    </label>
  );
}
