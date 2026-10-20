import type { SourceRange } from '../../core/typst-document/typst-document';
import type { ProjectPath } from '../../core/paths/paths';
import type { PageRect } from '../../core/typst-engine/typst-engine';
import type { PageOverlay, PreviewContributions } from '../../hosts/preview/preview';
import type { Memento, Extension } from '../../hosts/extension-host/extension-host';
import type { Workspace } from '../../hosts/extension-host/workspace/workspace';
import css from './preview-sync.css?inline';

/**
 * Keeps the editor and the preview in step, both ways:
 * - Follow cursor: the preview scrolls to the selection of the focused editor. "Follow cursor" in the preview's toolbar
 *   (menu `preview/title`, the command `previewSync.toggleFollowCursor`, pressed while on) turns it on and off; it
 *   starts as the setting `previewSync.followCursor` says, else as this viewer chose last, else on.
 * - Shading: while `previewSync.highlightSelection` is on (the default), the text selected in the shown file is shaded
 *   in the preview, a moment after the selection settles.
 * - Click: a click on text in the preview opens its file with that range selected (files outside the project are
 *   ignored). The click stays outlined until the next edit, the next render or until the selection moves away.
 * Both are page overlays of its own (`preview.createPageOverlay`), styled by preview-sync.css.
 */
export function previewSync(): Extension {
  return {
    id: 'preview-sync',
    contributes,
    activate({ project, globalState, window, workspace, commands, preview, subscriptions }) {
      subscriptions.push(window.registerStyleSheet(css));
      let following = configuredFollow(workspace, globalState);
      const outline = new ClickOutline(preview.createPageOverlay('zwf-preview-sync__click'));
      const highlight = new SelectionShading(preview, preview.createPageOverlay('zwf-preview-sync__selection'), () => {
        const editor = window.activeTextEditor;
        const path = editor && project.pathOf(editor.document);
        if (!editor || !path || !workspace.getConfiguration('previewSync').get<boolean>('highlightSelection')) return null;
        // what a click selected is outlined already
        if (isEmpty(editor.selection) || outline.marks(editor.selection)) return null;
        return { path, ranges: [editor.selection], text: editor.document.text };
      });
      const revealSelection = () => {
        const editor = window.activeTextEditor;
        const path = editor && project.pathOf(editor.document);
        if (path) preview.reveal(path, editor.selection);
      };
      subscriptions.push(
        commands.registerCommand(TOGGLE_FOLLOW, () => {
          following = !following;
          void globalState.update(FOLLOW_KEY, following);
          if (following) revealSelection();
        }),
        window.registerMenuItem('preview/title', { command: TOGGLE_FOLLOW, title: 'Follow cursor', group: '1_sync', order: 10, toggled: () => following }),
        outline,
        highlight,
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('previewSync.highlightSelection')) highlight.update();
          if (event.affectsConfiguration('previewSync.followCursor')) following = configuredFollow(workspace, globalState);
        }),
        // where the user works: the shown file's editor, focused (not a collaborator's edit in a hidden editor)
        window.onDidChangeTextEditorSelection(({ textEditor }) => {
          if (!outline.marks(textEditor.selection)) outline.clear();
          if (textEditor === window.activeTextEditor) highlight.update();
          if (following && textEditor === window.activeTextEditor && window.isEditorFocused()) revealSelection();
        }),
        preview.onDidClickPage((click) => {
          if (!project.document(click.path)) return;
          // opening selects the click's source: that selection is the click's, not a move away from it
          outline.clear();
          window.showDocument(click.path, { selection: click });
          outline.show(window.activeTextEditor?.selection ?? null, click.boxes);
          highlight.update();
        }),
        // new pages: the outline marks what was drawn before, the shading is looked up on them
        preview.onDidRender(() => {
          outline.clear();
          highlight.refresh();
        }),
        window.onDidChangeActiveFile(() => highlight.update()),
        project.onDidChangeFile(() => outline.clear()),
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

/** The command of "Follow cursor": turns following on or off. */
const TOGGLE_FOLLOW = 'previewSync.toggleFollowCursor';

/** Where the viewer's last "Follow cursor" choice is kept (`globalState`). */
const FOLLOW_KEY = 'followCursor';

/**
 * The outline of a click in the preview, on `overlay`: it marks what the click selected while that is what the user
 * looks at, so it goes with the first edit (in any editor), a render or once the selection moves elsewhere, as the
 * Source editor's own reveal highlight does; otherwise it would stay behind on outdated text.
 */
class ClickOutline {
  /** The selection the click made; null: none (or nothing outlined). */
  private clicked: SourceRange | null = null;

  constructor(private readonly overlay: PageOverlay) {}

  /** Outlines `boxes`, of the click that selected `selection`. */
  show(selection: SourceRange | null, boxes: readonly PageRect[]): void {
    this.clicked = selection;
    this.overlay.set(boxes);
  }

  /** Whether `range` is what the click selected (the outline marks it). */
  marks(range: SourceRange): boolean {
    return this.clicked !== null && sameRange(range, this.clicked);
  }

  clear(): void {
    this.clicked = null;
    this.overlay.set([]);
  }

  dispose(): void {
    this.overlay.dispose();
  }
}

/**
 * The selection shaded in the preview, on `overlay`: `update()` shades `shading()` `HIGHLIGHT_DELAY_MS` later (asked
 * again then); when it is null, the shading goes at once, so a collapsed selection leaves nothing behind. `refresh()`
 * looks it up now (new pages). Only the newest lookup is drawn; until it answers, the boxes before stay.
 */
class SelectionShading {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Counts the lookups and clears: an answer is drawn only while nothing came after it. */
  private generation = 0;

  constructor(
    private readonly preview: PreviewContributions,
    private readonly overlay: PageOverlay,
    private readonly shading: () => Shading | null,
  ) {}

  update(): void {
    clearTimeout(this.timer);
    if (this.shading()) this.timer = setTimeout(() => void this.show(), HIGHLIGHT_DELAY_MS);
    else this.clear();
  }

  refresh(): void {
    clearTimeout(this.timer);
    void this.show();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.generation++;
    this.overlay.dispose();
  }

  private async show(): Promise<void> {
    const next = this.shading();
    if (!next) return this.clear();
    const generation = ++this.generation;
    const boxes = await this.preview.boxesFor(next.path, next.ranges, next.text);
    if (generation === this.generation) this.overlay.set(boxes);
  }

  private clear(): void {
    this.generation++;
    this.overlay.set([]);
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
