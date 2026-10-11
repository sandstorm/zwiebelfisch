// The preview-sync extension: the editor and the preview in step, both ways. The preview follows the cursor (with a
// "Follow cursor" switch in its toolbar, remembered per viewer), and a click in the preview selects its source.
// Entry of extensions/preview-sync/. See ARCHITECTURE.md, "Preview".
// Why an extension: the preview host only offers the mechanism (`reveal`, hit-testing and `onDidClickPage`), the
// workbench the selection (`onDidChangeTextEditorSelection`) and `open`; when to follow and where a click leads is
// policy. Without this extension the preview neither follows nor jumps.
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import type { Workspace } from '../../hosts/workspace/workspace';
import { followCursor } from './preview/preview';
import css from './preview-sync.css?inline';

/**
 * While "Follow cursor" is on, the preview scrolls to the selection the user moves in the shown file (when it is
 * off-screen); switching it on goes there at once. It starts as the setting `previewSync.followCursor` says if the
 * host set it, else as this viewer chose last, else on; the host setting it later switches it. A click on text in
 * the preview opens its file with the clicked range selected (package files are no project files: ignored).
 */
export function previewSync(): TypstExtension {
  return {
    id: 'preview-sync',
    contributes: {
      configuration: {
        properties: {
          'previewSync.followCursor': {
            type: 'boolean',
            default: true,
            description:
              'Whether the preview follows the cursor ("Follow cursor": it scrolls to the text being edited or selected). Unset: what this viewer chose last (localStorage), else on.',
          },
        },
      },
    },
    activate({ project, window, workspace, workbench, preview, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      let following = configuredFollow(workspace);
      const revealSelection = () => {
        const editor = window.activeTextEditor;
        const path = editor && project.pathOf(editor.document);
        if (path) preview.reveal(path, editor.selection.from, editor.selection.to);
      };
      const onChange = (on: boolean) => {
        following = on;
        rememberFollow(on);
        if (on) revealSelection();
      };
      // made anew to show a new state; its place stays (group + order)
      let toggle = preview.registerToolbarItem(followCursor({ on: following, onChange }), { group: '1_sync', order: 10 });
      subscriptions.push(
        new Disposable(() => toggle.dispose()),
        workspace.onDidChangeConfiguration((event) => {
          if (!event.affectsConfiguration('previewSync.followCursor')) return;
          following = configuredFollow(workspace);
          toggle.dispose();
          toggle = preview.registerToolbarItem(followCursor({ on: following, onChange }), { group: '1_sync', order: 10 });
        }),
        // where the user works: the shown file's editor, focused (not a collaborator's edit in a hidden view)
        window.onDidChangeTextEditorSelection(({ textEditor }) => {
          if (following && textEditor === window.activeTextEditor && workbench.isEditorFocused()) revealSelection();
        }),
        preview.onDidClickPage((click) => {
          const path = ProjectPath.parse(click.path);
          if (path && project.document(path)) workbench.open(path, { selection: click });
        }),
      );
    },
  };
}

const FOLLOW_KEY = 'typst-editor:follow-cursor';

/** The host's value of `previewSync.followCursor`, else the viewer's last choice, else the default (on). */
function configuredFollow(workspace: Workspace): boolean {
  const setting = workspace.getConfiguration('previewSync').inspect<boolean>('followCursor');
  return setting?.globalValue ?? rememberedFollow() ?? setting?.defaultValue ?? true;
}

/** The viewer's last "Follow cursor" choice, if storage has one (storage may be unavailable). */
function rememberedFollow(): boolean | null {
  try {
    const stored = localStorage.getItem(FOLLOW_KEY);
    return stored === null ? null : stored === 'true';
  } catch {
    return null;
  }
}

function rememberFollow(on: boolean): void {
  try {
    localStorage.setItem(FOLLOW_KEY, String(on));
  } catch {
    // private window, blocked storage: the choice lasts for this page only
  }
}
