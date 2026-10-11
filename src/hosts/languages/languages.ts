// The languages namespace of the extension API (VS Code's `languages`, as far as Typst text needs it): the document
// links of every registered DocumentLinkProvider, merged, and how CodeMirror editors show them (the Source views and
// the code of the Visual view's raw boxes get `editorExtension`). Entry of hosts/languages/. See ARCHITECTURE.md,
// "File links".
// Why providers: finding links is a feature's policy (which paths, what a missing file offers); showing and following
// them is the same in every view, so the views read every provider's links and know none of them.
import type { Extension } from '@codemirror/state';
import { Disposable } from '../../core/disposable/disposable';
import type { ProjectPath } from '../../core/paths/paths';
import type { Command } from '../commands/commands';
import css from './languages.css?inline';
import { linkExtension } from './link-extension';

/** The language features of Typst text as extensions use them (VS Code's `languages` namespace: document links). */
export interface Languages {
  /**
   * Adds links to Typst text until disposed: the Source views and the code of the Visual view's raw boxes show
   * them (Mod+click, Alt+Enter, hover). The links of every provider are merged; where links overlap, the provider
   * of the higher `priority` wins (default 100, higher first; equal: registration order).
   */
  registerDocumentLinkProvider(provider: DocumentLinkProvider, options?: { priority?: number }): Disposable;
  /**
   * The links of `document` from every provider, merged as the views show them, in text order (VS Code's
   * `vscode.executeLinkProvider`), for an extension that shows links itself (an image box's path).
   */
  provideDocumentLinks(document: TextDocument): readonly DocumentLink[];
  /** `link` (from `provideDocumentLinks`) with what its provider fills in on demand: target, tooltip, command. */
  resolveDocumentLink(link: DocumentLink): DocumentLink;
}

/**
 * The Typst text a link provider reads (VS Code's TextDocument, as far as links need it): a whole file's, or the
 * code of one raw box in it.
 */
export interface TextDocument {
  /** The file the text is in: relative paths in it resolve from here. */
  readonly path: ProjectPath;
  readonly text: string;
}

/** A range of a text that leads somewhere (VS Code's DocumentLink). */
export interface DocumentLink {
  /** Where the link is, as offsets in the text given to the provider. */
  readonly range: { readonly from: number; readonly to: number };
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

/** Finds the links in Typst text (VS Code's DocumentLinkProvider). */
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

/** The default `priority` of a provider (as for the Visual view's contributions). */
const DEFAULT_PRIORITY = 100;

/**
 * The registered link providers. A text's links are those of every provider; where links of two providers overlap,
 * the one of the higher `priority` wins (equal: the one registered first). Each link remembers its provider, which
 * resolves it on demand (`resolveDocumentLink`).
 */
export class LanguagesHost implements Languages {
  readonly #providers: { provider: DocumentLinkProvider; priority: number }[] = [];
  readonly #providerOf = new WeakMap<DocumentLink, DocumentLinkProvider>();

  /** The CSS of the links' hover (`.typst-file-link`), for the workbench to put where the widget renders. */
  readonly styleSheet: string = css;

  registerDocumentLinkProvider(provider: DocumentLinkProvider, options: { priority?: number } = {}): Disposable {
    const entry = { provider, priority: options.priority ?? DEFAULT_PRIORITY };
    this.#providers.push(entry);
    return new Disposable(() => {
      const index = this.#providers.indexOf(entry);
      if (index >= 0) this.#providers.splice(index, 1);
    });
  }

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

  resolveDocumentLink(link: DocumentLink): DocumentLink {
    const provider = this.#providerOf.get(link);
    const resolved = provider?.resolveDocumentLink?.(link) ?? link;
    if (provider) this.#providerOf.set(resolved, provider);
    return resolved;
  }

  /**
   * Makes the links of a CodeMirror editor's text navigable (see `linkExtension`): `path` is the file the text is in,
   * now (null: none, no links); `targets` does what following one does.
   */
  editorExtension(targets: LinkTargets, path: () => ProjectPath | null): Extension {
    return linkExtension({ ...targets, provideDocumentLinks: (document) => this.provideDocumentLinks(document), resolveDocumentLink: (link) => this.resolveDocumentLink(link) }, path);
  }
}

function overlap(a: DocumentLink, b: DocumentLink): boolean {
  return a.range.from < b.range.to && b.range.from < a.range.to;
}
