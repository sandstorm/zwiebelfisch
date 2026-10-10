// DocumentLinks: the links of every registered DocumentLinkProvider, merged (`Workbench.registerDocumentLinkProvider`),
// and how the views show them: the Source views and the code of the Visual view's raw boxes get `linkExtension`.
// Entry of hosts/workbench/document-links/. See workbench.ts and ARCHITECTURE.md, "File links".
import { Disposable } from '../../../core/disposable/disposable';
import type { DocumentLink, DocumentLinkProvider, TextDocument } from '../workbench';

export { linkExtension, type LinkedText } from './link-extension';
export { default as documentLinkStyles } from './document-links.css?inline';

/** The default `priority` of a provider (as for the Visual view's contributions). */
const DEFAULT_PRIORITY = 100;

/**
 * The registered link providers. A text's links are those of every provider; where links of two providers overlap,
 * the one of the higher `priority` wins (equal: the one registered first). Each link remembers its provider, which
 * resolves it on demand (`resolveDocumentLink`).
 */
export class DocumentLinks {
  readonly #providers: { provider: DocumentLinkProvider; priority: number }[] = [];
  readonly #providerOf = new WeakMap<DocumentLink, DocumentLinkProvider>();

  register(provider: DocumentLinkProvider, options: { priority?: number } = {}): Disposable {
    const entry = { provider, priority: options.priority ?? DEFAULT_PRIORITY };
    this.#providers.push(entry);
    return new Disposable(() => {
      const index = this.#providers.indexOf(entry);
      if (index >= 0) this.#providers.splice(index, 1);
    });
  }

  /** The links of `document`, merged (see the class), in text order. */
  provideDocumentLinks(document: TextDocument): DocumentLink[] {
    const accepted: DocumentLink[] = [];
    // the sort is stable: equal priorities in registration order
    for (const { provider } of [...this.#providers].sort((a, b) => b.priority - a.priority)) {
      for (const link of provider.provideDocumentLinks(document)) {
        if (accepted.some((other) => overlap(other, link))) continue;
        this.#providerOf.set(link, provider);
        accepted.push(link);
      }
    }
    return accepted.sort((a, b) => a.range.from - b.range.from);
  }

  /** `link` with what its provider fills in on demand (target, tooltip, command); `link` itself if there is nothing to add. */
  resolveDocumentLink(link: DocumentLink): DocumentLink {
    const provider = this.#providerOf.get(link);
    const resolved = provider?.resolveDocumentLink?.(link) ?? link;
    if (provider) this.#providerOf.set(resolved, provider);
    return resolved;
  }
}

function overlap(a: DocumentLink, b: DocumentLink): boolean {
  return a.range.from < b.range.to && b.range.from < a.range.to;
}
