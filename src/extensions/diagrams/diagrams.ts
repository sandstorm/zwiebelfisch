// The diagrams extension. Entry of extensions/diagrams/. See docs/10_guide/02_features.typ.
import { ProjectPath } from '../../core/paths/paths';
import { FileContent, type Project } from '../../core/project/project';
import { findFilePaths } from '../../core/typst-syntax/typst-syntax';
import type { DocumentLinkProvider } from '../../hosts/languages/languages';
import type { CustomEditorProvider } from '../../hosts/window/window';
import type { ExtensionContext, TypstExtension } from '../../hosts/workbench/workbench';
import css from './diagrams.css?inline';
import { DIAGRAM_EDITOR, DIAGRAM_FILES, isDiagram } from './model/model';
import { insertDiagram } from './visual-editor/insert-diagram';
import { DiagramEditor } from './workbench/diagram-editor';
import { newDiagram } from './workbench/new-diagram';

/**
 * Diagrams (`*.drawio.png`) in the editing area: the custom editor `diagrams.editor` (priority 110, over the images'
 * `*.png`), diagrams.net from the setting `diagrams.editorUrl`, light or dark as the widget; every change is saved
 * (`workspace.applyEdit`, debounced; pending changes when the file is closed). Without the editor (offline) an
 * error message offers the picture. "New diagram…" (`diagrams.newDiagram`) in the menu `file/newFile`; "Insert
 * diagram" in the Visual editor's Insert menu; the paths of the project's diagrams in Typst as links "Edit diagram"
 * (priority 110, over the plain file links), so ⌘/Ctrl+click on a box showing one (or on its path) opens it.
 *
 * `.drawio.png` files — PNGs with a diagrams.net diagram in them, so Typst shows them as images
 * (`#image("flow.drawio.png")`) and diagrams.net edits them again — opened in diagrams.net's editor embedded in an
 * iframe, saved as they change; "New diagram…"; "Insert diagram" (a new one as a figure in the text); "Edit diagram"
 * (⌘/Ctrl+click) on a box showing one.
 *
 * Why an extension: the editor is a custom editor (higher priority than the images' editor of PNGs), the new-file entry a
 * menu item, "Insert diagram" a toolbar item, "Edit diagram" a document link (which the Visual editor's boxes follow
 * from their picture): the hosts' generic contribution points; the protocol (model/) is pure state, so it is tested
 * without an iframe.
 */
export function diagrams(): TypstExtension {
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
      const { project, commands, window, languages, workspace, workbench, visualEditor, subscriptions } = context;
      const editorUrl = () => workspace.getConfiguration('diagrams').get<string>('editorUrl', DIAGRAMS_NET);
      subscriptions.push(
        workbench.registerStyleSheet(css),
        window.registerCustomEditorProvider(DIAGRAM_EDITOR, diagramEditor(context, editorUrl), { filenamePattern: DIAGRAM_FILES, displayName: 'Diagram', priority: 110, icon: DIAGRAM_ICON }),
        commands.registerCommand(NEW_DIAGRAM, (resource?: ProjectPath) => newDiagram(context, resource)),
        workbench.registerMenuItem('file/newFile', { command: NEW_DIAGRAM, title: 'New diagram…', group: 'navigation', order: 16 }),
        visualEditor.registerToolbarItem(insertDiagram(context)),
        languages.registerDocumentLinkProvider({ language: 'typst' }, diagramLinks(project), { priority: 110 }),
      );
    },
  };
}

/** The command behind "New diagram…" (optional argument: the file or folder it goes next to / into). */
const NEW_DIAGRAM = 'diagrams.newDiagram';
/** The setting `diagrams.editorUrl`'s default. */
const DIAGRAMS_NET = 'https://embed.diagrams.net/';

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

const SHOW_AS_IMAGE = 'Show as image';
/** The icon of diagram files (where side panels list files). */
const DIAGRAM_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="5" height="4" rx="1"/><rect x="9.5" y="10" width="5" height="4" rx="1"/><path d="M4 6v6h5.5"/></svg>';

/**
 * The paths of the project's diagrams in Typst text as links titled "Edit diagram"; following one opens the diagram
 * in its editor (diagrams.net, unless the user switched diagrams to the image preview).
 */
function diagramLinks(project: Pick<Project, 'has'>): DocumentLinkProvider {
  return {
    provideDocumentLinks: ({ path, text }) =>
      findFilePaths(text).flatMap(({ path: reference, from, to }) => {
        const target = ProjectPath.resolve(path, reference);
        return target && isDiagram(target) && project.has(target) ? [{ range: { from, to }, target, tooltip: 'Edit diagram' }] : [];
      }),
  };
}
