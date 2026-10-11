// The preview-sync extension: the editor and the preview in step, both ways. The preview follows the cursor (with a
// "Follow cursor" switch in its toolbar, remembered per viewer), and a click in the preview selects its source.
// Entry of extensions/preview-sync/. See docs/architecture/preview.typ.
// Why an extension: the preview host only offers the mechanism (`reveal`, hit-testing, `onDidClickPage` and
// `clearClickHighlight`), the workbench the selection (`onDidChangeTextEditorSelection`) and `open`; when to follow,
// where a click leads and how long its outline stays is policy. Without this extension the preview neither follows
// nor jumps.
import { Disposable } from '../../core/disposable/disposable';
import type { SourceRange } from '../../core/typst-document/typst-document';
import type { Memento, TypstExtension } from '../../hosts/workbench/workbench';
import type { Workspace } from '../../hosts/workspace/workspace';
import { followCursor } from './preview/preview';
import css from './preview-sync.css?inline';

/**
 * While "Follow cursor" is on, the preview scrolls to the selection the user moves in the shown file (when it is
 * off-screen); switching it on goes there at once. It starts as the setting `previewSync.followCursor` says if the
 * host set it, else as this viewer chose last, else on; the host setting it later switches it. A click on text in
 * the preview opens its file with the clicked range selected (package files are no project files: ignored); the
 * preview's outline of the click goes with the next edit or once the selection moves away from that range.
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
              'Whether the preview follows the cursor ("Follow cursor": it scrolls to the text being edited or selected). Unset: what this viewer chose last (kept across visits), else on.',
          },
        },
      },
    },
    activate({ project, globalState, window, workspace, workbench, preview, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      let following = configuredFollow(workspace, globalState);
      // The outline of a click in the preview marks what the click selected, while that is what the user looks at:
      // it goes with the first edit (in any view) or once the selection moves elsewhere, as the Source view's own
      // reveal highlight does; otherwise it would stay behind on outdated text.
      let clicked: SourceRange | null = null;
      const clearClick = () => {
        if (!clicked) return;
        clicked = null;
        preview.clearClickHighlight();
      };
      const revealSelection = () => {
        const editor = window.activeTextEditor;
        const path = editor && project.pathOf(editor.document);
        if (path) preview.reveal(path, editor.selection);
      };
      const onChange = (on: boolean) => {
        following = on;
        void globalState.update(FOLLOW_KEY, on);
        if (on) revealSelection();
      };
      // made anew to show a new state; its place stays (group + order)
      let toggle = preview.registerToolbarItem(followCursor({ on: following, onChange }), { group: '1_sync', order: 10 });
      subscriptions.push(
        new Disposable(() => toggle.dispose()),
        workspace.onDidChangeConfiguration((event) => {
          if (!event.affectsConfiguration('previewSync.followCursor')) return;
          following = configuredFollow(workspace, globalState);
          toggle.dispose();
          toggle = preview.registerToolbarItem(followCursor({ on: following, onChange }), { group: '1_sync', order: 10 });
        }),
        // where the user works: the shown file's editor, focused (not a collaborator's edit in a hidden view)
        window.onDidChangeTextEditorSelection(({ textEditor }) => {
          if (clicked && !sameRange(textEditor.selection, clicked)) clearClick();
          if (following && textEditor === window.activeTextEditor && workbench.isEditorFocused()) revealSelection();
        }),
        preview.onDidClickPage((click) => {
          if (!project.document(click.path)) return;
          // opening selects the click's source: that selection is the click's, not a move away from it
          clicked = null;
          workbench.open(click.path, { selection: click });
          clicked = window.activeTextEditor?.selection ?? null;
        }),
        project.onDidChangeFile(clearClick),
      );
    },
  };
}

/** Where the viewer's last "Follow cursor" choice is kept (`globalState`). */
const FOLLOW_KEY = 'followCursor';

function sameRange(a: SourceRange, b: SourceRange): boolean {
  return a.from === b.from && a.to === b.to;
}

/** The host's value of `previewSync.followCursor`, else the viewer's last choice, else the default (on). */
function configuredFollow(workspace: Workspace, globalState: Memento): boolean {
  const setting = workspace.getConfiguration('previewSync').inspect<boolean>('followCursor');
  const chosen = globalState.get<unknown>(FOLLOW_KEY);
  return setting?.globalValue ?? (typeof chosen === 'boolean' ? chosen : undefined) ?? setting?.defaultValue ?? true;
}
