import { describe, expect, it } from "vitest";
import { chapterParagraphs, splitPassages } from "./passages";

const html = `<!doctype html><html><head><title>Chapter One</title></head><body>
<h2> CHAPTER ONE</h2>
<p>The road ran<br/>down to the sea</p>
<p>&#39;Prod and pull,&#39; the old woman said &amp; spat.</p>
<p>   </p>
<p>Third <i>paragraph</i> here.</p>
</body></html>`;

describe("chapterParagraphs", () => {
  it("drops the heading, decodes entities and keeps verse line breaks", () => {
    expect(chapterParagraphs(html)).toEqual([
      "The road ran\ndown to the sea",
      "'Prod and pull,' the old woman said & spat.",
      "Third paragraph here.",
    ]);
  });
});

describe("splitPassages", () => {
  const para = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const sizes = (passages: string[]) => passages.map((p) => p.split(/\s+/).length);

  it("closes a Passage once it reaches the target", () => {
    expect(sizes(splitPassages([para(200), para(200), para(200), para(200)], 350))).toEqual([400, 400]);
  });

  it("never splits a paragraph", () => {
    expect(sizes(splitPassages([para(1000), para(100), para(300)], 350))).toEqual([1000, 400]);
  });

  it("folds a short tail into the previous Passage", () => {
    expect(sizes(splitPassages([para(360), para(50)], 350))).toEqual([410]);
  });

  it("keeps a Chapter shorter than the target as one Passage", () => {
    expect(sizes(splitPassages([para(80)], 350))).toEqual([80]);
  });
});
