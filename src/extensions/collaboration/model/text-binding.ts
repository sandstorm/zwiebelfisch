// TextBinding: a TypstDocument bound to a shared Y.Text, both ways (as y-codemirror binds an editor). See model.ts.
import type * as Y from 'yjs';
import { SourceRange, type TextChange, type TypstDocument } from '../../../core/typst-document/typst-document';
import type { Disposable } from '../../../core/disposable/disposable';
import { REMOTE_ORIGIN } from '../remote-origin';

/**
 * Keeps `document` and `text` (an integrated Y.Text, part of a Y.Doc) equal: the document first adopts the
 * Y.Text's content (one minimal change, so open views and anchors survive); from then on its local changes go
 * into the Y.Text, one Y transaction each, and every other transaction on the Y.Text (another user's edit) becomes
 * a `change` of the document with `REMOTE_ORIGIN`. `dispose` unbinds; the document keeps its text.
 */
export class TextBinding {
  private readonly subscription: Disposable;

  constructor(
    readonly text: Y.Text,
    private readonly document: TypstDocument,
  ) {
    if (!text.doc) throw new Error('TextBinding: the Y.Text must belong to a Y.Doc');
    document.setText(text.toString(), REMOTE_ORIGIN);
    text.observe(this.pull);
    this.subscription = document.onDidChange(({ contentChanges, origin }) => {
      if (origin !== REMOTE_ORIGIN) this.push(contentChanges);
    });
  }

  dispose(): void {
    this.text.unobserve(this.pull);
    this.subscription.dispose();
  }

  /** A local change into the Y.Text, as our own transaction (which `pull` skips). */
  private push(changes: readonly TextChange[]): void {
    const text = this.text;
    text.doc!.transact(() => {
      for (const { from, to, insert } of [...changes].sort((a, b) => b.from - a.from)) {
        if (to > from) text.delete(from, to - from);
        if (insert) text.insert(from, insert);
      }
    }, this);
  }

  /** Someone else's transaction on the Y.Text into the document. */
  private readonly pull = (event: Y.YTextEvent): void => {
    if (event.transaction.origin === this) return;
    this.document.change(deltaToChanges(event.delta as DeltaOp[]), REMOTE_ORIGIN);
  };
}

// --- Y.Text deltas as TextChanges

/** One step of a Y.Text event delta (Quill delta format; text only). */
interface DeltaOp {
  retain?: number;
  delete?: number;
  insert?: string | object;
}

/**
 * Converts a Y.Text delta (sequential retain / delete / insert) into
 * non-overlapping changes in coordinates of the text before it, the shape
 * `TypstDocument.change` and CodeMirror use. A deletion and an insertion at
 * the same spot become one replacement. Embeds are not expected in Typst
 * source and count as nothing.
 */
function deltaToChanges(delta: readonly DeltaOp[]): TextChange[] {
  const changes: { from: number; to: number; insert: string }[] = [];
  let position = 0;
  const at = (from: number) => {
    const last = changes[changes.length - 1];
    if (last && last.to === from) return last;
    const change = { from, to: from, insert: '' };
    changes.push(change);
    return change;
  };
  for (const op of delta) {
    if (op.retain !== undefined) position += op.retain;
    if (op.delete !== undefined) {
      at(position).to = position + op.delete;
      position += op.delete;
    }
    if (typeof op.insert === 'string') at(position).insert += op.insert;
  }
  return changes.map(({ from, to, insert }) => ({ ...SourceRange.of({ from, to }), insert }));
}
