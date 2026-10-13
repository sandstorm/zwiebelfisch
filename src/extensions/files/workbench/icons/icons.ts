// The file panel's own icons (16×16 strokes, currentColor). See FilePanel in ../file-panel.ts.

/**
 * Typst files, other files without an icon of their own, folders, "New"; and the icons custom editors give the files
 * they open (markup).
 */
export function icon(doc: Document, name: IconName): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('zwf-files__icon');
  svg.innerHTML = ICONS[name];
  return svg;
}

export type IconName = keyof typeof ICONS;

/**
 * An icon from SVG markup (a custom editor's `icon`, 16×16 strokes), styled as the panel's own; the panel's `data`
 * icon when the markup holds no SVG.
 */
export function markupIcon(doc: Document, markup: string): Element {
  const holder = doc.createElement('template');
  holder.innerHTML = markup.trim();
  const svg = holder.content.firstElementChild;
  if (svg?.localName !== 'svg') return icon(doc, 'data');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('zwf-files__icon');
  return svg;
}

const ICONS = {
  typst: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6.5 8.5h4M6.5 11h4"/>',
  data: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6 9h1M6 11.5h1M8.5 9H10M8.5 11.5H10"/>',
  folder: '<path d="M1.5 4.5v8h13v-7H7.5L6 4H2z"/>',
  'folder-open': '<path d="M1.5 12.5v-8H6l1.5 1.5h5v2"/><path d="M1.5 12.5 3.5 8h11l-2 4.5z"/>',
  chevron: '<path d="m6 4 4 4-4 4"/>',
  files: '<path d="M5 1.5h5L13 4.5V12H5z"/><path d="M3 4v10h7"/>',
  add: '<path d="M8 3v10M3 8h10"/>',
} satisfies Record<string, string>;
