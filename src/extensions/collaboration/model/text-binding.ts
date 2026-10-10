// TextBinding: a TypstDocument bound to a shared Y.Text, both ways (as y-codemirror binds an editor). See model.ts.
import type * as Y from 'yjs';
import type { TextChange, TypstDocument } from '../../../core/typst-document/typst-document';
import type { Disposable } from '../../../core/disposable/disposable';
import { REMOTE_ORIGIN } from '../remote-origin';
import { deltaToChanges, type DeltaOp } from './y-delta';

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
