// The types of prosemirror-dev-tools (its own, dist/types/index.d.ts): its package.json does not point to them.
// See devtools.ts.
declare module 'prosemirror-dev-tools' {
  import type { EditorView } from '@tiptap/pm/view';

  /** Shows the dev tools for `editorView` (one panel per page: a second call replaces the first); returns their removal. */
  export function applyDevTools(editorView: EditorView, props: { diffWorker?: Worker }): () => void;
}
