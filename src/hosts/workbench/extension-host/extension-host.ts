// ExtensionHost: activates the widget's extensions in list order and disposes what they registered in reverse.
// See workbench.ts and ARCHITECTURE.md, "Extensions".
import { Disposable } from '../../../core/disposable/disposable';
import type { ExtensionContext, TypstExtension } from '../workbench';

/** Everything of a context but what the host adds per extension (`subscriptions`). */
export type SharedContext = Omit<ExtensionContext, 'subscriptions'>;

/**
 * Runs a list of extensions: each is activated once, in list order, with its own `subscriptions`; `dispose`
 * disposes the extensions in reverse list order, each one's subscriptions in reverse order, so whatever was
 * registered later (and may depend on what came before) goes first.
 */
export class ExtensionHost {
  readonly #activated: { dispose(): unknown }[][] = [];

  constructor(private readonly shared: SharedContext) {}

  activate(extensions: readonly TypstExtension[]): void {
    const ids = new Set<string>();
    for (const extension of extensions) {
      if (ids.has(extension.id)) throw new Error(`Extension ${extension.id} is in the list twice`);
      ids.add(extension.id);
      const subscriptions: { dispose(): unknown }[] = [];
      this.#activated.push(subscriptions);
      extension.activate({ ...this.shared, subscriptions });
    }
  }

  dispose(): void {
    for (const subscriptions of this.#activated.splice(0).reverse()) Disposable.from(...subscriptions).dispose();
  }
}
