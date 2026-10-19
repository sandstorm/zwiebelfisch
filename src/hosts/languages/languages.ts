import type { Disposable } from '../../core/disposable/disposable';
import type { ProjectPath } from '../../core/paths/paths';
import type { SourceOffset, SourceRange, TextChange } from '../../core/typst-document/typst-document';
import type { Command } from '../commands/commands';

/**
 * The languages of texts (VS Code's `languages` namespace, the parts we use).
 *
 * Extensions register providers for a language; whoever shows or edits a text in it asks all of them:
 * - document links, merged across providers (`provideDocumentLinks`), for whoever shows them
 * - drop edits: what a project file dropped into a text becomes
 * - paste edits: other ways a paste can go in, and what else it changes
 * - help sheets, for the help panel
 * - known imports: the modules the names of a construct come from
 *
 * The host knows no language itself: whoever hands a text over says its language (`languageId`), and extensions declare
 * which file endings are which language (`contributes.languages`).
 */
export interface Languages {
  /**
   * Adds links to the documents `selector` matches until disposed. The links of every matching provider are merged;
   * where links overlap, the provider of the higher `priority` wins (default 100, higher first; equal: registration
   * order).
   */
  registerDocumentLinkProvider(selector: DocumentSelector, provider: DocumentLinkProvider, options?: { priority?: number }): Disposable;
  /**
   * The links of `document` from every matching provider, merged (see `registerDocumentLinkProvider`), in text order
   * (VS Code's `vscode.executeLinkProvider`). Each is resolved by `resolveDocumentLink`.
   */
  provideDocumentLinks(document: TextDocument): readonly DocumentLink[];
  /** A link `provideDocumentLinks` gave (or this resolved), with what its provider fills in: target, tooltip, command. */
  resolveDocumentLink(link: DocumentLink): DocumentLink;
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
   * Takes part in every copy from and paste into the documents `selector` matches until disposed, wherever an editor
   * runs the providers (the clipboard extension: the Visual and the Source editors). A paste offers the edits of every
   * provider of `metadata.providedPasteEditKinds` whose `pasteMimeTypes` the clipboard has, by the providers'
   * `priority`, as alternatives: it goes in as the first by `yieldTo` (`sortPasteEdits`), the others may replace it.
   * Whichever goes in, every provider's `resolveDocumentPasteEdit` changes it first, in the same order; additional
   * edits that overlap the pasted ranges or an earlier edit are dropped.
   */
  registerDocumentPasteEditProvider(selector: DocumentSelector, provider: DocumentPasteEditProvider, metadata: DocumentPasteProviderMetadata): Disposable;
  /** On a copy or cut of `copied` from `document`: every matching paste edit provider adds to the clipboard `dataTransfer`. */
  prepareDocumentPaste(document: TextDocument, copied: string, dataTransfer: DataTransfer): void;
  /**
   * The edits the providers give for a paste of the clipboard `dataTransfer` into `document` in place of `ranges` (VS
   * Code's paste edit providers asked by the editor), by priority: of each provider that reads a type the clipboard
   * has, the edits of the kinds it declared. Unsorted by `yieldTo` (see `sortPasteEdits`).
   */
  provideDocumentPasteEdits(document: TextDocument, ranges: readonly SourceRange[], dataTransfer: DataTransfer): readonly DocumentPasteEdit[];
  /**
   * `edit` as it goes into `document` in place of `ranges`: as the providers resolve it, by priority, each given the
   * edit the ones before left; additional edits that overlap the ranges or an earlier edit are left out.
   */
  resolveDocumentPasteEdit(edit: DocumentPasteEdit, document: TextDocument, ranges: readonly SourceRange[], dataTransfer: DataTransfer): DocumentPasteEdit;
}

/** What a paste edit provider gives (VS Code's DocumentPasteProviderMetadata). */
export interface DocumentPasteProviderMetadata {
  /** The kinds of the edits `provideDocumentPasteEdits` gives (`typst.markdown`); none: it only resolves edits. */
  readonly providedPasteEditKinds: readonly string[];
  /** The clipboard types it reads (`text/html`, `text/*`); default: any. */
  readonly pasteMimeTypes?: readonly string[];
  /**
   * Where its edits are offered and it resolves, among the providers (not VS Code's): higher first (default 100; equal:
   * registration order). The clipboard extension's own (Typst, code, plain text) are 0: after the others'.
   */
  readonly priority?: number;
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
   * What it is, dot-separated from the general to the specific (VS Code's paste edit kinds). The clipboard extension's:
   * `typst` (the text as Typst), `typst.code` (a code block), `text.plain` (plain characters, escaped), `typst.html` (the
   * HTML, read with the Visual editor's schema).
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

export { sortPasteEdits, LanguagesHost } from './languages-impl';
