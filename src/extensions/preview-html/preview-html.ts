import { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { HtmlView } from './preview/html-view';
import css from './preview-html.css?inline';

/**
 * The preview as HTML: the renderer `html` ("HTML"), Typst's HTML export of the document, one page at a time.
 *
 * - The page is updated in place after every compile, so it keeps its scroll position.
 * - Its scripts do not run (a sandboxed frame).
 * - Links between the bundle's pages switch the page; links to URLs open a new tab.
 * - Files the bundle has no file for are looked up among the project's files (fonts next to the pages).
 * - The cursor's `reveal` shows the page holding the element its text produced, scrolled to it.
 */
export function previewHtml(): Extension {
  return {
    id: 'preview-html',
    activate({ project, preview, window, subscriptions }) {
      subscriptions.push(
        window.registerStyleSheet(css),
        preview.registerRenderer({ id: 'html', label: 'HTML', output: 'html', create: (container) => new HtmlView(container, projectBytes(project)) }),
      );
    },
  };
}

/** The bytes of the project file at a bundle path, if there is one; text encoded once per text. */
function projectBytes(project: Project): (path: string) => Uint8Array | null {
  const encoded = new Map<string, { text: string; bytes: Uint8Array }>();
  return (path) => {
    const projectPath = ProjectPath.parse(`/${path}`);
    const content = projectPath && project.content(projectPath);
    if (content === undefined || content === null) return null;
    if (typeof content !== 'string') return content;
    const known = encoded.get(path);
    if (known?.text === content) return known.bytes;
    const bytes = new TextEncoder().encode(content);
    encoded.set(path, { text: content, bytes });
    return bytes;
  };
}
