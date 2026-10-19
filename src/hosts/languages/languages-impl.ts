// See Languages in languages.ts.
import type { Extension } from '@codemirror/state';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import type { SourceOffset, SourceRange, TextChange } from '../../core/typst-document/typst-document';
import css from './languages.css?inline';
import { pasteExtension, type PasteOptions } from './paste-extension';
import type { Languages, DocumentPasteProviderMetadata, DocumentPasteEditProvider, DocumentPasteEdit, KnownImport, LanguageContribution, HelpProvider, HelpSheet, TextDocument, DocumentSelector, DocumentFilter, DocumentLink, DocumentLinkProvider, DocumentDropEditProvider, DocumentDropEdit } from './languages';

/**
 * `edits` in the order a paste offers them, the one it goes in as first: those of exactly a kind in `preferences`, in
 * their order; then each after those it yields to, else in the given order. An edit putting in the same text as one
 * before is left out; the plain text one (`text.plain`) takes the place of the first with its text, so a paste with
 * formatting always offers its plain text by that name.
 */
export function sortPasteEdits(edits: readonly DocumentPasteEdit[], preferences: readonly string[] = []): DocumentPasteEdit[] {
  const sorted = preferences.flatMap((kind) => edits.filter((edit) => edit.kind === kind));
  const rest = edits.filter((edit) => !sorted.includes(edit));
  while (rest.length > 0) {
    const yields = (edit: DocumentPasteEdit) => rest.some((other) => other !== edit && edit.yieldTo?.some((kind) => containsKind(kind, other.kind)));
    // yielding in a circle: the first
    const next = rest.find((edit) => !yields(edit)) ?? rest[0];
    sorted.push(next);
    rest.splice(rest.indexOf(next), 1);
  }
  const plain = sorted.find((edit) => edit.kind === 'text.plain');
  return sorted
    .filter((edit, i) => sorted.findIndex((other) => other.insertText === edit.insertText) === i)
    .map((edit) => (plain && edit.insertText === plain.insertText ? plain : edit));
}

/** The `Languages` of one widget. Each link remembers its provider, which resolves it on demand (`resolveDocumentLink`). */
export class LanguagesHost implements Languages {
  readonly #providers: { selector: DocumentSelector; provider: DocumentLinkProvider; priority: number }[] = [];
  readonly #providerOf = new WeakMap<DocumentLink, DocumentLinkProvider>();
  readonly #helpProviders: { selector: DocumentSelector; provider: HelpProvider }[] = [];
  readonly #knownImports: { selector: DocumentSelector; known: KnownImport }[] = [];
  readonly #dropEditProviders: { selector: DocumentSelector; provider: DocumentDropEditProvider; priority: number }[] = [];
  readonly #pasteEditProviders: { selector: DocumentSelector; provider: DocumentPasteEditProvider; metadata: DocumentPasteProviderMetadata }[] = [];
  /** The declared endings (lower case, with the dot) and their language. */
  readonly #endings = new Map<string, string>();

  /** The CSS of the editors' paste choice (`.zwf-paste-chip`), for the workbench to put where the widget renders. */
  readonly styleSheet: string = css;

  /**
   * Declares `languages` (the extensions' `contributes.languages`, the workbench's own). An ending is one language's:
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

  registerHelpProvider(selector: DocumentSelector, provider: HelpProvider): Disposable {
    return add(this.#helpProviders, { selector, provider });
  }

  provideHelp(languageId: string | undefined): readonly HelpSheet[] {
    return this.#helpProviders.filter(({ selector }) => matches(selector, languageId)).map(({ provider }) => provider.provideHelp());
  }

  registerKnownImport(selector: DocumentSelector, known: KnownImport): Disposable {
    return add(this.#knownImports, { selector, known });
  }

  provideKnownImports(languageId: string): KnownImport[] {
    return this.#knownImports.filter(({ selector }) => matches(selector, languageId)).map(({ known }) => known);
  }

  registerDocumentPasteEditProvider(selector: DocumentSelector, provider: DocumentPasteEditProvider, metadata: DocumentPasteProviderMetadata): Disposable {
    return add(this.#pasteEditProviders, { selector, provider, metadata });
  }

  /** On a copy or cut of `copied` from `document`: every matching paste edit provider adds to the clipboard `dataTransfer`. */
  prepareDocumentPaste(document: TextDocument, copied: string, dataTransfer: DataTransfer): void {
    for (const { provider } of this.#pasteEditProvidersOf(document)) provider.prepareDocumentPaste?.(document, copied, dataTransfer);
  }

  /**
   * The edits the providers give for a paste of the clipboard `dataTransfer` into `document` in place of `ranges`, in
   * registration order: of each provider that reads a type the clipboard has, the edits of the kinds it declared.
   */
  provideDocumentPasteEdits(document: TextDocument, ranges: readonly SourceRange[], dataTransfer: DataTransfer): DocumentPasteEdit[] {
    const types = [...dataTransfer.types];
    const has = (mime: string) => mime === '*/*' || types.some((type) => type === mime || (mime.endsWith('/*') && type.startsWith(mime.slice(0, -1))));
    return this.#pasteEditProvidersOf(document).flatMap(({ provider, metadata: { providedPasteEditKinds: kinds, pasteMimeTypes = ['*/*'] } }) => {
      if (kinds.length === 0 || !pasteMimeTypes.some(has)) return [];
      const edits = provider.provideDocumentPasteEdits?.(document, ranges, dataTransfer) ?? [];
      return edits.filter((edit) => kinds.some((kind) => containsKind(kind, edit.kind)));
    });
  }

  /**
   * `edit` as it goes into `document` in place of `ranges`: as the providers resolve it, in registration order, each
   * given the edit the ones before left; additional edits that overlap the ranges or an earlier edit are left out.
   */
  resolveDocumentPasteEdit(edit: DocumentPasteEdit, document: TextDocument, ranges: readonly SourceRange[], dataTransfer: DataTransfer): DocumentPasteEdit {
    const additionalEdit: TextChange[] = [];
    const taken: SourceRange[] = [...ranges];
    const accept = (changes: readonly TextChange[] = []) => {
      for (const change of changes) {
        if (additionalEdit.includes(change) || taken.some((range) => conflicts(range, change))) continue;
        additionalEdit.push(change);
        taken.push(change);
      }
    };
    accept(edit.additionalEdit);
    let resolved: DocumentPasteEdit = { ...edit, additionalEdit: [...additionalEdit] };
    for (const { provider } of this.#pasteEditProvidersOf(document)) {
      const next = provider.resolveDocumentPasteEdit?.(resolved, document, ranges, dataTransfer);
      if (!next) continue;
      accept(next.additionalEdit);
      resolved = { ...next, additionalEdit: [...additionalEdit] };
    }
    return resolved;
  }

  /**
   * Runs the paste edit providers of the text's language around a copy, cut or paste in a CodeMirror editor, as in the
   * Source editors: `languageId` is the text's language, `path` the file it is in, now (null: none, no providers). A
   * paste goes in as the first of the edits of the registered providers and the editor's own; its choice offers the
   * others (see `pasteExtension`).
   */
  createDocumentPasteCodeMirrorExtension(languageId: string, path: () => ProjectPath | null, options: PasteOptions): Extension {
    return pasteExtension(this, languageId, path, options);
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

  #pasteEditProvidersOf(document: TextDocument): { provider: DocumentPasteEditProvider; metadata: DocumentPasteProviderMetadata }[] {
    return this.#pasteEditProviders.filter(({ selector }) => matches(selector, document.languageId));
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

/** Whether the paste edit kind `kind` is `other` or covers it (`typst` covers `typst.html`). */
function containsKind(kind: string, other: string): boolean {
  return other === kind || other.startsWith(`${kind}.`);
}

/** Whether changes of ranges `a` and `b` conflict: they share text, or an empty one lies inside the other (not at its ends). */
function conflicts(a: SourceRange, b: SourceRange): boolean {
  return (a.from < b.to && b.from < a.to) || (a.from === a.to && b.from < a.from && a.from < b.to) || (b.from === b.to && a.from < b.from && b.from < a.to);
}
