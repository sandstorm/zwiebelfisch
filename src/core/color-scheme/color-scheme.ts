// Which color scheme an element is shown in, read from its resolved text color (the page's color-scheme, the
// widget's `theme` or the OS decide it; CSS does not tell scripts directly). Used by the workbench's `data-scheme`
// and by CodeMirror's dark theme in the code editors; and which text color reads on a given background (a user's
// color in carets and file badges). Entry of core/color-scheme/. See docs/architecture/core.typ.

/**
 * Whether a computed CSS color (`rgb(..)` / `rgba(..)`) is light: text in it sits on a dark background.
 * null when it is not a resolved color.
 */
export function isLightText(color: string): boolean | null {
  const match = /^rgba?\((\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(color);
  if (!match) return null;
  const [r, g, b] = match.slice(1).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 127.5;
}

/**
 * Black or white, whichever contrasts more with the background `color` (WCAG relative luminance). Only hex colors
 * are measured; any other CSS color gets white.
 */
export function textColorOn(color: string): string {
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
