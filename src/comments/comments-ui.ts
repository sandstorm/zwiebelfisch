import type { Highlight } from '../document/highlight';
import type { TypstDocument } from '../document/typst-document';
import type { Marker } from '../preview/markers';
import { mapRange, type Range } from './anchor';
import type { Comments, Thread } from './comments';
import { CommentsPanel } from './panel';

/** An editing view comments can be made in and drawn on (source offsets throughout). */
export interface CommentableView {
  selection(): Range;
  reveal(from: number, to: number): void;
  setHighlights(layer: string, highlights: readonly Highlight[]): void;
}

export interface CommentsUIOptions {
  /** The widget; clicks on comment highlights or markers inside it select the thread, Mod-Alt-M comments. */
  root: HTMLElement;
  /** Every editing view; all of them show the highlights. */
  views: readonly CommentableView[];
  /** The view the user works in: where a new comment's range comes from and threads are revealed. */
  activeView(): CommentableView;
  preview: { setMarkers(layer: string, markers: readonly Marker[]): void };
  /** Project path of the commented file, for the preview markers. */
  path: string;
}

const LAYER = 'comments';

/**
 * The review UI around a `Comments` model: the side panel, the "Comment"
 * button (and Mod-Alt-M), highlights in every editing view, margin markers in
 * the preview, and the selected thread across all of them.
 *
 * Views and preview are refreshed together once per task, after every
 * change, so updates never run inside another view's update.
 */
export class CommentsUI {
  /** The side panel; hidden while there is nothing to show. */
  readonly panel: HTMLElement;
  /** The "Comment" button, for the host's toolbar. */
  readonly button: HTMLButtonElement;
  private readonly view: CommentsPanel;
  private readonly unsubscribe: (() => void)[];
  private active: string | null = null;
  private draft: Range | null = null;
  private scheduled = false;
  private destroyed = false;

  constructor(
    private readonly comments: Comments,
    document: TypstDocument,
    private readonly options: CommentsUIOptions,
  ) {
    const doc = options.root.ownerDocument;
    this.view = new CommentsPanel(doc, {
      select: (id) => this.select(id, { reveal: true }),
      submitDraft: (text) => this.submitDraft(text),
      cancelDraft: () => this.setDraft(null),
      reply: (id, text) => comments.reply(id, text),
      setResolved: (id, resolved) => comments.setResolved(id, resolved),
      remove: (id) => comments.remove(id),
    });
    this.panel = this.view.element;
    this.button = commentButton(doc);
    this.button.addEventListener('mousedown', (event) => event.preventDefault()); // keep the editor's selection
    this.button.addEventListener('click', () => this.startComment());
    options.root.addEventListener('click', this.handleClick);
    options.root.addEventListener('keydown', this.handleKey);
    this.unsubscribe = [
      comments.onChange(() => this.schedule()),
      document.onChange((changes) => {
        if (this.draft) this.draft = mapRange(this.draft, changes);
      }),
    ];
    this.refresh();
  }

  /** Opens a new comment on the active view's selection (nothing happens without a selection). */
  startComment(): void {
    const range = this.options.activeView().selection();
    if (range.from < range.to) this.setDraft(range);
  }

  destroy(): void {
    this.destroyed = true;
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.options.root.removeEventListener('click', this.handleClick);
    this.options.root.removeEventListener('keydown', this.handleKey);
    for (const view of this.options.views) view.setHighlights(LAYER, []);
    this.options.preview.setMarkers(LAYER, []);
    this.panel.remove();
    this.button.remove();
  }

  private setDraft(range: Range | null): void {
    this.draft = range;
    this.refresh();
    if (range) this.view.focusDraft();
  }

  private submitDraft(text: string): void {
    const range = this.draft;
    this.draft = null;
    this.active = range && this.comments.add(range, text);
    this.refresh();
  }

  private select(id: string, { reveal }: { reveal: boolean }): void {
    this.active = id;
    this.refresh();
    this.view.reveal(id);
    const range = reveal && this.thread(id)?.range;
    if (range) this.options.activeView().reveal(range.from, range.to);
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    if (this.panel.contains(target)) return;
    const id = target.closest<HTMLElement>('[data-comment-id]')?.dataset.commentId;
    // A margin marker in the preview takes the editor to the text; a highlight is already there.
    if (id) this.select(id, { reveal: target.closest('[data-preview-marker]') !== null });
  };

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.code === 'KeyM' && event.altKey && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.startComment();
    }
  };

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.destroyed) this.refresh();
    });
  }

  private refresh(): void {
    const threads = this.comments.threads();
    if (this.active && !threads.some((thread) => thread.id === this.active)) this.active = null;
    this.view.render({ threads, active: this.active, draft: this.draft !== null });
    this.panel.hidden = threads.length === 0 && !this.draft;
    const shown = threads.filter((thread) => thread.range && !thread.resolved);
    const highlights = shown.map((thread) => this.highlight(thread.range!, thread.id));
    if (this.draft) highlights.push(this.highlight(this.draft, null));
    for (const view of this.options.views) view.setHighlights(LAYER, highlights);
    this.options.preview.setMarkers(LAYER, shown.map((thread) => this.marker(thread)));
  }

  private highlight({ from, to }: Range, id: string | null): Highlight {
    const state = id === null ? ' typst-comment-range--draft' : id === this.active ? ' typst-comment-range--active' : '';
    return { from, to, className: `typst-comment-range${state}`, attributes: id ? { 'data-comment-id': id } : {} };
  }

  private marker(thread: Thread): Marker {
    const [first] = thread.comments;
    return {
      path: this.options.path,
      offset: thread.range!.from,
      className: `typst-comment-marker${thread.id === this.active ? ' typst-comment-marker--active' : ''}`,
      attributes: { 'data-comment-id': thread.id },
      title: first ? `${first.author}: ${first.text}` : '',
    };
  }

  private thread(id: string): Thread | undefined {
    return this.comments.threads().find((thread) => thread.id === id);
  }
}

function commentButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'typst-editor__comment';
  button.title = 'Comment on the selection (Ctrl+Alt+M)';
  button.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg><span>Comment</span>';
  return button;
}
