// See Languages in languages.ts.
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import type { SourceOffset } from '../../core/typst-document/typst-document';
import type { Languages, DocumentPasteProviderMetadata, DocumentPasteEditProvider, ImportSource, LanguageContribution, HelpSheet, TextDocument, DocumentSelector, DocumentFilter, DocumentLink, DocumentLinkProvider, DocumentDropEditProvider, DocumentDropEdit } from './languages';

/** The `Languages` of one widget. Each link remembers its provider, which resolves it on demand (`resolveDocumentLink`). */
export class LanguagesHost implements Languages {
  readonly #providers: { selector: DocumentSelector; provider: DocumentLinkProvider; priority: number }[] = [];
  readonly #providerOf = new WeakMap<DocumentLink, DocumentLinkProvider>();
  readonly #helpSheets: { selector: DocumentSelector; sheet: HelpSheet }[] = [];
  readonly #importSources: { selector: DocumentSelector; source: ImportSource }[] = [];
  readonly #dropEditProviders: { selector: DocumentSelector; provider: DocumentDropEditProvider; priority: number }[] = [];
  readonly #pasteEditProviders: { selector: DocumentSelector; provider: DocumentPasteEditProvider; metadata: DocumentPasteProviderMetadata; priority: number }[] = [];
  /** The declared endings (lower case, with the dot) and their language. */
  readonly #endings = new Map<string, string>();

  /**
   * Declares `languages` (the extensions' `contributes.languages`, the widget's own). An ending is one language's:
   * declaring it for another throws.
   */
  declare(languages: readonly LanguageContribution[]): void {
    for (const { id, extensions } of languages) {
      for (const ending of extensions.map((extension) => extension.toLowerCase())) {
        const declared = this.#endings.get(ending);
        if (declared !== undefined && declared !== id) throw new Error(`Files ending in ${ending} are ${declared} already, not ${id}`);
        this.#endings.set(ending, id);
      }
    }
  }

  getLanguageId(path: ProjectPath): string | undefined {
    const name = ProjectPath.name(path).toLowerCase();
    let longest = '';
    for (const ending of this.#endings.keys()) if (ending.length > longest.length && name.endsWith(ending)) longest = ending;
    return this.#endings.get(longest);
  }

  registerHelpSheet(selector: DocumentSelector, sheet: HelpSheet): Disposable {
    return add(this.#helpSheets, { selector, sheet });
  }

  getHelpSheets(languageId: string | undefined): readonly HelpSheet[] {
    return this.#helpSheets.filter(({ selector }) => matches(selector, languageId)).map(({ sheet }) => sheet);
  }

  registerImportSource(selector: DocumentSelector, source: ImportSource): Disposable {
    return add(this.#importSources, { selector, source });
  }

  provideImportSources(languageId: string): ImportSource[] {
    return this.#importSources.filter(({ selector }) => matches(selector, languageId)).map(({ source }) => source);
  }

  registerDocumentPasteEditProvider(selector: DocumentSelector, provider: DocumentPasteEditProvider, metadata: DocumentPasteProviderMetadata, options: { priority?: number } = {}): Disposable {
    return add(this.#pasteEditProviders, { selector, provider, metadata, priority: options.priority ?? DEFAULT_PRIORITY });
  }

  getDocumentPasteEditProviders(languageId: string): { provider: DocumentPasteEditProvider; metadata: DocumentPasteProviderMetadata }[] {
    // the sort is stable: equal priorities in registration order
    const matching = this.#pasteEditProviders.filter(({ selector }) => matches(selector, languageId)).sort((a, b) => b.priority - a.priority);
    return matching.map(({ provider, metadata }) => ({ provider, metadata }));
  }

  registerDocumentLinkProvider(selector: DocumentSelector, provider: DocumentLinkProvider, options: { priority?: number } = {}): Disposable {
    return add(this.#providers, { selector, provider, priority: options.priority ?? DEFAULT_PRIORITY });
  }

  provideDocumentLinks(document: TextDocument): DocumentLink[] {
    const accepted: DocumentLink[] = [];
    const matching = this.#providers.filter(({ selector }) => matches(selector, document.languageId));
    // the sort is stable: equal priorities in registration order
    for (const { provider } of matching.sort((a, b) => b.priority - a.priority)) {
      for (const link of provider.provideDocumentLinks(document)) {
        if (accepted.some((other) => overlap(other, link))) continue;
        this.#providerOf.set(link, provider);
        accepted.push(link);
      }
    }
    return accepted.sort((a, b) => a.range.from - b.range.from);
  }

  resolveDocumentLink(link: DocumentLink): DocumentLink {
    const provider = this.#providerOf.get(link);
    const resolved = provider?.resolveDocumentLink?.(link) ?? link;
    if (provider) this.#providerOf.set(resolved, provider);
    return resolved;
  }

  registerDocumentDropEditProvider(selector: DocumentSelector, provider: DocumentDropEditProvider, options: { priority?: number } = {}): Disposable {
    return add(this.#dropEditProviders, { selector, provider, priority: options.priority ?? DEFAULT_PRIORITY });
  }

  /** What the project file `file` dropped at `position` of `document` becomes: the edit of the first provider by priority that gives one; null: none. */
  provideDocumentDropEdit(document: TextDocument, position: SourceOffset, file: ProjectPath): DocumentDropEdit | null {
    const matching = this.#dropEditProviders.filter(({ selector }) => matches(selector, document.languageId));
    // the sort is stable: equal priorities in registration order
    for (const { provider } of matching.sort((a, b) => b.priority - a.priority)) {
      const edit = provider.provideDocumentDropEdits(document, position, file);
      if (edit) return edit;
    }
    return null;
  }

  /** The folder a file from the computer dropped into `document` goes to: the first provider's by priority that names one, else the top (`/`). */
  provideUploadFolder(document: TextDocument, file: ProjectPath): string {
    const matching = this.#dropEditProviders.filter(({ selector }) => matches(selector, document.languageId));
    for (const { provider } of matching.sort((a, b) => b.priority - a.priority)) {
      const folder = provider.provideUploadFolder?.(document, file);
      if (folder !== undefined) return folder;
    }
    return '/';
  }
}

/** The default `priority` of a provider (as for the Visual editor's contributions). */
const DEFAULT_PRIORITY = 100;

function add<T>(list: T[], entry: T): Disposable {
  list.push(entry);
  return new Disposable(() => {
    const index = list.indexOf(entry);
    if (index >= 0) list.splice(index, 1);
  });
}

function matches(selector: DocumentSelector, languageId: string | undefined): boolean {
  const filters: readonly DocumentFilter[] = Array.isArray(selector) ? selector : [selector];
  return filters.some((filter) => filter.language === undefined || filter.language === languageId);
}

function overlap(a: DocumentLink, b: DocumentLink): boolean {
  return a.range.from < b.range.to && b.range.from < a.range.to;
}

