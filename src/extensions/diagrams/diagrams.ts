// The diagrams extension: `.drawio.png` files — PNGs with a diagrams.net diagram in them, so Typst shows them as
// images (`#image("flow.drawio.png")`) and diagrams.net edits them again — opened in diagrams.net's editor embedded
// in an iframe, saved as they change; "New diagram…"; "Edit diagram" on a box showing one. Entry of
// extensions/diagrams/. See ARCHITECTURE.md, "Diagrams".
// Why an extension: the editor is a custom editor (higher priority than the images' view of PNGs), the new-file
// entry a menu item, "Edit diagram" a box action, its document links come from whichever provider: the hosts' generic
// contribution points; the protocol (model/) is pure state, so it is tested without an iframe.
import { ProjectPath } from '../../core/paths/paths';
import type { FileContent, Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { CustomEditorProvider, TypstExtension, Workbench } from '../../hosts/workbench/workbench';
import css from './diagrams.css?inline';
import { DIAGRAM_FILES, isDiagram } from './model/model';
import { editDiagramAction } from './visual-view/visual-view';
import { DiagramEditor, newDiagram } from './workbench/workbench';

/** The command behind "New diagram…" (optional argument: the file or folder it goes next to / into). */
const NEW_DIAGRAM = 'diagrams.newDiagram';
const SHOW_AS_IMAGE = 'Show as image';

/**
 * Diagrams (`*.drawio.png`) in the editing area: the custom editor `diagrams.editor` (priority 110, over the images'
 * `*.png`), diagrams.net from the setting `diagrams.editorUrl`, light or dark as the widget; every change is saved
 * (`Workbench.applyChange`, debounced; pending changes when the file is closed). Without the editor (offline) an
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
            default: 'https://embed.diagrams.net/',
            description:
              'Where the diagram editor comes from: diagrams.net (default) or your own installation of the drawio web app (Apache-2.0), e.g. for use without internet access. Embed mode and its parameters are added.',
          },
        },
      },
    },
    activate({ project, workspace, workbench, visualView, subscriptions }) {
      const editorUrl = () => workspace.getConfiguration('diagrams').get<string>('editorUrl', 'https://embed.diagrams.net/');
      subscriptions.push(
        workbench.registerStyleSheet(css),
        workbench.registerCustomEditorProvider('diagrams.editor', diagramEditor(workbench, editorUrl), { filenamePattern: DIAGRAM_FILES, priority: 110 }),
        workbench.registerCommand(NEW_DIAGRAM, (resource?: ProjectPath) => newDiagram(project, workbench, resource)),
        workbench.registerMenuItem('file/newFile', { command: NEW_DIAGRAM, title: 'New diagram…', group: 'navigation', order: 16 }),
        visualView.registerBoxAction(editDiagramAction(diagramIn(project, workbench), (path) => workbench.open(path))),
      );
    },
  };
}

/** A DiagramEditor per opened diagram, saving into the project; a refused save is an error message. */
function diagramEditor(workbench: Workbench, editorUrl: () => string): CustomEditorProvider {
  return {
    resolveCustomEditor({ path, content }, panel) {
      const editor = new DiagramEditor(panel.element, {
        path,
        content: bytes(content),
        editorUrl: editorUrl(),
        save: (png) =>
          void workbench.applyChange({ kind: 'update', path, content: png }).then((problem) => problem && workbench.showErrorMessage(`${ProjectPath.displayName(path)} not saved: ${problem}`)),
        failed: async () =>
          (await workbench.showErrorMessage(`The diagram editor could not be loaded from ${new URL(editorUrl(), workbench.ownerDocument.baseURI).host}. Are you offline?`, SHOW_AS_IMAGE)) === SHOW_AS_IMAGE,
      });
      panel.onDidDispose(() => editor.dispose());
    },
  };
}

/** The diagram of the project a box's Typst names: the first document link (any provider's) that leads to one. */
function diagramIn(project: Project, workbench: Workbench): (src: string, document: TypstDocument) => ProjectPath | null {
  return (src, document) => {
    const file = project.pathOf(document);
    if (!file) return null;
    for (const link of workbench.provideDocumentLinks({ path: file, text: src })) {
      const target = workbench.resolveDocumentLink(link).target;
      if (target && isDiagram(target)) return target;
    }
    return null;
  };
}

function bytes(content: FileContent): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}
