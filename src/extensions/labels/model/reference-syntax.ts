// Typst's reference syntax (`@key`, `@key[supplement]`) and label names: reading, printing, cleaning up a typed
// name. See ../labels.ts.

/** `@target` and the supplement as written (`[..]`), if any. */
export function referenceSyntax(target: string, supplement: string | null): string {
  return `@${target}${supplement ?? ''}`;
}

/** The characters of a label's name (a regular expression character class). */
export const LABEL_CHAR = '[\\p{L}\\p{N}_\\-:.]';

/** Characters Typst reads as part of a reference's name; `.` and `:` only when more name characters follow. */
const CONTINUES_REFERENCE = /^(?:[\p{L}\p{N}_-]|[.:][\p{L}\p{N}_-])/u;

/**
 * `input` as a label name Typst accepts and a reference can point to: spaces
 * become `-`, other characters a label cannot hold are dropped, and so are a
 * trailing `.` / `:` (which `@name.` would leave out). Null if nothing is left.
 */
export function labelName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, '-').replace(new RegExp(`(?!${LABEL_CHAR}).`, 'gu'), '').replace(/[.:]+$/, '');
  return name || null;
}

/**
 * Text printed right after a reference without supplement must not extend
 * its name (`@intro` + `s` would read `@intros`): a backslash escapes the
 * first character.
 */
export function guardAfterReference(supplement: string | null, text: string): string {
  return supplement === null && CONTINUES_REFERENCE.test(text) ? `\\${text}` : text;
}
