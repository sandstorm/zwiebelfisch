// The languages namespace of the extension API (VS Code's `languages`, as far as it is used): the document links of
// every registered DocumentLinkProvider whose selector matches a document, merged, and how CodeMirror editors show
// them (the Source editors, the code of the Visual editor's raw boxes, an extension's own editor). Entry of
// hosts/languages/. See docs/30_architecture/07_workbench.typ.
// Why providers: finding links is a feature's policy (which paths, what a missing file offers); showing and following
// them is the same in every view, so the views read every provider's links and know none of them. Why `languageId`:
// the host knows no language; whoever hands a text over says which language it is in.
import type { Extension } from '@codemirror/state';
import { Disposable } from '../../core/disposable/disposable';
import type { ProjectPath } from '../../core/paths/paths';
import type { SourceRange } from '../../core/typst-document/typst-document';
import type { Command } from '../commands/commands';
import css from './languages.css?inline';
import { linkExtension } from './link-extension';

/** The language features of texts as extensions use them (VS Code's `languages` namespace: document links). */
export interface Languages {
  /**
   * Adds links to the documents `selector` matches until disposed: the Source editors, the code of the Visual editor's
   * raw boxes and the text files' editor show them (Mod+click, Alt+Enter, hover). The links of every matching
   * provider are merged; where links overlap, the provider of the higher `priority` wins (default 100, higher first;
   * equal: registration order).
   */
  registerDocumentLinkProvider(selector: DocumentSelector, provider: DocumentLinkProvider, options?: { priority?: number }): Disposable;
  /**
   * The links of `document` from every matching provider, merged as the editors show them, in text order (VS Code's
   * `vscode.executeLinkProvider`), for an extension that shows links itself (an image box's path).
   */
  provideDocumentLinks(document: TextDocument): readonly DocumentLink[];
  /** `link` (from `provideDocumentLinks`) with what its provider fills in on demand: target, tooltip, command. */
  resolveDocumentLink(link: DocumentLink): DocumentLink;
  /**
   * Shows the links of a CodeMirror editor's text as the Source editors do, for an extension's own editor: the text is
   * in `languageId`; `path` is the file it is in, now (null: none, no links).
   */
  createDocumentLinksCodeMirrorExtension(languageId: string, path: () => ProjectPath | null): Extension;
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
  /** The project file following the link opens; absent until resolved, or when it leads to no file. */
  readonly target?: ProjectPath;
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

/** What following a link does, in the editor that shows it: the workbench's side of links. */
export interface LinkTargets {
  /** Shows a link's target. */
  open(target: ProjectPath): void;
  /** Runs a link's command (`commands.executeCommand`). */
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
}

/** The default `priority` of a provider (as for the Visual editor's contributions). */
const DEFAULT_PRIORITY = 100;

/**
 * The registered link providers. A text's links are those of every provider whose selector matches it; where links
 * of two providers overlap, the one of the higher `priority` wins (equal: the one registered first). Each link
 * remembers its provider, which resolves it on demand (`resolveDocumentLink`). `targets` is what following a link
 * does, in every editor that shows links.
 */
export class LanguagesHost implements Languages {
  readonly #providers: { selector: DocumentSelector; provider: DocumentLinkProvider; priority: number }[] = [];
  readonly #providerOf = new WeakMap<DocumentLink, DocumentLinkProvider>();

  /** The CSS of the links' hover (`.typst-file-link`), for the workbench to put where the widget renders. */
  readonly styleSheet: string = css;

  constructor(private readonly targets: LinkTargets) {}

  registerDocumentLinkProvider(selector: DocumentSelector, provider: DocumentLinkProvider, options: { priority?: number } = {}): Disposable {
    const entry = { selector, provider, priority: options.priority ?? DEFAULT_PRIORITY };
    this.#providers.push(entry);
    return new Disposable(() => {
      const index = this.#providers.indexOf(entry);
      if (index >= 0) this.#providers.splice(index, 1);
    });
  }

  provideDocumentLinks(document: TextDocument): DocumentLink[] {
    const accepted: DocumentLink[] = [];
    const matching = this.#providers.filter(({ selector }) => matches(selector, document));
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

  createDocumentLinksCodeMirrorExtension(languageId: string, path: () => ProjectPath | null): Extension {
    const actions = {
      ...this.targets,
      provideDocumentLinks: (document: TextDocument) => this.provideDocumentLinks(document),
      resolveDocumentLink: (link: DocumentLink) => this.resolveDocumentLink(link),
    };
    return linkExtension(actions, languageId, path);
  }
}

function matches(selector: DocumentSelector, document: TextDocument): boolean {
  const filters: readonly DocumentFilter[] = Array.isArray(selector) ? selector : [selector];
  return filters.some((filter) => filter.language === undefined || filter.language === document.languageId);
}

function overlap(a: DocumentLink, b: DocumentLink): boolean {
  return a.range.from < b.range.to && b.range.from < a.range.to;
}
