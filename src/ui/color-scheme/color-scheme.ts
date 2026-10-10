// Which color scheme an element is shown in, read from its resolved text color (the page's color-scheme, the
// widget's `theme` or the OS decide it; CSS does not tell scripts directly). Used by the workbench's `data-scheme`
// and by CodeMirror's dark theme in the code editors. See ARCHITECTURE.md, "Dark mode".

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
