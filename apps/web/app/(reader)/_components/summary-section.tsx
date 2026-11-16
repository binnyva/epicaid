"use client";
/**
 * The Summary on the Subject page. A cached Summary arrives with the page. On a miss this asks /api/summary to
 * write one, showing its progress lines, and only shows sentences that passed the citation check. Every
 * sentence ends in citation chips that open the source they came from.
 */
import type { SummaryEntry } from "@epicaid/db";
import { useActionState, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { reportSpoiler, type ReportState } from "../actions";
import { basisSentence, ERROR_TEXT, type SummaryErrorCode, type SummaryStreamLine } from "@/lib/summary-text";

type State =
  | { status: "ready"; entry: SummaryEntry }
  | { status: "loading"; progress: string }
  | { status: "error"; code: SummaryErrorCode };

export function SummarySection({
  targetRef,
  initial,
  positionNote,
  side,
}: {
  targetRef: string;
  initial: SummaryEntry | null;
  /** "Nothing after Chapter Six of Gardens of the Moon was read." */
  positionNote: string;
  /** The Recent card, shown under "About this Summary" on desktop. */
  side?: ReactNode;
}) {
  const [state, setState] = useState<State>(
    initial ? { status: "ready", entry: initial } : { status: "loading", progress: "Looking through what you've read…" },
  );
  const started = useRef(false);

  const write = useCallback(async () => {
    setState({ status: "loading", progress: "Looking through what you've read…" });
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: targetRef }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const line = JSON.parse(raw) as SummaryStreamLine;
          if (line.type === "progress") setState({ status: "loading", progress: line.text });
          if (line.type === "summary") {
            finished = true;
            setState({ status: "ready", entry: line.entry });
          }
          if (line.type === "error") {
            finished = true;
            setState({ status: "error", code: line.code });
          }
        }
        if (done) break;
      }
      if (!finished) setState({ status: "error", code: "llm" });
    } catch {
      setState({ status: "error", code: "llm" });
    }
  }, [targetRef]);

  useEffect(() => {
    if (initial || started.current) return;
    started.current = true;
    void write();
  }, [initial, write]);

  const entry = state.status === "ready" ? state.entry : null;

  return (
    <div className="two-col">
      <div className="stack-12">
        <section className="card card-pad summary-card" aria-labelledby="summary-title" aria-busy={state.status === "loading"}>
          <h2 id="summary-title" className="sr-only">
            Summary
          </h2>
          {state.status === "loading" && <SummaryLoading text={state.progress} />}
          {state.status === "error" && <SummaryProblem code={state.code} onRetry={write} />}
          {entry && <SummaryBody entry={entry} />}
        </section>
        {entry && <Sources entry={entry} />}
        <div className="phone-only stack-12">
          <AboutText entry={entry} positionNote={positionNote} />
          {entry && <ReportButton targetRef={targetRef} />}
        </div>
      </div>
      <div className="desktop-block stack-12">
        <aside className="card card-pad stack-8" aria-labelledby="about-summary">
          <span id="about-summary" className="card-title">
            About this Summary
          </span>
          <AboutText entry={entry} positionNote={positionNote} />
          {entry && <ReportButton targetRef={targetRef} />}
        </aside>
        {side}
      </div>
    </div>
  );
}

function SummaryLoading({ text }: { text: string }) {
  return (
    <div className="stack-12" role="status">
      <div className="row-8">
        <span className="spinner" aria-hidden="true" />
        <span className="secondary">{text}</span>
      </div>
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line short" />
    </div>
  );
}

function SummaryProblem({ code, onRetry }: { code: SummaryErrorCode; onRetry: () => void }) {
  const text = ERROR_TEXT[code] ?? ERROR_TEXT.llm;
  return (
    <div className="stack-8">
      <span className="card-title">{text.title}</span>
      <p className="body-text">{text.body}</p>
      {text.retry && (
        <div>
          <button type="button" className="button button-quiet" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function openSource(n: number) {
  const el = document.getElementById(`source-${n}`);
  if (el instanceof HTMLDetailsElement) el.open = true;
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function SummaryBody({ entry }: { entry: SummaryEntry }) {
  const chipFor = new Map(entry.sources.map((s) => [s.n, s]));
  return (
    <div className="summary-text">
      {entry.paragraphs.map((paragraph, i) => (
        <p key={i}>
          {paragraph.map((sentence, j) => {
            // One chip per distinct label: "Ch 1 Ch 1" reads badly.
            const seen = new Set<string>();
            const chips = sentence.sources.flatMap((n) => {
              const source = chipFor.get(n);
              if (!source || seen.has(source.chip)) return [];
              seen.add(source.chip);
              return [source];
            });
            return (
              <span key={j}>
                {sentence.text}{" "}
                {chips.map((s) => (
                  <a
                    key={s.n}
                    href={`#source-${s.n}`}
                    className="cite"
                    title={s.heading}
                    onClick={(e) => {
                      e.preventDefault();
                      openSource(s.n);
                    }}
                  >
                    {s.chip}
                  </a>
                ))}{" "}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

function Sources({ entry }: { entry: SummaryEntry }) {
  return (
    <section className="card sources" aria-labelledby="sources-title">
      <span id="sources-title" className="section-label pad-x">
        Sources
      </span>
      {entry.sources.map((s) => (
        <details key={s.n} id={`source-${s.n}`} className="source">
          <summary>
            <span className="cite">{s.chip}</span>
            <span>{s.kind === "book-summary" ? "Summary of the whole Book" : s.heading}</span>
          </summary>
          <p className="source-text">{s.text}</p>
        </details>
      ))}
    </section>
  );
}

function AboutText({ entry, positionNote }: { entry: SummaryEntry | null; positionNote: string }) {
  return (
    <p className="secondary">
      {entry ? `${basisSentence(entry)} ` : "Built only from the Chapters you have read. "}
      {positionNote}
    </p>
  );
}

function ReportButton({ targetRef }: { targetRef: string }) {
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ReportState, FormData>(reportSpoiler, { status: "idle" });
  if (state.status === "sent") {
    return <p className="notice">Thanks. The report is with the admin, who can have this Summary written again.</p>;
  }
  if (!open) {
    return (
      <button type="button" className="button button-quiet button-block-soft" onClick={() => setOpen(true)}>
        Report a spoiler
      </button>
    );
  }
  return (
    <form action={action} className="stack-8">
      <input type="hidden" name="ref" value={targetRef} />
      <label className="secondary" htmlFor={noteId}>
        What gave something away? (optional)
      </label>
      <textarea id={noteId} name="note" className="field" rows={3} maxLength={2000} />
      {state.status === "error" && <p className="notice notice-error">That didn't go through. Try again.</p>}
      <div className="row-8">
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending ? "Sending…" : "Send report"}
        </button>
        <button type="button" className="button button-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
