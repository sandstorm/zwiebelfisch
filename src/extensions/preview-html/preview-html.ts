import { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { HtmlView } from './preview/html-view';
import css from './preview-html.css?inline';

/**
 * The preview as HTML: the renderer `html`, Typst's HTML export of the document, page by page.
 *
 * The preview host compiles what the active renderer needs and hands it over; this renderer shows the files of
 * Typst's bundle export (`document(..)` and `asset(..)`; a document without `document(..)` is one `index.html`). One
 * page at a time, in a sandboxed frame, changed in place after every compile so it keeps its scroll position. Links
 * between the pages switch the page; links to URLs open a new tab; images, style sheets and fonts come from memory (a
 * path the bundle has no file for is looked up among the project's files, as a static site build copies fonts next
 * to the pages). The cursor (the preview's `reveal`, which previewSync calls) shows the page holding the element its
 * text produced, scrolled to it; text on every page or on none keeps the page.
 *
 * Which renderer is shown, and the switch for it, is the preview controls' (they list every renderer). No source sync
 * from a click in the page yet. See docs/40_architecture/06_preview.typ.
 */
export function previewHtml(): TypstExtension {
  return {
    id: 'preview-html',
    activate({ project, preview, workbench, subscriptions }) {
      subscriptions.push(
        workbench.registerStyleSheet(css),
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
