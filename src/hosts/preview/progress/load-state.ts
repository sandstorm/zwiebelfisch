// LoadState. See ../preview.ts and docs/30_architecture/06_preview.typ.
import type { PreviewProgress } from '../preview';
import type { LoadEvent } from '../worker/protocol';

/**
 * The preview's loading, most important first: a failed engine, the engine's download, packages and fonts downloading
 * during a compile, then "Compiling…" until the first compile answered. Null once nothing is pending.
 *
 * What the preview still waits for — the engine's wasm, the first compile, packages, fonts — from the worker's load
 * events, as one `PreviewProgress`. No DOM.
 */
export class LoadState {
  #engine: Engine = { kind: 'loading', loaded: 0, total: null };
  #packages: readonly string[] = [];
  #font: string | null = null;
  #compiled = false;

  /** The worker told how loading goes. */
  apply(event: LoadEvent): void {
    switch (event.kind) {
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

  /** A compile answered (pages or errors): "Compiling…" is no longer shown. */
  compiled(): void {
    this.#compiled = true;
  }

  current(): PreviewProgress | null {
    const engine = this.#engine;
    if (engine.kind === 'failed') return { kind: 'failed', title: 'The Typst compiler could not be loaded.', detail: engine.message, fraction: null };
    if (engine.kind === 'loading') return engineProgress(engine.loaded, engine.total);
    if (this.#packages.length > 0) {
      return { kind: 'packages', title: `Downloading ${this.#packages.map(packageName).join(', ')}…`, detail: null, fraction: null };
    }
    if (this.#font !== null) return { kind: 'fonts', title: 'Loading fonts…', detail: null, fraction: null };
    if (!this.#compiled) return { kind: 'compiling', title: 'Compiling…', detail: null, fraction: null };
    return null;
  }
}

type Engine = { kind: 'loading'; loaded: number; total: number | null } | { kind: 'ready' } | { kind: 'failed'; message: string };

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
