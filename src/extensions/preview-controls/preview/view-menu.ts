// viewMenu: the preview toolbar's "View" menu of view options. See previewControls in ../preview-controls.ts.
import type { PreviewContributions, PreviewToolbarItem, PreviewViewOption } from '../../../hosts/preview/preview';
import type { Memento } from '../../../hosts/workbench/workbench';

/**
 * "View": a button that opens a checkbox per registered view option (page guides, box outlines), as this viewer left
 * them last time (kept in `state`), else their defaults. A change applies at once and is remembered. Without view
 * options the button is hidden. The values this viewer chose are handed to the preview as soon as the menu is made,
 * also for options registered later.
 */
export function viewMenu(preview: Pick<PreviewContributions, 'viewOptions' | 'setViewOptionValues'>, state: Memento): PreviewToolbarItem {
  preview.setViewOptionValues(remembered(state));
  return (context) => {
    const menu = new ViewMenu(context.ownerDocument, preview, state);
    return { elements: [menu.element], update: () => menu.describe(), dispose: () => menu.dispose() };
  };
}

class ViewMenu {
  readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly popover: HTMLElement;

  constructor(
    private readonly doc: Document,
    private readonly preview: Pick<PreviewContributions, 'viewOptions' | 'setViewOptionValues'>,
    private readonly state: Memento,
  ) {
    this.element = doc.createElement('span');
    this.element.className = 'typst-preview-controls__view';
    this.element.dataset.testid = 'typst-preview-view';
    this.button = doc.createElement('button');
    this.button.type = 'button';
    this.button.textContent = 'View';
    this.button.title = 'How the preview shows the pages (not the PDF)';
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.addEventListener('click', () => this.open(this.popover.hidden));
    this.popover = doc.createElement('div');
    this.popover.className = 'typst-preview-controls__view-options';
    this.popover.setAttribute('role', 'dialog');
    this.popover.setAttribute('aria-label', 'View options');
    this.popover.hidden = true;
    this.popover.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.open(false);
      this.button.focus();
    });
    this.element.append(this.button, this.popover);
    this.describe();
    doc.addEventListener('mousedown', this.closeOutside, true);
  }

  /** Shows the button only while there are view options (they may be registered after the menu). */
  describe(): void {
    this.element.hidden = this.preview.viewOptions().length === 0;
    this.button.setAttribute('aria-expanded', String(!this.popover.hidden));
  }

  dispose(): void {
    this.doc.removeEventListener('mousedown', this.closeOutside, true);
    this.element.remove();
  }

  /** Opens the menu with the options registered now, or closes it. */
  private open(open: boolean): void {
    if (open) {
      const values = remembered(this.state);
      this.popover.replaceChildren(...this.preview.viewOptions().map((option) => this.checkbox(option, values[option.id] ?? option.default)));
    }
    this.popover.hidden = !open;
    this.describe();
    if (open) this.popover.querySelector('input')?.focus();
  }

  private checkbox(option: PreviewViewOption, checked: boolean): HTMLLabelElement {
    const label = this.doc.createElement('label');
    const input = this.doc.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => {
      const values = { ...remembered(this.state), [option.id]: input.checked };
      void this.state.update(VALUES_KEY, values);
      this.preview.setViewOptionValues(values);
    });
    if (option.description) label.title = option.description;
    label.append(input, option.label);
    return label;
  }

  private readonly closeOutside = (event: MouseEvent): void => {
    if (!this.popover.hidden && !event.composedPath().includes(this.element)) this.open(false);
  };
}

/** Where the viewer's choices are kept. */
const VALUES_KEY = 'viewOptions';

/** The values this viewer chose, read from storage: only booleans count. */
function remembered(state: Memento): Record<string, boolean> {
  const saved = state.get<unknown>(VALUES_KEY);
  if (typeof saved !== 'object' || saved === null) return {};
  return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
}
