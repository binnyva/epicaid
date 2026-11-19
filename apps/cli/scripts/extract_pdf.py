#!/usr/bin/env python3
"""
Extract a text-based PDF into the same folder layout as extract_epub.py, so Ingestion reads it unchanged.

    python3 apps/cli/scripts/extract_pdf.py "<book folder>/<file>.pdf"

Writes `extracted/book.json` and `extracted/html/NNN-slug.html` next to the PDF.

PDFs have no table of contents to trust, so the Book is split on headings: a centred line that reads
PROLOGUE, CHAPTER ONE (or 1), EPILOGUE, or BOOK/PART ONE (a part opener). Paragraphs are rebuilt from
the layout: an indented line starts a paragraph, a line that stops short of the right margin ends one,
and centred or right-aligned lines (epigraphs, attributions) stand alone. Italics are lost.

Needs poppler's `pdftotext` (macOS: brew install poppler). Scanned PDFs (images, no text) won't work.
Check `kind` in book.json afterwards, exactly as for an EPUB.
"""
import html
import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

STORY = re.compile(r"^(prologue|epilogue|chapter\s+[\w-]+|\d{1,3}|(book|part)\s+[\w-]+\b.*)$", re.I)
SECTION = re.compile(r"^(dramatis personae|contents|maps?$|glossary|afterword|appendix|appendices|about the author|also by|acknowledg|author'?s note)", re.I)
LINE = re.compile(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', re.S)
WORD = re.compile(r"<word[^>]*>(.*?)</word>", re.S)


def read_lines(pdf: Path):
    """Every text line in reading order as (x_min, x_max, text), with None between pages."""
    if not shutil.which("pdftotext"):
        sys.exit("pdftotext not found. Install poppler first (macOS: brew install poppler).")
    out = subprocess.run(["pdftotext", "-bbox-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    meta = {m.group(1): html.unescape(m.group(2)) for m in re.finditer(r'<meta name="(\w+)" content="([^"]*)"', out)}
    title = re.search(r"<title>(.*?)</title>", out, re.S)
    lines = []
    for page in out.split("<page ")[1:]:
        for m in LINE.finditer(page):
            text = " ".join(html.unescape(w) for w in WORD.findall(m.group(5))).strip()
            if text and not re.fullmatch(r"\d{1,4}", text):  # drop bare page numbers
                lines.append((float(m.group(1)), float(m.group(3)), text))
        lines.append(None)
    return (html.unescape(title.group(1)).strip() if title else pdf.stem), meta.get("Author"), lines


def layout(lines):
    """The body text's left edge, right edge and paragraph indent, from the most common positions."""
    real = [l for l in lines if l]
    if len(real) < 200:
        sys.exit("Hardly any text found; this PDF is probably scanned images and needs OCR first.")
    left = Counter(round(x) for x, _, _ in real).most_common(1)[0][0]
    right = Counter(round(x) for _, x, _ in real if x - left > 300).most_common(1)[0][0]
    indents = Counter(round(x) - left for x, _, _ in real if 5 <= round(x) - left <= 40)
    indent = indents.most_common(1)[0][0] if indents else 15
    return left, right, indent


def label_of(text: str) -> str:
    """'CHAPTER TWENTY-ONE' -> 'Chapter Twenty-One', 'BOOK ONE - VOW TO THE SUN' -> 'Book One – Vow To The Sun'."""
    text = re.sub(r"\s+", " ", text).strip()
    text = " ".join(w.title() if len(w) > 1 and w.isupper() else w for w in text.split(" "))
    text = re.sub(r"([’'])S\b", r"\1s", text)
    return re.sub(r"\s+[–—-]\s+", " – ", text)


def sections(lines, left, right, indent):
    """Splits the lines into [(heading, [paragraph, ...])]; heading is None for text before the first one."""
    width = right - left
    out = [(None, [])]
    para, alone_prev, short_prev = [], True, True

    def flush():
        nonlocal para
        if para:
            out[-1][1].append(join(para))
            para = []

    for line in lines:
        if line is None:
            continue  # a page break says nothing about paragraphs
        x0, x1, text = line
        rel = x0 - left
        centred = rel > width * 0.1 and abs((x0 + x1) / 2 - (left + right) / 2) < width * 0.05
        right_aligned = rel > width * 0.2 and abs(x1 - right) < 4
        if centred and (STORY.match(text) or SECTION.match(text)):
            flush()
            out.append((text, []))
            alone_prev = short_prev = True
            continue
        alone = centred or right_aligned or rel > indent + 8  # epigraph, attribution or verse line
        starts = alone or alone_prev or short_prev or abs(rel - indent) <= 4
        if starts:
            flush()
        para.append(text)
        alone_prev, short_prev = alone, x1 < right - width * 0.06
    flush()
    return [s for s in out if s[0] is not None or s[1]]


def join(lines):
    text = lines[0]
    for nxt in lines[1:]:
        # Keep line-end hyphens (nearly always real compounds in typeset novels) and unspaced em dashes.
        text += nxt if text.endswith(("-", "—")) else " " + nxt
    return text


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48] or "untitled"


def main(pdf_path: str):
    pdf = Path(pdf_path).resolve()
    title, author, lines = read_lines(pdf)
    left, right, indent = layout(lines)
    parts = sections(lines, left, right, indent)

    story = [i for i, (h, _) in enumerate(parts) if h and STORY.match(h)]
    if not story:
        sys.exit("No PROLOGUE / CHAPTER / BOOK headings found on their own centred lines; this PDF needs a manual book.json.")
    first, last = story[0], story[-1]

    out_dir = pdf.parent / "extracted"
    html_dir = out_dir / "html"
    html_dir.mkdir(parents=True, exist_ok=True)

    entries, chapter_index = [], 0
    for n, (heading, paras) in enumerate(parts):
        label = label_of(heading) if heading else "Front Matter"
        kind = "front" if n < first else "back" if n > last else "chapter"
        if kind == "chapter" and re.match(r"^(book|part)\b", label, re.I):
            kind = "part"
        body = "".join(f"<p>{html.escape(p, quote=False)}</p>\n" for p in paras)
        if heading:
            body = f"<h2>{html.escape(heading, quote=False)}</h2>\n" + body
        name = f"{n:03d}-{slug(label)}.html"
        (html_dir / name).write_text(
            f'<!doctype html>\n<html><head><meta charset="utf-8"><title>{html.escape(label)}</title></head>\n<body>\n{body}</body></html>\n',
            encoding="utf-8",
        )
        entry = {"file": f"html/{name}", "kind": kind, "label": label, "title": None,
                 "words": sum(len(p.split()) for p in paras)}
        if kind == "chapter":
            entry["index"] = chapter_index
            chapter_index += 1
        entries.append(entry)

    book = {"title": title, "author": author, "series": None, "seriesIndex": None, "isbn": None,
            "sourcePdf": pdf.name, "entries": entries}
    (out_dir / "book.json").write_text(json.dumps(book, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for e in entries:
        print(f"{e['kind']:8} {str(e.get('index', '')):>3}  {e['label'][:40]:40} {e['words']:>7} words")
    paragraphs = sum(len(p) for _, p in parts)
    print(f"\n{chapter_index} chapters, {sum(e['kind'] == 'part' for e in entries)} part openers folded into them, "
          f"{sum(e['words'] for e in entries if e['kind'] == 'chapter'):,} words of story in {paragraphs:,} paragraphs -> {out_dir}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
