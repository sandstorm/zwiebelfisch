// The diagrams extension: `.drawio.png` files — PNGs with a diagrams.net diagram in them, so Typst shows them as
// images (`#image("flow.drawio.png")`) and diagrams.net edits them again — opened in diagrams.net's editor embedded
// in an iframe, saved as they change; "New diagram…"; "Edit diagram" on a box showing one. Entry of
// extensions/diagrams/. See docs/guide/features.typ.
// Why an extension: the editor is a custom editor (higher priority than the images' view of PNGs), the new-file
// entry a menu item, "Edit diagram" a box action, its document links come from whichever provider: the hosts' generic
// contribution points; the protocol (model/) is pure state, so it is tested without an iframe.
import { ProjectPath } from '../../core/paths/paths';
import { FileContent, type Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { Languages } from '../../hosts/languages/languages';
import type { CustomEditorProvider } from '../../hosts/window/window';
import type { ExtensionContext, TypstExtension } from '../../hosts/workbench/workbench';
import css from './diagrams.css?inline';
import { DIAGRAM_FILES, isDiagram } from './model/model';
import { editDiagramAction } from './visual-view/visual-view';
import { DiagramEditor } from './workbench/diagram-editor';
import { newDiagram } from './workbench/new-diagram';

/** The command behind "New diagram…" (optional argument: the file or folder it goes next to / into). */
const NEW_DIAGRAM = 'diagrams.newDiagram';
/** The setting `diagrams.editorUrl`'s default. */
const DIAGRAMS_NET = 'https://embed.diagrams.net/';
const SHOW_AS_IMAGE = 'Show as image';
/** The icon of diagram files (where views list files). */
const DIAGRAM_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="5" height="4" rx="1"/><rect x="9.5" y="10" width="5" height="4" rx="1"/><path d="M4 6v6h5.5"/></svg>';

/**
 * Diagrams (`*.drawio.png`) in the editing area: the custom editor `diagrams.editor` (priority 110, over the images'
 * `*.png`), diagrams.net from the setting `diagrams.editorUrl`, light or dark as the widget; every change is saved
 * (`workspace.applyEdit`, debounced; pending changes when the file is closed). Without the editor (offline) an
 * error message offers the picture. "New diagram…" (`diagrams.newDiagram`) in the menu `file/newFile`; "Edit diagram"
 * on Visual view boxes that show a diagram of the project.
 */
export function diagrams(): TypstExtension {
  return {
    id: 'diagrams',
    contributes: {
      configuration: {
        properties: {
          'diagrams.editorUrl': {
            type: 'string',
            default: DIAGRAMS_NET,
            description:
              'Where the diagram editor comes from: diagrams.net (default) or your own installation of the drawio web app (Apache-2.0), e.g. for use without internet access. Embed mode and its parameters are added.',
          },
        },
      },
    },
    activate(context) {
      const { project, commands, window, languages, workspace, workbench, visualView, subscriptions } = context;
      const editorUrl = () => workspace.getConfiguration('diagrams').get<string>('editorUrl', DIAGRAMS_NET);
      subscriptions.push(
        workbench.registerStyleSheet(css),
        window.registerCustomEditorProvider('diagrams.editor', diagramEditor(context, editorUrl), { filenamePattern: DIAGRAM_FILES, priority: 110, icon: DIAGRAM_ICON }),
        commands.registerCommand(NEW_DIAGRAM, (resource?: ProjectPath) => newDiagram(context, resource)),
        workbench.registerMenuItem('file/newFile', { command: NEW_DIAGRAM, title: 'New diagram…', group: 'navigation', order: 16 }),
        visualView.registerBoxAction(editDiagramAction(diagramIn(project, languages), (path) => workbench.open(path))),
      );
    },
  };
}

/** A DiagramEditor per opened diagram, saving into the project; a refused save is an error message. */
function diagramEditor({ window, workspace, workbench }: ExtensionContext, editorUrl: () => string): CustomEditorProvider {
  return {
    resolveCustomEditor({ path, content }, panel) {
      const editor = new DiagramEditor(panel.element, {
        path,
        content: FileContent.bytes(content),
        editorUrl: editorUrl(),
        save: (png) =>
          void workspace.applyEdit({ kind: 'update', path, content: png }).then((problem) => problem && window.showErrorMessage(`${ProjectPath.displayName(path)} not saved: ${problem}`)),
        failed: async () =>
          (await window.showErrorMessage(`The diagram editor could not be loaded from ${new URL(editorUrl(), workbench.ownerDocument.baseURI).host}. Are you offline?`, SHOW_AS_IMAGE)) === SHOW_AS_IMAGE,
      });
      panel.onDidDispose(() => editor.dispose());
    },
  };
}

/** The diagram of the project a box's Typst names: the first document link (any provider's) that leads to one. */
function diagramIn(project: Project, languages: Languages): (src: string, document: TypstDocument) => ProjectPath | null {
  return (src, document) => {
    const file = project.pathOf(document);
    if (!file) return null;
    // the providers read Typst markup; a figure's body is written in code (`image(..)`, no `#`)
    const markup = src.startsWith('#') ? src : `#${src}`;
    for (const link of languages.provideDocumentLinks({ path: file, text: markup })) {
      const target = languages.resolveDocumentLink(link).target;
      if (target && isDiagram(target)) return target;
    }
    return null;
  };
}
