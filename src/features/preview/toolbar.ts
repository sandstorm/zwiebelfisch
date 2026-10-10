// PreviewToolbar: zoom buttons, zoom label, the "Follow cursor" switch and "page n / total". See preview.ts.
import { type Zoom } from './pages/pages';

/** What a toolbar button asks for: a zoom level, or one preset step in or out. */
export type ZoomRequest = Zoom | 'in' | 'out';

const BUTTONS: [label: string, title: string, request: ZoomRequest][] = [
  ['−', 'Zoom out', 'out'],
  ['+', 'Zoom in', 'in'],
  ['Fit', 'Fit width', 'fit'],
  ['100%', 'Actual size', 1],
];

/** The "Follow cursor" switch: whether the preview scrolls to what is edited or selected. */
export interface FollowToggle {
  on: boolean;
  onChange(on: boolean): void;
}

/** The preview's toolbar: zoom buttons, the current zoom, the "Follow cursor" on/off switch and "page n / total". */
export class PreviewToolbar {
  readonly element: HTMLElement;
  private readonly zoom: HTMLElement;
  private readonly page: HTMLElement;
  private readonly follow: HTMLButtonElement;

  constructor(doc: Document, onZoom: (request: ZoomRequest) => void, follow: FollowToggle) {
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
    this.follow = doc.createElement('button');
    this.follow.type = 'button';
    this.follow.className = 'typst-preview__follow';
    this.follow.setAttribute('role', 'switch');
    this.follow.title = 'Scroll the preview to the text you edit or select';
    const track = doc.createElement('span');
    track.className = 'typst-preview__switch';
    track.setAttribute('aria-hidden', 'true');
    this.follow.append(track, 'Follow cursor');
    this.follow.addEventListener('click', () => follow.onChange(this.follow.getAttribute('aria-checked') !== 'true'));
    this.showFollow(follow.on);
    this.page = span(doc, 'typst-preview__page-number', 'typst-preview-page-number');
    this.element.append(this.zoom, this.follow, this.page);
  }

  showFollow(on: boolean): void {
    this.follow.setAttribute('aria-checked', String(on));
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
