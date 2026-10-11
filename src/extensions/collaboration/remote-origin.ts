// REMOTE_ORIGIN. See collaboration.ts.

/**
 * The origin of a document change that arrived through the shared Y.Text: another user's edit, or the shared text
 * adopted when a document is bound to it. Such changes never enter a local undo history.
 *
 * The origin of the text changes collaboration brings into a TypstDocument. A leaf outside the lazily loaded model/
 * chunk, so the eager Source editor contribution (source-editor/) can recognise them.
 */
export const REMOTE_ORIGIN: unique symbol = Symbol('collaboration.remote');
