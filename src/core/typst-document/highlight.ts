// Highlight: a styled source range that an editing view draws over its text. See typst-document.ts.
/**
 * A styled stretch of the source (UTF-16 offsets) that an editing view draws
 * over its text, e.g. another user's selection. `attributes` are set on the
 * marked DOM (e.g. a style with the user's color). Views follow edits
 * with their highlights until the owner sets them again.
 */
export interface Highlight {
  from: number;
  to: number;
  className: string;
  attributes?: Record<string, string>;
}
