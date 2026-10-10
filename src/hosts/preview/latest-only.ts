// LatestOnly: a task runner that only processes the newest value (compiles, cursor reveals). See preview.ts.
export interface LatestOnlyOptions {
  /** Minimum time in ms between the start of two runs (default 0). */
  interval?: number;
  /** Called whenever the last pending value has been processed. */
  onIdle?(): void;
}

/**
 * Runs an async task for pushed values, one at a time, dropping values that
 * were superseded before their turn: while a run is in progress, only the
 * newest pushed value is kept. Use it for "always show the latest" work such
 * as compiling on every keystroke or following the cursor.
 */
export class LatestOnly<T> {
  private queued: { value: T } | null = null;
  private running: Promise<void> | null = null;
  private lastStart = -Infinity;

  constructor(
    private readonly run: (value: T, isSuperseded: () => boolean) => Promise<void>,
    private readonly options: LatestOnlyOptions = {},
  ) {}

  push(value: T): void {
    this.queued = { value };
    this.running ??= this.drain();
  }

  /** Resolves once nothing is running or waiting. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    while (this.queued) {
      // Only wait when needed, so the first value starts synchronously.
      const wait = this.lastStart + (this.options.interval ?? 0) - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const { value } = this.queued!;
      this.queued = null;
      this.lastStart = Date.now();
      try {
        await this.run(value, () => this.queued !== null);
      } catch (error) {
        console.error(error);
      }
    }
    this.running = null;
    this.options.onIdle?.();
  }
}
