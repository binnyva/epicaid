"use client";
/**
 * The Look up field. Results come from /api/lookup, which only searches names inside the
 * Reader's Spoiler Boundary; anything else gives the same "No match" as a typo.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { SearchIcon } from "./icons";

interface Result {
  ref: string;
  name: string;
  kind: string;
  matched: string | null;
}

const KINDS = [
  { value: "", label: "All" },
  { value: "character", label: "Characters" },
  { value: "place", label: "Places" },
  { value: "faction", label: "Factions" },
  { value: "artefact", label: "Artefacts" },
];
const KIND_LABEL: Record<string, string> = {
  character: "Character",
  place: "Place",
  artefact: "Artefact",
  faction: "Faction",
  other: "Other",
};

type State = { status: "idle" } | { status: "loading"; results: Result[] } | { status: "done"; results: Result[] } | { status: "error" };

export function LookupSearch() {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // Enter pressed while a search is still running opens the first result once it arrives,
  // never a stale result from the previous query.
  const enterPending = useRef(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ status: "loading", results: "results" in s ? s.results : [] }));
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, kind });
        const response = await fetch(`/api/lookup?${params}`, { signal: controller.signal });
        if (response.status === 401) {
          router.push("/sign-in");
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const { results } = (await response.json()) as { results: Result[] };
        setState({ status: "done", results });
        setActive(0);
        if (enterPending.current) {
          enterPending.current = false;
          if (results[0]) {
            setOpen(false);
            router.push(`/subject/${results[0].ref}`);
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") setState({ status: "error" });
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, kind, router]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const results = state.status === "done" || state.status === "loading" ? state.results : [];
  const go = (r: Result | undefined) => {
    if (!r) return;
    setOpen(false);
    router.push(`/subject/${r.ref}`);
  };
  const showDropdown = open && state.status !== "idle";

  return (
    <div className="lookup" ref={wrap}>
      <label className="search">
        <SearchIcon size={20} />
        <input
          type="search"
          placeholder="Who or what?"
          aria-label="Look up a name"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listId}
          aria-activedescendant={showDropdown && results[active] ? `${listId}-${active}` : undefined}
          value={query}
          onChange={(e) => {
            enterPending.current = false;
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (state.status === "done") go(results[active]);
              else if (state.status === "loading") enterPending.current = true;
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {state.status === "loading" && <span className="spinner" aria-label="Searching" />}
      </label>

      {showDropdown && (
        <div className={`dropdown card ${state.status === "loading" ? "is-stale" : ""}`} role="listbox" id={listId} aria-label="Matches">
          {state.status === "error" ? (
            <div className="dropdown-empty">Search failed. Try again in a moment.</div>
          ) : results.length ? (
            results.map((r, i) => (
              <a
                key={r.ref}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                href={`/subject/${r.ref}`}
                className="result"
                onMouseEnter={() => setActive(i)}
                onClick={(e) => {
                  e.preventDefault();
                  go(r);
                }}
              >
                <span className="av" aria-hidden="true">
                  {r.name.charAt(0).toUpperCase()}
                </span>
                <span className="stack-2 grow">
                  <span className="list-name">{r.name}</span>
                  <span className="secondary">
                    {KIND_LABEL[r.kind] ?? "Other"}
                    {r.matched ? ` · also called ${r.matched}` : ""}
                  </span>
                </span>
                {i === active && <span className="enter-hint desktop-only">Enter</span>}
              </a>
            ))
          ) : state.status === "done" ? (
            <div className="dropdown-empty">
              <span className="list-name">No match</span>
              <span className="secondary">Check the spelling, or try another name they go by.</span>
            </div>
          ) : (
            <div className="dropdown-empty secondary">Searching…</div>
          )}
          <div className="dropdown-foot">Only names from the Chapters you have read are searched.</div>
        </div>
      )}

      <div className="chips" role="group" aria-label="Kind">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            className={kind === k.value ? "chip chip-on" : "chip chip-off"}
            aria-pressed={kind === k.value}
            onClick={() => setKind(k.value)}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
