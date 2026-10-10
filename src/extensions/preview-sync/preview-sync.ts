// The preview-sync extension: the editor and the preview in step, both ways. The preview follows the cursor (with a
// "Follow cursor" switch in its toolbar, remembered per viewer), and a click in the preview selects its source.
// Entry of extensions/preview-sync/. See ARCHITECTURE.md, "Preview".
// Why an extension: the preview host only offers the mechanism (`reveal`, hit-testing and `onDidClickPage`), the
// workbench the selection (`onDidChangeTextEditorSelection`) and `open`; when to follow and where a click leads is
// policy. Without this extension the preview neither follows nor jumps.
import { ProjectPath } from '../../core/paths/paths';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { followCursor } from './preview/preview';
import css from './preview-sync.css?inline';

export interface PreviewSyncOptions {
  /** Whether the preview starts following the cursor; default: what this viewer chose last (localStorage), else on. */
  followCursor?: boolean;
}

/**
 * While "Follow cursor" is on, the preview scrolls to the selection the user moves in the shown file (when it is
 * off-screen); switching it on goes there at once. A click on text in the preview opens its file with the clicked
 * range selected (package files are no project files: ignored).
 */
export function previewSync(options: PreviewSyncOptions = {}): TypstExtension {
  return {
    id: 'preview-sync',
    activate({ project, workbench, preview, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      let following = options.followCursor ?? rememberedFollow() ?? true;
      const revealSelection = () => {
        const editor = workbench.activeTextEditor;
        const path = editor && project.pathOf(editor.document);
        if (path) preview.reveal(path, editor.selection.from, editor.selection.to);
      };
      const onChange = (on: boolean) => {
        following = on;
        rememberFollow(on);
        if (on) revealSelection();
      };
      subscriptions.push(
        preview.registerToolbarItem(followCursor({ on: following, onChange })),
        // where the user works: the shown file's editor, focused (not a collaborator's edit in a hidden view)
        workbench.onDidChangeTextEditorSelection(({ textEditor }) => {
          if (following && textEditor === workbench.activeTextEditor && workbench.isEditorFocused()) revealSelection();
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
