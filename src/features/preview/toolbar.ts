import { type Zoom } from './pages/zoom';

/** What a toolbar button asks for: a zoom level, or one preset step in or out. */
export type ZoomRequest = Zoom | 'in' | 'out';

const BUTTONS: [label: string, title: string, request: ZoomRequest][] = [
  ['−', 'Zoom out', 'out'],
  ['+', 'Zoom in', 'in'],
  ['Fit', 'Fit width', 'fit'],
  ['100%', 'Actual size', 1],
];

/** The preview's toolbar: zoom buttons, the current zoom and "page n / total". */
export class PreviewToolbar {
  readonly element: HTMLElement;
  private readonly zoom: HTMLElement;
  private readonly page: HTMLElement;

  constructor(doc: Document, onZoom: (request: ZoomRequest) => void) {
    this.element = doc.createElement('div');
    this.element.className = 'typst-preview__toolbar';
    this.element.dataset.testid = 'typst-preview-toolbar';
    for (const [label, title, request] of BUTTONS) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.addEventListener('click', () => onZoom(request));
      this.element.append(button);
    }
    this.zoom = span(doc, 'typst-preview__zoom', 'typst-preview-zoom');
    this.page = span(doc, 'typst-preview__page-number', 'typst-preview-page-number');
    this.element.append(this.zoom, this.page);
  }

  showZoom(label: string): void {
    this.zoom.textContent = label;
  }

  showPage(current: number, total: number): void {
    this.page.textContent = total === 0 ? '' : `${current} / ${total}`;
  }
}

function span(doc: Document, className: string, testid: string): HTMLElement {
  const element = doc.createElement('span');
  element.className = className;
  element.dataset.testid = testid;
  return element;
}
