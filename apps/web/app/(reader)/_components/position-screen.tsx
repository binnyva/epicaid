"use client";
/**
 * Position screen: pick the last finished Chapter of the current Book, from the Chapter list
 * or by Quote Search. Phone shows one at a time behind a segmented control; desktop shows both.
 */
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { chapterName, groupByPart, groupNote, type PickerChapter } from "@/lib/chapters";
import { savePosition } from "../actions";
import { ChevronDown } from "./icons";

interface Props {
  bookTitle: string;
  bookFinished: boolean;
  chapters: PickerChapter[];
  saved: number | null;
  side: ReactNode;
}

export function PositionScreen({ bookTitle, bookFinished, chapters, saved, side }: Props) {
  const [selected, setSelected] = useState<number | null>(saved);
  const [mode, setMode] = useState<"chapters" | "quote">("chapters");
  const groups = useMemo(() => groupByPart(chapters), [chapters]);
  const selectedChapter = chapters.find((c) => c.index === selected) ?? null;
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => {
    const holding = groups.find((g) => g.chapters.some((c) => c.index === saved)) ?? groups[0];
    return new Set(holding ? [holding.key] : []);
  });
  const toggle = (key: string) =>
    setOpenKeys((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const pick = (index: number) => {
    setSelected(index);
    const g = groups.find((x) => x.chapters.some((c) => c.index === index));
    if (g) setOpenKeys((s) => new Set(s).add(g.key));
    setMode("chapters");
  };

  const label = selectedChapter ? `Save · finished ${selectedChapter.label}` : "Save · no Chapter finished yet";
  const unchanged = selected === saved;

  return (
    <form action={savePosition} className="screen position">
      <input type="hidden" name="chapter" value={selected ?? ""} />
      <div className="position-head">
        <div className="stack-2">
          <h1 className="screen-title">Position</h1>
          <span className="secondary book-line">
            {bookTitle} · <Link href="/position/book">Change Book</Link>
          </span>
        </div>
        <span className="desktop-only">
          <SaveButton label={label} disabled={unchanged} />
        </span>
      </div>

      {bookFinished && (
        <p className="notice">
          This Book is in your Finished Books, so all of it is already shown. Pick the next Book with Change Book.
        </p>
      )}

      <div className="segmented phone-only" role="tablist" aria-label="Find your place">
        <button type="button" role="tab" aria-selected={mode === "chapters"} onClick={() => setMode("chapters")}>
          By Chapter
        </button>
        <button type="button" role="tab" aria-selected={mode === "quote"} onClick={() => setMode("quote")}>
          By a quote
        </button>
      </div>

      <div className="two-col">
        <div className={`stack-10 ${mode === "chapters" ? "" : "phone-hidden"}`}>
          <div className="card">
            <label className={`chapter-row none-row ${selected === null ? "is-selected" : ""}`}>
              <input type="radio" name="pick" checked={selected === null} onChange={() => setSelected(null)} />
              <span>No Chapter finished yet</span>
            </label>
          </div>
          {groups.map((g) => {
            const open = openKeys.has(g.key);
            return (
              <div key={g.key} className="card part">
                <button type="button" className="part-head" aria-expanded={open} onClick={() => toggle(g.key)}>
                  <span className="stack-2">
                    <span className="list-name strong">{g.name}</span>
                    <span className="secondary">{groupNote(g, saved)}</span>
                  </span>
                  <span className={open ? "chev chev-open" : "chev"}>
                    <ChevronDown />
                  </span>
                </button>
                {open && (
                  <div className="chapter-list" role="radiogroup" aria-label={g.name}>
                    {g.chapters.map((c) => {
                      const isSel = c.index === selected;
                      const after = selected !== null && c.index > selected;
                      return (
                        <label
                          key={c.index}
                          className={`chapter-row ${isSel ? "is-selected" : ""} ${after ? "is-after" : ""}`}
                        >
                          <input type="radio" name="pick" checked={isSel} onChange={() => setSelected(c.index)} />
                          <span>{chapterName(c)}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className={`stack-12 side ${mode === "quote" ? "" : "phone-hidden"}`}>
          <QuoteCard onPick={pick} />
          <div className="desktop-only">{side}</div>
        </div>
      </div>

      <div className="phone-only sticky-save">
        <SaveButton label={label} disabled={unchanged} />
      </div>
    </form>
  );
}

function SaveButton({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button button-primary button-block" disabled={disabled || pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}

interface Hit {
  index: number;
  label: string;
  title: string | null;
}

function QuoteCard({ onPick }: { onPick: (index: number) => void }) {
  const [quote, setQuote] = useState("");
  const [state, setState] = useState<{ status: "idle" | "loading" | "error" } | { status: "done"; hits: Hit[] }>({
    status: "idle",
  });
  const words = quote.trim().split(/\s+/).filter(Boolean).length;

  useEffect(() => {
    if (words < 4) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/quote?${new URLSearchParams({ q: quote })}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const { chapters } = (await response.json()) as { chapters: Hit[] };
        setState({ status: "done", hits: chapters });
      } catch (error) {
        if ((error as Error).name !== "AbortError") setState({ status: "error" });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [quote, words]);

  return (
    <div className="card card-pad stack-10">
      <span className="card-title">Find it by a quote</span>
      <input
        className="field"
        type="search"
        placeholder="Type four or more words"
        aria-label="Find your place by a quote"
        value={quote}
        onChange={(e) => setQuote(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
      />
      <span className="secondary">Shows matching Chapters from this Book only, never the text.</span>
      {words > 0 && words < 4 && <span className="secondary">{4 - words} more word{4 - words === 1 ? "" : "s"}…</span>}
      {state.status === "loading" && <span className="secondary">Looking…</span>}
      {state.status === "error" && <span className="secondary">Quote Search failed. Try again in a moment.</span>}
      {state.status === "done" &&
        (state.hits.length ? (
          <div className="quote-hits">
            {state.hits.map((h) => (
              <button key={h.index} type="button" className="quote-hit" onClick={() => onPick(h.index)}>
                <span className="list-name">{h.label}</span>
                {h.title && h.title !== h.label && <span className="secondary">{h.title}</span>}
                <span className="pick">Pick</span>
              </button>
            ))}
          </div>
        ) : (
          <span className="list-name">No match in this Book</span>
        ))}
    </div>
  );
}
