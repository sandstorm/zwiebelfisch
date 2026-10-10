// The file panel's icons (16×16 strokes, currentColor): file kinds, folders, "New". See ../file-panel.ts.
import type { FileKind } from '../../../../core/paths/paths';

const ICONS = {
  typst: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6.5 8.5h4M6.5 11h4"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3"/>',
  spreadsheet: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6h12M2 9.5h12M6 6v7.5M10 6v7.5"/>',
  data: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6 9h1M6 11.5h1M8.5 9H10M8.5 11.5H10"/>',
  folder: '<path d="M1.5 4.5v8h13v-7H7.5L6 4H2z"/>',
  'folder-open': '<path d="M1.5 12.5v-8H6l1.5 1.5h5v2"/><path d="M1.5 12.5 3.5 8h11l-2 4.5z"/>',
  chevron: '<path d="m6 4 4 4-4 4"/>',
  files: '<path d="M5 1.5h5L13 4.5V12H5z"/><path d="M3 4v10h7"/>',
  add: '<path d="M8 3v10M3 8h10"/>',
} satisfies Record<FileKind | string, string>;

export type IconName = keyof typeof ICONS;

export function icon(doc: Document, name: IconName): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('typst-files__icon');
  svg.innerHTML = ICONS[name];
  return svg;
}
