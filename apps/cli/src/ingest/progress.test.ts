import { describe, expect, it } from "vitest";
import { eta, formatDuration, progressLine, terminalProgress } from "./progress";

describe("progress", () => {
  it("formats durations", () => {
    expect(formatDuration(4_400)).toBe("4s");
    expect(formatDuration(372_000)).toBe("6m 12s");
    expect(formatDuration(3_900_000)).toBe("1h 05m");
  });

  it("estimates the rest from the rate so far", () => {
    expect(eta(0, 100, 5_000)).toBeUndefined();
    expect(eta(25, 100, 60_000)).toBe(180_000);
  });

  it("draws a bar with count, percent and ETA", () => {
    expect(progressLine("Extracting", 25, 100, "passages", 60_000, 80)).toBe(
      "Extracting [████████░░░░░░░░░░░░░░░░░░░░░░░░] 25/100 passages   25%  ETA 3m 00s",
    );
    expect(progressLine("Summarising", 4, 4, "Subjects", 61_000, 80)).toContain("4/4 Subjects  100%  took 1m 01s");
  });

  it("prints a plain line every 10% when not on a terminal", () => {
    let out = "";
    const stream = { isTTY: false, write: (s: string) => ((out += s), true) } as unknown as NodeJS.WriteStream;
    const bar = terminalProgress(stream)("Extracting", 20, "passages");
    for (let i = 0; i < 20; i++) bar.tick();
    bar.log("hello");
    bar.done();
    const lines = out.trim().split("\n");
    expect(lines.filter((l) => l.startsWith("Extracting"))).toHaveLength(10);
    expect(lines.at(-1)).toBe("hello");
  });
});
