import type { TextChange } from './typst-document';

/** One step of a Y.Text event delta (Quill delta format; text only). */
export interface DeltaOp {
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
export function deltaToChanges(delta: readonly DeltaOp[]): TextChange[] {
  const changes: TextChange[] = [];
  let position = 0;
  const at = (from: number): TextChange => {
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
  return changes;
}
