#!/usr/bin/env python3
"""
Extract an EPUB into the folder layout that Ingestion reads (see ADR 0002).

    python3 apps/cli/scripts/extract_epub.py "<book folder>/<file>.epub"

Writes, next to the EPUB:

    extracted/
      book.json          metadata and the Chapter list; edit `kind` by hand if a guess is wrong
      html/NNN-slug.html one cleaned HTML file per table-of-contents entry, in reading order

Every TOC entry gets a `kind`:
  front   - before the story starts (acknowledgements, dramatis personae, epigraphs). Not ingested.
  chapter - story text, including prologues, part openers and epilogues. These become Chapters.
  back    - after the story ends (glossaries, afterwords, appendices). Not ingested; they spoil.

Uses only the Python standard library.
"""
import html
import json
import posixpath
import re
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote

STORY_START = re.compile(r"^(prologue|chapter\b|book\s+\w+|part\s+\w+|\d+\b)", re.I)
STORY_END = re.compile(r"^(epilogue|chapter\b|book\s+\w+|part\s+\w+|\d+\b)", re.I)
KEEP_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "i", "em", "b", "strong", "br", "blockquote", "hr", "span", "div", "sup", "sub"}
VOID_TAGS = {"br", "hr"}
NUMBER_WORDS = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
                "seventeen eighteen nineteen twenty").split()


class Cleaner(HTMLParser):
    """Keeps text and simple formatting; drops images, links, anchors, classes and styles."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.in_body, self.skip = [], False, 0

    def handle_starttag(self, tag, attrs):
        if tag == "body":
            self.in_body = True
        elif tag in ("script", "style"):
            self.skip += 1
        elif self.in_body and not self.skip and tag in KEEP_TAGS:
            self.out.append(f"<{tag}>" if tag not in VOID_TAGS else f"<{tag}/>")

    def handle_startendtag(self, tag, attrs):
        if self.in_body and not self.skip and tag in VOID_TAGS:
            self.out.append(f"<{tag}/>")

    def handle_endtag(self, tag):
        if tag == "body":
            self.in_body = False
        elif tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        elif self.in_body and not self.skip and tag in KEEP_TAGS and tag not in VOID_TAGS:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if self.in_body and not self.skip:
            self.out.append(html.escape(data, quote=False))

    def result(self):
        text = "".join(self.out)
        text = re.sub(r"[ \t]*\n[ \t]*", " ", text)
        text = re.sub(r"<(p|div|span)>\s*(<br/>\s*)*</\1>", "", text)
        text = re.sub(r"(</(p|h\d|div|blockquote)>)\s*", r"\1\n", text)
        return text.strip() + "\n"


def clean_html(raw: str) -> str:
    cleaner = Cleaner()
    cleaner.feed(raw)
    return cleaner.result()


def unspace_small_caps(text: str) -> str:
    """Undoes small caps that converters split into a capital plus the rest: "P Rologue", "B OOK O NE" -> "Prologue", "BOOK ONE"."""
    words, out, i = text.split(" "), [], 0
    while i < len(words):
        w, nxt = words[i], words[i + 1] if i + 1 < len(words) else ""
        if re.fullmatch(r"[A-Z]", w) and (re.fullmatch(r"[A-Z]{2,}[’'S]*", nxt) or (w not in "AI" and re.fullmatch(r"[A-Z][a-z]+", nxt))):
            out.append(w + (nxt.lower() if nxt[1:2].islower() else nxt))
            i += 2
        else:
            out.append(w)
            i += 1
    return " ".join(out)


def nice_label(text: str) -> str:
    text = unspace_small_caps(re.sub(r"\s+", " ", text).strip())
    text = " ".join(w.title() if len(w) > 1 and w.isupper() else w for w in text.split(" "))
    text = re.sub(r"([’'])S\b", r"\1s", text)
    text = re.sub(r"\s*[–—-]\s*", " – ", text) if re.match(r"^(book|part)\b", text, re.I) else text
    return text


CHAPTER_HEADING = re.compile(r"<(h[1-4])>((?:(?!</\1>).)*?)</\1>", re.S)
CHAPTER_TEXT = re.compile(r"^(chapter\b|prologue$|epilogue$)", re.I)


def split_chapters(body: str, label: str):
    """
    Some EPUBs only list parts in the table of contents ("Book One"), with chapters as headings inside.
    Returns [(heading or None, html)]: the text before the first in-text chapter heading, then one piece per chapter.
    An entry that simply starts with its own heading comes back whole.
    """
    cuts = []
    for m in CHAPTER_HEADING.finditer(body):
        text = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if CHAPTER_TEXT.match(text):
            cuts.append((m.start(), text))
    if cuts and nice_label(cuts[0][1]).lower() == label.lower():
        cuts = cuts[1:]  # the entry's own title heading
    if cuts and len(cuts) == 1 and len(re.sub(r"<[^>]+>", " ", body[: cuts[0][0]]).split()) < 5:
        cuts = []  # one heading at the very top: the entry is that chapter
    if not cuts:
        return [(None, body)]
    pieces = [(None, body[: cuts[0][0]])]
    for (start, text), nxt in zip(cuts, [c[0] for c in cuts[1:]] + [len(body)]):
        pieces.append((text, body[start:nxt]))
    return pieces


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48] or "untitled"


def read_toc(z: zipfile.ZipFile, opf_dir: str, opf: str):
    """Returns [(label, href_without_fragment)] from toc.ncx (EPUB 2) or the nav document (EPUB 3)."""
    ncx = re.search(r'<item[^>]+media-type="application/x-dtbncx\+xml"[^>]*>', opf)
    nav = re.search(r'<item[^>]+properties="[^"]*\bnav\b[^"]*"[^>]*>', opf)
    entries = []
    if ncx:
        href = re.search(r'href="([^"]+)"', ncx.group(0)).group(1)
        doc = z.read(posixpath.join(opf_dir, unquote(href))).decode("utf-8", "replace")
        for m in re.finditer(r"<navLabel>\s*<text>(.*?)</text>\s*</navLabel>\s*<content src=\"([^\"]+)\"", doc, re.S):
            entries.append((html.unescape(m.group(1)), m.group(2)))
    elif nav:
        href = re.search(r'href="([^"]+)"', nav.group(0)).group(1)
        doc = z.read(posixpath.join(opf_dir, unquote(href))).decode("utf-8", "replace")
        toc = re.search(r'<nav[^>]*epub:type="toc".*?</nav>', doc, re.S)
        for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', toc.group(0) if toc else doc, re.S):
            entries.append((html.unescape(re.sub(r"<[^>]+>", "", m.group(2))), m.group(1)))
    return [(re.sub(r"\s+", " ", label).strip(), unquote(src.split("#")[0])) for label, src in entries]


def main(epub_path: str):
    epub = Path(epub_path).resolve()
    z = zipfile.ZipFile(epub)
    container = z.read("META-INF/container.xml").decode()
    opf_path = re.search(r'full-path="([^"]+)"', container).group(1)
    opf_dir = posixpath.dirname(opf_path)
    opf = z.read(opf_path).decode("utf-8", "replace")

    def meta(tag):
        m = re.search(rf"<dc:{tag}[^>]*>(.*?)</dc:{tag}>", opf, re.S)
        return html.unescape(m.group(1).strip()) if m else None

    series = re.search(r'name="calibre:series" content="([^"]+)"', opf)
    series_index = re.search(r'name="calibre:series_index" content="([^"]+)"', opf)
    isbn = re.search(r'<dc:identifier[^>]*scheme="ISBN"[^>]*>([^<]+)<', opf)

    manifest = {m.group(2): unquote(m.group(1)) for m in re.finditer(r'<item[^>]*href="([^"]+)"[^>]*id="([^"]+)"', opf)}
    manifest.update({m.group(1): unquote(m.group(2)) for m in re.finditer(r'<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"', opf)})
    spine = [manifest[i] for i in re.findall(r'<itemref[^>]*idref="([^"]+)"', opf) if i in manifest]

    toc = [(label, href) for label, href in read_toc(z, opf_dir, opf) if href in spine]
    if not toc:
        sys.exit("No table of contents entries found; this EPUB needs a manual book.json.")

    # Each TOC entry owns its spine file plus any following files that have no TOC entry of their own.
    starts = [spine.index(href) for _, href in toc]
    for (label, _), a, b in zip(toc, starts, starts[1:]):
        if a == b:
            print(f"warning: '{label}' shares a file with the next entry; they are kept together", file=sys.stderr)

    toc = [(nice_label(label), href) for label, href in toc]
    labels = [label for label, _ in toc]
    first = next((i for i, l in enumerate(labels) if STORY_START.match(l)), 0)
    last = max((i for i, l in enumerate(labels) if STORY_END.match(l)), default=len(labels) - 1)

    out_dir = epub.parent / "extracted"
    html_dir = out_dir / "html"
    html_dir.mkdir(parents=True, exist_ok=True)

    entries, chapter_index, seen, file_no = [], 0, set(), 0
    for n, ((label, href), start) in enumerate(zip(toc, starts)):
        if start in seen:
            continue
        seen.add(start)
        end = next((s for s in starts[n + 1:] if s > start), len(spine))
        body = "".join(clean_html(z.read(posixpath.join(opf_dir, f)).decode("utf-8", "replace")) for f in spine[start:end])
        kind = "front" if n < first else "back" if n > last else "chapter"
        pieces = split_chapters(body, label) if kind == "chapter" else [(None, body)]
        if len(pieces) > 1:
            print(f"note: split '{label}' into {len(pieces) - 1} chapters found as headings inside it", file=sys.stderr)
        for heading, piece in pieces:
            piece_label = nice_label(heading) if heading else label
            words = len(re.sub(r"<[^>]+>", " ", piece).split())
            if heading is None and len(pieces) > 1 and words == 0:
                continue
            name = f"{file_no:03d}-{slug(piece_label)}.html"
            file_no += 1
            title = html.escape(piece_label)
            (html_dir / name).write_text(
                f'<!doctype html>\n<html><head><meta charset="utf-8"><title>{title}</title></head>\n<body>\n{piece}</body></html>\n',
                encoding="utf-8",
            )
            entry = {"file": f"html/{name}", "kind": kind, "label": piece_label, "title": None,
                     "sourceFiles": spine[start:end], "words": words}
            if kind == "chapter":
                entry["index"] = chapter_index
                chapter_index += 1
            entries.append(entry)

    book = {
        "title": meta("title"),
        "author": meta("creator"),
        "series": series.group(1) if series else None,
        "seriesIndex": float(series_index.group(1)) if series_index else None,
        "isbn": isbn.group(1).strip() if isbn else None,
        "sourceEpub": epub.name,
        "entries": entries,
    }
    (out_dir / "book.json").write_text(json.dumps(book, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for e in entries:
        print(f"{e['kind']:8} {str(e.get('index', '')):>3}  {e['label'][:40]:40} {e['words']:>7} words")
    print(f"\n{chapter_index} chapters, {sum(e['words'] for e in entries if e['kind'] == 'chapter'):,} words of story -> {out_dir}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
