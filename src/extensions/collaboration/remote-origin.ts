// Outside the lazily loaded model/, so the eager source-editor/ can recognise remote changes. See collaboration in
// collaboration.ts.

/**
 * The origin of a document change that arrived through the shared Y.Text: another user's edit, or the shared text
 * adopted when a document is bound to it. Such changes never enter a local undo history.
 */
export const REMOTE_ORIGIN: unique symbol = Symbol('collaboration.remote');
