// minimalChange: the one replacement between two texts. See typst-document.ts.
import type { TextChange } from './text-change';

/**
 * The single change that turns `before` into `after`, covering only the part
 * between their common prefix and suffix (null if they are equal). Keeps
 * cursors, undo history and incremental reparsing intact when a whole new
 * text is set from outside. Never splits a UTF-16 surrogate pair.
 */
export function minimalChange(before: string, after: string): TextChange | null {
  if (before === after) return null;
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix--;

  let suffix = 0;
  const maxSuffix = max - prefix;
  while (suffix < maxSuffix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
  if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) suffix--;

  return { from: prefix, to: before.length - suffix, insert: after.slice(prefix, after.length - suffix) };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
