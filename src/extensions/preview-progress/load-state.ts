// See previewProgress in preview-progress.ts.
import type { EngineCrash, LoadEvent } from '../../hosts/preview/preview';

/**
 * What the preview waits for: the engine's wasm downloading (`engine`, with the bytes), the first compile
 * (`compiling`), packages or fonts downloading during a compile, or the engine that could not be loaded or crashed
 * (`failed`).
 */
export interface PreviewProgress {
  readonly kind: 'engine' | 'compiling' | 'packages' | 'fonts' | 'failed';
  /** What is going on, as people read it: "Loading the Typst compiler…", "Downloading @preview/merman 0.4.0…". */
  readonly title: string;
  /** How far, or why it failed: "3.1 / 6.6 MB"; null: nothing to add. */
  readonly detail: string | null;
  /** Done so far, from 0 to 1; null: unknown. */
  readonly fraction: number | null;
}

/**
 * The preview's loading, most important first: a failed or crashed engine, the engine's download, packages and fonts
 * downloading during a compile, then "Compiling…" until the first compile answered. Null once nothing is pending. Made
 * from the preview's load and crash events, as one `PreviewProgress`; no DOM.
 */
export class LoadState {
  #engine: Engine = { kind: 'loading', loaded: 0, total: null };
  #packages: readonly string[] = [];
  #font: string | null = null;
  #compiled = false;

  /** The preview told how loading goes. */
  apply(event: LoadEvent): void {
    switch (event.kind) {
      case 'starting':
        this.#engine = { kind: 'loading', loaded: 0, total: null };
        break;
      case 'engine':
        if (this.#engine.kind === 'loading') this.#engine = { kind: 'loading', loaded: event.loaded, total: event.total };
        break;
      case 'ready':
        this.#engine = { kind: 'ready' };
        break;
      case 'failed':
        this.#engine = { kind: 'failed', message: event.message };
        break;
      case 'packages':
        this.#packages = event.specs;
        break;
      case 'font':
        this.#font = event.name;
        break;
    }
  }

  /** The engine crashed; `restarting`: a new one is started, else it stays off. */
  crashed({ message, restarting }: EngineCrash): void {
    this.#engine = { kind: 'crashed', message, restarting };
    this.#packages = [];
    this.#font = null;
  }

  /** A compile answered (pages or errors): "Compiling…" is no longer shown. */
  compiled(): void {
    this.#compiled = true;
  }

  current(): PreviewProgress | null {
    const engine = this.#engine;
    if (engine.kind === 'failed') return { kind: 'failed', title: 'The Typst compiler could not be loaded.', detail: engine.message, fraction: null };
    if (engine.kind === 'crashed') {
      const title = engine.restarting ? 'The Typst compiler crashed and was restarted.' : 'The Typst compiler crashed again; it starts again with the next edit.';
      return { kind: 'failed', title, detail: engine.message, fraction: null };
    }
    if (engine.kind === 'loading') return engineProgress(engine.loaded, engine.total);
    if (this.#packages.length > 0) {
      return { kind: 'packages', title: `Downloading ${this.#packages.map(packageName).join(', ')}…`, detail: null, fraction: null };
    }
    if (this.#font !== null) return { kind: 'fonts', title: 'Loading fonts…', detail: null, fraction: null };
    if (!this.#compiled) return { kind: 'compiling', title: 'Compiling…', detail: null, fraction: null };
    return null;
  }
}

type Engine =
  | { kind: 'loading'; loaded: number; total: number | null }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string }
  | { kind: 'crashed'; message: string; restarting: boolean };

function engineProgress(loaded: number, total: number | null): PreviewProgress {
  const title = 'Loading the Typst compiler…';
  if (total === null) return { kind: 'engine', title, detail: loaded > 0 ? `${megabytes(loaded)} MB` : null, fraction: null };
  return { kind: 'engine', title, detail: `${megabytes(loaded)} / ${megabytes(total)} MB`, fraction: Math.min(1, loaded / total) };
}

function megabytes(bytes: number): string {
  return (bytes / 1e6).toFixed(1);
}

/** `@preview/merman:0.4.0` as people read it: `@preview/merman 0.4.0`. */
function packageName(spec: string): string {
  return spec.replace(/:([^:/]+)$/, ' $1');
}
