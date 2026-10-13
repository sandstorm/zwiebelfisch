import type { Extension } from '@codemirror/state';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import type { SourceOffset, SourceRange, TextChange } from '../../core/typst-document/typst-document';
import type { Command } from '../commands/commands';
import css from './languages.css?inline';
import { followableLink, linkExtension, primaryLink, type LinkActions } from './link-extension';
import { pasteExtension, type PasteOptions } from './paste-extension';

/**
 * What the widget knows about the languages of texts (VS Code's `languages` namespace, the parts we use): document
 * links, what a project file dropped into a text becomes, the language of a file, help sheets, and the modules names
 * come from.
 *
 * Finding links is a feature's policy: which paths count, what a missing file offers. Showing and following links is
 * the same in every editor. So extensions register link providers, and every CodeMirror editor (the Source editor,
 * a raw box's code, an extension's own editor) shows the merged links of all providers for its language, knowing none
 * of them. Help works the same way: a language's sheet comes from its extension, the help panel shows it; so do known
 * imports: an extension says where the names of its constructs come from, whoever adds imports reads them. And drops:
 * a file dragged from the file panel (or from the desktop, once the workbench uploaded it) into a Typst editor becomes
 * what an extension makes of it (a spreadsheet: its figure and import), the editors only insert it. And copy and
 * paste: an extension offers other ways a paste can go in (Markdown as Typst) or changes what goes in (a label already
 * taken gets a new name) and what else it changes (the imports the text needs); the editors do the paste, in one undo
 * step, and offer the other ways.
 *
 * The host knows no language itself. Whoever hands a text over says its language (`languageId`), and the extensions
 * declare which file endings are which language (`contributes.languages`). See docs/40_architecture/07_workbench.typ.
 */
export interface Languages {
  /**
   * Adds links to the documents `selector` matches until disposed: the Source editors, the Visual editor (its text,
   * raw boxes' code and pictures) and the text files' editor show them (Mod+click, Alt+Enter, hover). The links of
   * every matching provider are merged; where links overlap, the provider of the higher `priority` wins (default 100,
   * higher first; equal: registration order).
   */
  registerDocumentLinkProvider(selector: DocumentSelector, provider: DocumentLinkProvider, options?: { priority?: number }): Disposable;
  /**
   * Shows the links of a CodeMirror editor's text as the Source editors do, for an extension's own editor: the text is
   * in `languageId`; `path` is the file it is in, now (null: none, no links).
   */
  createDocumentLinksCodeMirrorExtension(languageId: string, path: () => ProjectPath | null): Extension;
  /**
   * Says what a project file dropped into the documents `selector` matches becomes, until disposed: the Visual and the
   * Source editor insert the edit of the provider of the highest `priority` (default 100, higher first; equal:
   * registration order) that gives one for the file (an image: `#image(..)`; a diagram, priority 110: its figure).
   */
  registerDocumentDropEditProvider(selector: DocumentSelector, provider: DocumentDropEditProvider, options?: { priority?: number }): Disposable;
  /**
   * The language of the file `path` by its ending, as the extensions declare them (`contributes.languages`; the
   * workbench's own: `typst` for `.typ`): the longest declared ending the name has, in any case. undefined: none.
   */
  getLanguageId(path: ProjectPath): string | undefined;
  /**
   * Adds a help sheet for the languages `selector` matches until disposed: the help panel shows it while a file in
   * such a language is shown (no `language`: for every file).
   */
  registerHelpProvider(selector: DocumentSelector, provider: HelpProvider): Disposable;
  /** The help sheets for `languageId` (undefined: a file in no declared language), in registration order. */
  provideHelp(languageId: string | undefined): readonly HelpSheet[];
  /**
   * Says where a name that texts of the languages `selector` matches use comes from, until disposed: `mermaid` from
   * `@preview/merman:0.4.0`. An extension declares the names of its own constructs, so that whoever adds imports
   * (pasted text that uses the name) knows them without knowing the extension.
   */
  registerKnownImport(selector: DocumentSelector, known: KnownImport): Disposable;
  /** The known imports of `languageId`, in registration order. */
  provideKnownImports(languageId: string): readonly KnownImport[];
  /**
   * Takes part in every copy from and paste into the documents `selector` matches until disposed, in the Visual editor
   * and the Source editors. A paste offers the edits of every provider of `metadata.providedPasteEditKinds` whose
   * `pasteMimeTypes` the clipboard has, before the editor's own (Typst, code, plain text; HTML), as alternatives: it goes
   * in as the first by `yieldTo`, the "Paste as" chip offers the others. Whichever goes in, every provider's
   * `resolveDocumentPasteEdit` changes it first, in registration order; additional edits that overlap the pasted ranges
   * or an earlier edit are dropped.
   */
  registerDocumentPasteEditProvider(selector: DocumentSelector, provider: DocumentPasteEditProvider, metadata: DocumentPasteProviderMetadata): Disposable;
}

/** What a paste edit provider gives (VS Code's DocumentPasteProviderMetadata). */
export interface DocumentPasteProviderMetadata {
  /** The kinds of the edits `provideDocumentPasteEdits` gives (`typst.markdown`); none: it only resolves edits. */
  readonly providedPasteEditKinds: readonly string[];
  /** The clipboard types it reads (`text/html`, `text/*`); default: any. */
  readonly pasteMimeTypes?: readonly string[];
}

/**
 * Offers other ways a paste into a text can go in, or changes what goes in (VS Code's DocumentPasteEditProvider). A
 * provider of kinds converts the clipboard (Markdown into Typst); a resolving one adjusts whatever goes in (a label
 * already taken renamed, the imports the text needs).
 */
export interface DocumentPasteEditProvider {
  /** On a copy or cut of `copied` from `document`: adds what a paste will need to the clipboard (`dataTransfer`). */
  prepareDocumentPaste?(document: TextDocument, copied: string, dataTransfer: DataTransfer): void;
  /** The ways a paste of the clipboard `dataTransfer` into `document` (its text before the paste) in place of `ranges` can go in. */
  provideDocumentPasteEdits?(document: TextDocument, ranges: readonly SourceRange[], dataTransfer: DataTransfer): readonly DocumentPasteEdit[] | undefined;
  /**
   * `edit`, of any provider or the editor, as it goes in: asked of every provider, each given the edit the ones before
   * left (VS Code asks only the edit's own provider). undefined: unchanged.
   */
  resolveDocumentPasteEdit?(edit: DocumentPasteEdit, document: TextDocument, ranges: readonly SourceRange[], dataTransfer: DataTransfer): DocumentPasteEdit | undefined;
}

/** A way a paste can go in (VS Code's DocumentPasteEdit). */
export interface DocumentPasteEdit {
  /** Its name in the "Paste as" choice (`Markdown`). */
  readonly title: string;
  /**
   * What it is, dot-separated from the general to the specific (VS Code's paste edit kinds). The editors' own: `typst`
   * (the text as Typst), `typst.code` (a code block), `text.plain` (plain characters, escaped), `typst.html` (the HTML,
   * read with the Visual editor's schema).
   */
  readonly kind: string;
  /** The text that goes in place of each pasted range. */
  readonly insertText: string;
  /**
   * Other changes of the text before the paste, overlapping neither the pasted ranges nor each other; one at the same
   * place as a pasted range goes before the pasted text.
   */
  readonly additionalEdit?: readonly TextChange[];
  /** The kinds it gives way to: an edit of such a kind (or one below it: `typst` covers `typst.html`) goes before it. */
  readonly yieldTo?: readonly string[];
}

/**
 * `edits` in the order a paste offers them, the one it goes in as first: those of exactly a kind in `preferences`, in
 * their order; then each after those it yields to, else in the given order. An edit putting in the same text as one
 * before is left out.
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
  return sorted.filter((edit, i) => sorted.findIndex((other) => other.insertText === edit.insertText) === i);
}

/**
 * A paste that went in as one of several kinds and may go in as another instead, until it closes (the next edit, the
 * selection moved away, Escape): what an editor's "Paste as" chip offers.
 */
export interface PasteChoice {
  /** The kinds it may go in as (`DocumentPasteEdit.kind`) with their names, first the one it first went in as. */
  readonly kinds: readonly { readonly kind: string; readonly title: string }[];
  /** The kind it went in as. */
  readonly kind: string;
  /** Puts it in as `kind` instead, in place of what it put in: undone in one step with the paste. */
  change(kind: string): void;
}

/** Where the editors show their paste choices (the workbench's: a quick pick, and the command `editor.action.pasteAs`). */
export interface PasteChoices {
  /** `choice` opened: the paste just made may go in as another kind. */
  openPasteChoice(choice: PasteChoice): void;
  /** `choice` closed. */
  closePasteChoice(choice: PasteChoice): void;
  /** Asks which kind `choice` goes in as (its chip was clicked) and changes it to the one picked. */
  pickPasteKind(choice: PasteChoice): void;
}

/** A name and the module it is imported from (`mermaid`, `@preview/merman:0.4.0`). */
export interface KnownImport {
  readonly name: string;
  /** The module as an import writes it: a package (`@preview/merman:0.4.0`). */
  readonly module: string;
}

/** A language as an extension declares it (VS Code's `contributes.languages` entry). */
export interface LanguageContribution {
  /** The language id (VS Code's where there is one: `json`, `markdown`, `bibtex`). */
  readonly id: string;
  /** The endings of its files, with the dot (`.bib`, `.ic.gen.typ`). */
  readonly extensions: readonly string[];
}

/** Gives the help sheet of a language: what to write in it, ready to insert. */
export interface HelpProvider {
  provideHelp(): HelpSheet;
}

/** A cheat sheet: plain data, which the help panel renders (no markup). */
export interface HelpSheet {
  /** "Typst basics". */
  readonly title: string;
  readonly sections: readonly HelpSection[];
  /** Where to read more. */
  readonly links?: readonly HelpLink[];
}

export interface HelpSection {
  /** "Headings". */
  readonly title: string;
  readonly rows: readonly HelpRow[];
}

/** One thing to write: what it looks like, what it does, and what inserting it puts into the text. */
export interface HelpRow {
  /** The text as shown (`= Heading`). */
  readonly snippet: string;
  /** What it does ("A heading; more `=`, a deeper level"). */
  readonly description: string;
  /** What inserting the row (drag, Enter) puts into the text; default: `snippet`. */
  readonly insert?: string;
}

export interface HelpLink {
  readonly label: string;
  /** An absolute URL; opens in a new tab. */
  readonly href: string;
}

/**
 * A text a link provider reads (VS Code's TextDocument, as far as links need it): a whole file's text, or a part of
 * one, e.g. the code of a raw box in a Typst file.
 */
export interface TextDocument {
  /** The file the text is in: relative paths in it resolve from here. */
  readonly path: ProjectPath;
  /** The text's language, said by whoever hands it over: `typst` (Typst files, raw boxes), `json`, `markdown`, … */
  readonly languageId: string;
  readonly text: string;
}

/** Which documents a provider is for (VS Code's DocumentSelector): those any of its filters matches. */
export type DocumentSelector = DocumentFilter | readonly DocumentFilter[];

/** Documents by their language (VS Code's DocumentFilter); no `language`: every document. */
export interface DocumentFilter {
  readonly language?: string;
}

/** A range of a text that leads somewhere (VS Code's DocumentLink). */
export interface DocumentLink {
  /** Where the link is, as offsets in the text given to the provider. */
  readonly range: SourceRange;
  /**
   * Where following the link leads: a project file, or an external URL (`https:`, `mailto:`), which opens in a new tab;
   * absent until resolved, or when it leads nowhere.
   */
  readonly target?: ProjectPath | URL;
  /** With a target file: the range of it that following the link selects and scrolls to (a label: its place). */
  readonly selection?: SourceRange;
  /** What the hover says about the link (e.g. that its file is missing). */
  readonly tooltip?: string;
  /**
   * What the hover offers to do instead (VS Code: a `command:` link), e.g. create the missing file. If the command
   * rejects, the hover shows the error's message.
   */
  readonly command?: Command;
}

/** Finds the links in a text (VS Code's DocumentLinkProvider). */
export interface DocumentLinkProvider {
  /** The links in `document` (cheap ones: `resolveDocumentLink` may fill in the rest when one is shown or followed). */
  provideDocumentLinks(document: TextDocument): readonly DocumentLink[];
  /** A link this provider gave, with its target, tooltip or command filled in. */
  resolveDocumentLink?(link: DocumentLink): DocumentLink;
}

/** Makes a dropped project file into text (VS Code's DocumentDropEditProvider). */
export interface DocumentDropEditProvider {
  /**
   * What the project file `file`, dropped at `position` of `document`, puts there; null: no file of this provider's
   * (the next provider is asked).
   */
  provideDocumentDropEdits(document: TextDocument, position: SourceOffset, file: ProjectPath): DocumentDropEdit | null;
  /**
   * The folder (`/assets/`) a file from the computer dropped into `document` goes to before it is dropped as a project
   * file; `file` is where it would go at the top of the project (`/cat.png`). undefined: no file of this provider's (the
   * next provider is asked; none: the top).
   */
  provideUploadFolder?(document: TextDocument, file: ProjectPath): string | undefined;
}

/** What a drop puts into a document (VS Code's DocumentDropEdit), in one undo step. */
export interface DocumentDropEdit {
  /**
   * The text inserted where the file was dropped. The Visual editor reads it as Typst: inline content goes into the
   * text there, blocks after the block there.
   */
  readonly insertText: string;
  /** Other changes of the same document, in the coordinates of its text before the drop and before `position` (an import). */
  readonly additionalEdit?: readonly TextChange[];
}

/** What following a link does, in the editor that shows it: the workbench's side of links. */
export interface LinkTargets {
  /** Shows a link's target: a project file (at `selection`, if given), or an external URL in a new tab. */
  open(target: ProjectPath | URL, selection?: SourceRange): void;
  /** Runs a link's command (`commands.executeCommand`). */
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
}

/** A link as something other than a CodeMirror editor follows it (a raw box's picture, the Visual editor's text). */
export interface FollowableLink {
  /** Whether a click with `event`'s modifiers follows it, as on links in text (⌘ on Mac, else Ctrl). */
  isFollowEvent(event: MouseEvent | KeyboardEvent): boolean;
  /** Opens its target (resolved again: a label may have moved since). */
  follow(): void;
  /**
   * The pointer moved (`event`) over it at `element` (a reference chip, a link's text, a picture): it shows as links in
   * text do, the same hint after the same delay ("Edit diagram (⌘+click or Alt+Enter)", `.typst-link-hint`) and,
   * while the modifier is held, the link look (`typst-link--mod` on `element`).
   */
  hover(event: MouseEvent, element: Element): void;
  /** The pointer (`event`) left it: its hint goes (unless the pointer moves into it), and its link look. */
  leave(event: MouseEvent): void;
}

/**
 * The `Languages` of one widget. Each link remembers its provider, which resolves it on demand
 * (`resolveDocumentLink`). `targets` is what following a link does, in every editor that shows links.
 */
export class LanguagesHost implements Languages {
  readonly #providers: { selector: DocumentSelector; provider: DocumentLinkProvider; priority: number }[] = [];
  readonly #providerOf = new WeakMap<DocumentLink, DocumentLinkProvider>();
  readonly #helpProviders: { selector: DocumentSelector; provider: HelpProvider }[] = [];
  /** The document `linkAt` was asked about last, and its links. */
  #lastLinks: (TextDocument & { links: readonly DocumentLink[] }) | null = null;
  readonly #knownImports: { selector: DocumentSelector; known: KnownImport }[] = [];
  readonly #dropEditProviders: { selector: DocumentSelector; provider: DocumentDropEditProvider; priority: number }[] = [];
  readonly #pasteEditProviders: { selector: DocumentSelector; provider: DocumentPasteEditProvider; metadata: DocumentPasteProviderMetadata }[] = [];
  /** The declared endings (lower case, with the dot) and their language. */
  readonly #endings = new Map<string, string>();

  /** The CSS of links (their hint `.typst-link-hint`, their look `typst-link--mod`), for the workbench to put where the widget renders. */
  readonly styleSheet: string = css;

  constructor(private readonly targets: LinkTargets) {}

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

  createDocumentLinksCodeMirrorExtension(languageId: string, path: () => ProjectPath | null): Extension {
    const actions = {
      ...this.targets,
      provideDocumentLinks: (document: TextDocument) => this.provideDocumentLinks(document),
      resolveDocumentLink: (link: DocumentLink) => this.resolveDocumentLink(link),
    };
    return linkExtension(actions, languageId, path);
  }

  /**
   * The primary link of `document`: the first, in text order, that leads somewhere. A provider makes its link the
   * primary one on a range by its `priority` (overlapping links: the higher wins), so no link needs a mark. For what
   * shows a text other than as text (a raw box's picture), to follow it as the editors follow links.
   */
  primaryLink(document: TextDocument): FollowableLink | null {
    return primaryLink(this.provideDocumentLinks(document), this.#actions);
  }

  /**
   * The link at `offset` of `document` (its range including both ends) that leads somewhere, or null: for an editor
   * that shows the text other than as text (the Visual editor), asked as the pointer moves. The links of the last
   * document asked about are kept until its text changes; each is resolved anew (a label may have come or gone).
   */
  linkAt(document: TextDocument, offset: SourceOffset): FollowableLink | null {
    const last = this.#lastLinks;
    const same = last && last.path === document.path && last.languageId === document.languageId && last.text === document.text;
    const links = same ? last.links : this.provideDocumentLinks(document);
    this.#lastLinks = { ...document, links };
    const link = links.find(({ range }) => range.from <= offset && offset <= range.to);
    return link ? followableLink(link, this.#actions) : null;
  }

  #pasteEditProvidersOf(document: TextDocument): { provider: DocumentPasteEditProvider; metadata: DocumentPasteProviderMetadata }[] {
    return this.#pasteEditProviders.filter(({ selector }) => matches(selector, document.languageId));
  }

  /** What a followed link needs from this host: resolving it, and where it leads (`targets`). */
  get #actions(): Pick<LinkActions, 'resolveDocumentLink' | 'open' | 'executeCommand'> {
    const { targets } = this;
    return {
      resolveDocumentLink: (link) => this.resolveDocumentLink(link),
      open: (target, selection) => targets.open(target, selection),
      executeCommand: (command, ...args) => targets.executeCommand(command, ...args),
    };
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
