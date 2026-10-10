// TextChange: the one edit format of the widget (CodeMirror's ChangeSpec shape). A leaf, so the folder's helpers
// need not import the entry. See typst-document.ts.

/** A replacement of `from..to` (UTF-16 offsets) by `insert`. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}
