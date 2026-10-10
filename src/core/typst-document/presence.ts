/** Who another user is, as the views show them. */
export interface PresenceUser {
  name: string;
  /** A CSS color for their caret, selection and markers. */
  color: string;
}

/**
 * Another user's place in a text: their caret (`head`) and selection
 * (`anchor`..`head`, empty for a plain caret), in source offsets (UTF-16).
 * `id` tells users apart (two may share a name).
 */
export interface Presence {
  id: string;
  user: PresenceUser;
  anchor: number;
  head: number;
}

/** A presence together with the file it is in. */
export interface PlacedPresence extends Presence {
  path: string;
}

/**
 * A view that shows where other users are (SourceView, VisualView): their
 * carets with name flags and their selections. Each call replaces the
 * previous presences; the view keeps them on their characters while the text
 * changes until it is called again.
 */
export interface PresenceTarget {
  setPresence(presences: readonly Presence[]): void;
}

/** CSS custom properties for elements drawn in a user's color: the color and a readable text color on it. */
export function presenceStyle(element: HTMLElement, user: PresenceUser): void {
  element.style.setProperty('--typst-remote-color', user.color);
  element.style.setProperty('--typst-remote-text', flagTextColor(user.color));
}

/**
 * A remote caret: a thin bar in the user's color with a flag naming them
 * (the look of Tiptap's CollaborationCaret / y-codemirror). Styling decides
 * whether the flag always shows or only on hover and right after a move.
 */
export function caretElement(doc: Document, user: PresenceUser): HTMLElement {
  const caret = doc.createElement('span');
  caret.className = 'typst-remote-caret';
  caret.dataset.user = user.name;
  caret.setAttribute('aria-hidden', 'true');
  caret.contentEditable = 'false';
  presenceStyle(caret, user);
  const flag = doc.createElement('span');
  flag.className = 'typst-remote-caret__flag';
  flag.textContent = user.name;
  caret.append(flag);
  return caret;
}

/** Up to two initials of a name, for small markers ("Ann Lee" → "AL"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => String.fromCodePoint(word.codePointAt(0)!).toUpperCase())
    .join('');
}

/**
 * Black or white, whichever contrasts more with `color` (WCAG relative
 * luminance). Only hex colors are measured; any other CSS color gets white.
 */
export function flagTextColor(color: string): string {
  const rgb = parseHex(color);
  if (!rgb) return '#ffffff';
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast with white: 1.05 / (L + 0.05); with black: (L + 0.05) / 0.05.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#ffffff' : '#000000';
}

function parseHex(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
