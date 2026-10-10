/**
 * A styled stretch of the source (UTF-16 offsets) that an editing view draws
 * over its text, e.g. a commented range. `attributes` are set on the marked
 * DOM, so clicks can be traced back (`data-comment-id`). Views follow edits
 * with their highlights until the owner sets them again.
 */
export interface Highlight {
  from: number;
  to: number;
  className: string;
  attributes?: Record<string, string>;
}
