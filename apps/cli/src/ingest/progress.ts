/**
 * A one-line progress bar with a count and an ETA, drawn on the terminal's last line. Log lines are printed
 * above it. When the output is not a terminal (piped to a file) the bar is not drawn; a plain status line is
 * printed every 10% instead.
 */
export interface Progress {
  /** Mark `n` more units done. */
  tick(n?: number): void;
  /** Print a line above the bar. */
  log(line: string): void;
  /** Draw the final state and stop. */
  done(): void;
}

export type ProgressFactory = (label: string, total: number, unit: string) => Progress;

/** For tests and callers that want no bar: lines still go to `log`. */
export const silentProgress = (log: (line: string) => void): ProgressFactory => () => ({
  tick: () => {},
  log,
  done: () => {},
});

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Remaining time from the rate so far; undefined until there is a rate to go on. */
export function eta(done: number, total: number, elapsedMs: number): number | undefined {
  if (done <= 0 || elapsedMs <= 0) return undefined;
  return ((total - done) * elapsedMs) / done;
}

export function progressLine(label: string, done: number, total: number, unit: string, elapsedMs: number, columns: number): string {
  const pct = total ? Math.floor((done / total) * 100) : 100;
  const left = done >= total ? `took ${formatDuration(elapsedMs)}` : (() => {
    const ms = eta(done, total, elapsedMs);
    return ms === undefined ? "ETA …" : `ETA ${formatDuration(ms)}`;
  })();
  const info = `${done.toLocaleString()}/${total.toLocaleString()} ${unit}  ${String(pct).padStart(3)}%  ${left}`;
  const head = `${label} `;
  const barWidth = Math.max(10, Math.min(40, columns - head.length - info.length - 4));
  const filled = total ? Math.round((done / total) * barWidth) : barWidth;
  return `${head}[${"█".repeat(filled)}${"░".repeat(barWidth - filled)}] ${info}`;
}

export function terminalProgress(stream: NodeJS.WriteStream = process.stdout): ProgressFactory {
  return (label, total, unit) => {
    const start = Date.now();
    let done = 0;
    let finished = false;
    const tty = stream.isTTY === true;
    const line = () => progressLine(label, Math.min(done, total), total, unit, Date.now() - start, stream.columns ?? 80);
    const draw = () => {
      if (tty && !finished) stream.write(`\r\x1b[2K${line()}`);
    };
    const clear = () => {
      if (tty) stream.write("\r\x1b[2K");
    };
    let lastDecile = 0;
    // Redraw every second so the ETA keeps moving during a slow stretch.
    const timer = tty ? setInterval(draw, 1000) : undefined;
    timer?.unref();
    draw();
    return {
      tick(n = 1) {
        done += n;
        if (tty) return draw();
        const decile = total ? Math.floor((Math.min(done, total) / total) * 10) : 10;
        if (decile > lastDecile) {
          lastDecile = decile;
          stream.write(`${line()}\n`);
        }
      },
      log(text) {
        clear();
        stream.write(`${text}\n`);
        draw();
      },
      done() {
        if (finished) return;
        if (timer) clearInterval(timer);
        if (tty) stream.write(`\r\x1b[2K${line()}\n`);
        finished = true;
      },
    };
  };
}
