// FileDecorations: the decorations every registered provider gives a file (`window.registerFileDecorationProvider`),
// for the views that list files. See window.ts.
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import type { FileDecoration, FileDecorationProvider } from '../window';

/** The registered file decoration providers, asked in registration order, and one event for all their changes. */
export class FileDecorations {
  readonly #providers: { provider: FileDecorationProvider; subscription: Disposable }[] = [];
  readonly #changed = new EventEmitter<readonly ProjectPath[] | undefined>();
  readonly onDidChange = this.#changed.event;

  register(provider: FileDecorationProvider): Disposable {
    const entry = { provider, subscription: provider.onDidChangeFileDecorations((paths) => this.#changed.fire(paths)) };
    this.#providers.push(entry);
    this.#changed.fire(undefined);
    return new Disposable(() => {
      const index = this.#providers.indexOf(entry);
      if (index < 0) return;
      this.#providers.splice(index, 1);
      entry.subscription.dispose();
      this.#changed.fire(undefined);
    });
  }

  /** The decorations of `path`, of every provider in registration order. */
  decorationsOf(path: ProjectPath): readonly FileDecoration[] {
    return this.#providers.flatMap(({ provider }) => provider.provideFileDecoration(path) ?? []);
  }

  dispose(): void {
    for (const { subscription } of this.#providers.splice(0)) subscription.dispose();
    this.#changed.dispose();
  }
}
