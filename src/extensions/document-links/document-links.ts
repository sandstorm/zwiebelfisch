import { findFilePaths } from '../../core/typst-syntax/typst-syntax';
import { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { Extension, ExtensionContext } from '../../hosts/extension-host/extension-host';
import type { DocumentLink, DocumentLinkProvider, TextDocument } from '../../hosts/languages/languages';
import css from './document-links.css?inline';
import type { LinkActions } from './followable-link';
import { LinkHover } from './link-hover';
import { linkExtension } from './source-editor/link-extension';
import { pictureLink, textLinks } from './visual-editor/text-links';

/**
 * Document links in every editor: the links of every provider (`languages.registerDocumentLinkProvider`) shown and
 * followed as VS Code's "Follow link" does, in every CodeMirror (the Source editors, the raw boxes' code, the text
 * files'), in the Visual editor's text (reference chips, link marks) and on raw boxes'
 * pictures (their Typst's first link). Hovered, a link shows its hint; ⌘/Ctrl+click or Alt+Enter follows it: a project
 * file opens (at the link's selection), a web or mail address in a new tab. Without it, no editor shows links.
 *
 * Its own provider: the file paths in Typst text (`#include "ch1.typ"`, `image("logo.png")`), resolved from the file
 * they are in. Such a link opens an existing file, or says the file is missing and, for a Typst file, offers to create
 * it: the command `documentLinks.createFile(path)` creates the file and opens it, or rejects saying why not.
 */
export function documentLinks(): Extension {
  return {
    id: 'document-links',
    activate(context) {
      const { project, commands, languages, workspace, window, sourceEditor, visualEditor, subscriptions } = context;
      const hover = new LinkHover(window.ownerDocument);
      const actions = linkActions(context, hover);
      const pathOf = (document: TypstDocument) => () => project.pathOf(document) ?? null;
      subscriptions.push(
        hover,
        window.registerStyleSheet(css),
        sourceEditor.registerCodeMirrorExtension({}, ({ languageId, path }) => linkExtension(actions, languageId, path)),
        visualEditor.registerTiptapExtension((editor) => textLinks(editor, actions, pathOf(editor.document))),
        visualEditor.registerRawBoxBehavior((box) => pictureLink(box, actions, pathOf(box.editor.document))),
        languages.registerDocumentLinkProvider({ language: 'typst' }, new FilePathLinks(project)),
        commands.registerCommand(CREATE_FILE, async (path: string) => {
          const target = ProjectPath.parse(path);
          if (!target) throw new Error(`Not a project path: ${path}`);
          const problem = await workspace.applyEdit({ kind: 'create', path: target, content: '' });
          if (problem !== null) throw new Error(problem);
          window.showDocument(target);
        }),
      );
    },
  };
}

/** Where the links come from (every provider, merged), where following one goes, and `hover` showing them. */
function linkActions({ languages, window, commands }: ExtensionContext, hover: LinkHover): LinkActions {
  return {
    provideDocumentLinks: (document) => languages.provideDocumentLinks(document),
    resolveDocumentLink: (link) => languages.resolveDocumentLink(link),
    open: (target, selection) => (target instanceof URL ? openExternal(window.ownerDocument, target) : window.showDocument(target, { selection })),
    executeCommand: (command, ...args) => commands.executeCommand(command, ...args),
    hoverLink: (event, hovered) => hover.move(event, hovered),
  };
}

/** Opens a web or mail address in a new tab, cut off from this page; any other scheme (`javascript:`) is ignored. */
function openExternal(doc: Document, url: URL): void {
  if (EXTERNAL_SCHEMES.has(url.protocol)) doc.defaultView?.open(url.href, '_blank', 'noopener');
}

/** The schemes of the external links the widget opens. */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** The file paths of a text as links; resolved, a link opens its file, or says it is missing (and offers to create a Typst file). */
class FilePathLinks implements DocumentLinkProvider {
  /** Where each link given out leads (null: out of the project). */
  readonly #targets = new WeakMap<DocumentLink, ProjectPath | null>();

  constructor(private readonly project: Project) {}

  provideDocumentLinks(document: TextDocument): DocumentLink[] {
    const { path } = document;
    return findFilePaths(document).map(({ path: reference, from, to }) => {
      const link: DocumentLink = { range: { from, to } };
      this.#targets.set(link, ProjectPath.resolve(path, reference));
      return link;
    });
  }

  resolveDocumentLink(link: DocumentLink): DocumentLink {
    const target = this.#targets.get(link);
    if (!target) return link;
    if (this.project.has(target)) return { ...link, target };
    const name = ProjectPath.displayName(target);
    const tooltip = `${name} is not in the project`;
    if (!ProjectPath.isTypst(target)) return { ...link, tooltip };
    return { ...link, tooltip, command: { title: `Create ${name}`, command: CREATE_FILE, arguments: [target] } };
  }
}

const CREATE_FILE = 'documentLinks.createFile';
