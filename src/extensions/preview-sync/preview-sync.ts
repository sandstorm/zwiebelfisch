import { Disposable } from '../../core/disposable/disposable';
import type { SourceRange } from '../../core/typst-document/typst-document';
import type { ProjectPath } from '../../core/paths/paths';
import type { PreviewContributions } from '../../hosts/preview/preview';
import type { Memento, Extension } from '../../hosts/workbench/workbench';
import type { Workspace } from '../../hosts/workspace/workspace';
import { followCursor } from './preview/preview';
import css from './preview-sync.css?inline';

/**
 * Keeps the editor and the preview in step, both ways:
 * - Follow cursor: the preview scrolls to the selection of the focused editor. A switch in the preview's toolbar turns
 *   it on and off; it starts as the setting `previewSync.followCursor` says, else as this viewer chose last, else on.
 * - Shading: while `previewSync.highlightSelection` is on (the default), the text selected in the shown file is shaded
 *   in the preview, a moment after the selection settles.
 * - Click: a click on text in the preview opens its file with that range selected (files outside the project are
 *   ignored). The click stays outlined until the next edit or until the selection moves away.
 */
export function previewSync(): Extension {
  return {
    id: 'preview-sync',
    contributes,
    activate({ project, globalState, window, workspace, workbench, preview, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      let following = configuredFollow(workspace, globalState);
      // The outline of a click in the preview marks what the click selected, while that is what the user looks at:
      // it goes with the first edit (in any editor) or once the selection moves elsewhere, as the Source editor's own
      // reveal highlight does; otherwise it would stay behind on outdated text.
      let clicked: SourceRange | null = null;
      const clearClick = () => {
        if (!clicked) return;
        clicked = null;
        preview.clearClickHighlight();
      };
      const highlight = new SelectionShading(preview, () => {
        const editor = window.activeTextEditor;
        const path = editor && project.pathOf(editor.document);
        if (!editor || !path || !workspace.getConfiguration('previewSync').get<boolean>('highlightSelection')) return null;
        // what a click selected is outlined already
        if (isEmpty(editor.selection) || (clicked && sameRange(editor.selection, clicked))) return null;
        return { path, ranges: [editor.selection], text: editor.document.text };
      });
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
        highlight,
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('previewSync.highlightSelection')) highlight.update();
          if (!event.affectsConfiguration('previewSync.followCursor')) return;
          following = configuredFollow(workspace, globalState);
          toggle.dispose();
          toggle = preview.registerToolbarItem(followCursor({ on: following, onChange }), { group: '1_sync', order: 10 });
        }),
        // where the user works: the shown file's editor, focused (not a collaborator's edit in a hidden editor)
        window.onDidChangeTextEditorSelection(({ textEditor }) => {
          if (clicked && !sameRange(textEditor.selection, clicked)) clearClick();
          if (textEditor === window.activeTextEditor) highlight.update();
          if (following && textEditor === window.activeTextEditor && workbench.isEditorFocused()) revealSelection();
        }),
        preview.onDidClickPage((click) => {
          if (!project.document(click.path)) return;
          // opening selects the click's source: that selection is the click's, not a move away from it
          clicked = null;
          workbench.open(click.path, { selection: click });
          clicked = window.activeTextEditor?.selection ?? null;
          highlight.update();
        }),
        window.onDidChangeActiveFile(() => highlight.update()),
        project.onDidChangeFile(clearClick),
      );
    },
  };
}

/** Its settings: `previewSync.followCursor`, `previewSync.highlightSelection`. */
const contributes: Extension['contributes'] = {
  configuration: {
    properties: {
      'previewSync.followCursor': {
        type: 'boolean',
        default: true,
        description:
          'Whether the preview follows the cursor ("Follow cursor": it scrolls to the text being edited or selected). Unset: what this viewer chose last (kept across visits), else on.',
      },
      'previewSync.highlightSelection': {
        type: 'boolean',
        default: true,
        description: 'Whether the text selected in the Visual or Source editor is shaded in the preview.',
      },
    },
  },
};

/** The host's value of `previewSync.followCursor`, else the viewer's last choice, else the default (on). */
function configuredFollow(workspace: Workspace, globalState: Memento): boolean {
  const setting = workspace.getConfiguration('previewSync').inspect<boolean>('followCursor');
  const chosen = globalState.get<unknown>(FOLLOW_KEY);
  return setting?.globalValue ?? (typeof chosen === 'boolean' ? chosen : undefined) ?? setting?.defaultValue ?? true;
}

/** Where the viewer's last "Follow cursor" choice is kept (`globalState`). */
const FOLLOW_KEY = 'followCursor';

/**
 * The selection shaded in the preview: `update()` shades `shading()` `HIGHLIGHT_DELAY_MS` later (asked again then);
 * when it is null, the shading goes at once, so a collapsed selection leaves nothing behind.
 */
class SelectionShading {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The file shaded now. */
  private shaded: ProjectPath | null = null;

  constructor(
    private readonly preview: PreviewContributions,
    private readonly shading: () => Shading | null,
  ) {}

  update(): void {
    clearTimeout(this.timer);
    if (this.shading()) this.timer = setTimeout(() => this.show(), HIGHLIGHT_DELAY_MS);
    else this.clear();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.clear();
  }

  private show(): void {
    const next = this.shading();
    if (!next) return this.clear();
    this.preview.setSelectionHighlight(next.path, next.ranges, next.text);
    this.shaded = next.path;
  }

  private clear(): void {
    if (this.shaded) this.preview.setSelectionHighlight(this.shaded, [], '');
    this.shaded = null;
  }
}

/** What to shade in the preview: non-empty ranges of `path`, in `text`. */
interface Shading {
  readonly path: ProjectPath;
  readonly ranges: readonly SourceRange[];
  readonly text: string;
}

/** How long the selection has to rest before the preview shades it (a drag selects anew on every mouse move). */
const HIGHLIGHT_DELAY_MS = 60;

function isEmpty(range: SourceRange): boolean {
  return range.from === range.to;
}

function sameRange(a: SourceRange, b: SourceRange): boolean {
  return a.from === b.from && a.to === b.to;
}
