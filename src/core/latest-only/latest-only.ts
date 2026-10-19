/**
 * A queue that runs an async task per pushed value, one at a time, keeping only the newest value pushed meanwhile.
 *
 * Used by the preview for its compiles and reveals, so they never fall behind typing.
 *
 * Guarantees: the first value pushed while idle starts synchronously; a value is dropped only when a newer one was
 * pushed before its turn; the running task can ask whether a newer value waits; runs start at least `interval` ms
 * apart. A failing run is logged (`console.error`) and the next value still runs.
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
  }
}

export interface LatestOnlyOptions {
  /** Minimum time in ms between the start of two runs (default 0). */
  interval?: number;
}
