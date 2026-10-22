import { ProjectPath } from '../../core/paths/paths';
import { FileContent, type Project } from '../../core/project/project';
import { findFilePaths } from '../../core/typst-syntax/typst-syntax';
import type { DocumentDropEditProvider, DocumentLinkProvider } from '../../hosts/languages/languages';
import type { EditorProvider } from '../../hosts/window/window';
import type { ExtensionContext, Extension } from '../../hosts/extension-host/extension-host';
import css from './diagrams.css?inline';
import { DIAGRAM_EDITOR, DIAGRAM_FILES, diagramFigure, isDiagram } from './model/model';
import { registerInsertDiagram } from './visual-editor/insert-diagram';
import { DiagramEditor } from './window/diagram-editor';
import { newDiagram } from './window/new-diagram';

/**
 * Diagrams in Typst documents, drawn in diagrams.net. A diagram is a `.drawio.png`: a PNG with the diagram's XML
 * inside, so Typst shows it as an image (`#image("flow.drawio.png")`) and diagrams.net edits it again. Adds:
 * - the editor of diagrams: diagrams.net from the setting `diagrams.editorUrl`, saving every change; offline, it offers
 *   the picture instead
 * - "New diagram…" in the menu `files/new` and "Insert diagram" in the Visual editor's Insert menu
 * - a diagram dropped into the text becomes a figure
 * - "Edit diagram" links on diagram paths, so ⌘/Ctrl+click opens the diagram
 *
 * Each of these wins over what the images extension and plain file links do with the same file (priority 110).
 */
export function diagrams(): Extension {
  return {
    id: 'diagrams',
    contributes: {
      commands: [{ command: NEW_DIAGRAM, title: 'New diagram…', category: 'Diagrams' }],
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
      const { project, commands, window, languages, workspace, subscriptions } = context;
      const editorUrl = () => workspace.getConfiguration('diagrams').get<string>('editorUrl', DIAGRAMS_NET);
      subscriptions.push(
        window.registerStyleSheet(css),
        window.registerEditorProvider(DIAGRAM_EDITOR, diagramEditor(context, editorUrl), { filenamePattern: DIAGRAM_FILES, displayName: 'Diagram', priority: 110, icon: DIAGRAM_ICON }),
        commands.registerCommand(NEW_DIAGRAM, (resource?: ProjectPath) => newDiagram(context, resource)),
        window.registerMenuItem('files/new', { command: NEW_DIAGRAM, group: 'navigation', order: 16 }),
        registerInsertDiagram(context),
        languages.registerDocumentLinkProvider({ language: 'typst' }, diagramLinks(project), { priority: 110 }),
        languages.registerDocumentDropEditProvider({ language: 'typst' }, diagramDrops, { priority: 110 }),
      );
    },
  };
}

/** A diagram dropped into a Typst file: its figure, as "Insert diagram" writes it. */
const diagramDrops: DocumentDropEditProvider = {
  provideDocumentDropEdits: ({ path }, _position, file) => (isDiagram(file) ? { insertText: diagramFigure(ProjectPath.referenceTo(path, file)) } : null),
};

/** The command behind "New diagram…" (optional argument: the file or folder it goes next to / into). */
const NEW_DIAGRAM = 'diagrams.newDiagram';
/** The setting `diagrams.editorUrl`'s default. */
const DIAGRAMS_NET = 'https://embed.diagrams.net/';

/** A DiagramEditor per opened diagram, saving into the project; a refused save is an error message. */
function diagramEditor({ window, workspace }: ExtensionContext, editorUrl: () => string): EditorProvider {
  return {
    resolveEditor({ path, content }, panel) {
      const editor = new DiagramEditor(panel.element, {
        path,
        content: FileContent.bytes(content),
        editorUrl: editorUrl(),
        save: (png) =>
          void workspace.applyEdit({ kind: 'update', path, content: png }).then((problem) => problem && window.showErrorMessage(`${ProjectPath.displayName(path)} not saved: ${problem}`)),
        failed: async () =>
          (await window.showErrorMessage(`The diagram editor could not be loaded from ${new URL(editorUrl(), window.ownerDocument.baseURI).host}. Are you offline?`, SHOW_AS_IMAGE)) === SHOW_AS_IMAGE,
      });
      panel.onDidDispose(() => editor.dispose());
    },
  };
}

const SHOW_AS_IMAGE = 'Show as image';
/** The icon of diagram files (where side panels list files). */
const DIAGRAM_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="5" height="4" rx="1"/><rect x="9.5" y="10" width="5" height="4" rx="1"/><path d="M4 6v6h5.5"/></svg>';

/**
 * The paths of the project's diagrams in Typst text as links titled "Edit diagram"; following one opens the diagram
 * in its editor (diagrams.net, unless the user switched diagrams to the image preview).
 */
function diagramLinks(project: Pick<Project, 'has'>): DocumentLinkProvider {
  return {
    provideDocumentLinks: (document) =>
      findFilePaths(document).flatMap(({ path: reference, from, to }) => {
        const target = ProjectPath.resolve(document.path, reference);
        return target && isDiagram(target) && project.has(target) ? [{ range: { from, to }, target, tooltip: 'Edit diagram' }] : [];
      }),
  };
}
