// FieldPopover: a small popover with one text field, for links and images. See visual-view.ts.
/** What a field popover asks for and does with the answer. */
export interface FieldPopoverOptions {
  /** Accessible name of the popover, e.g. "Link". */
  label: string;
  /** Label of the text field, e.g. "URL". */
  field: string;
  placeholder: string;
  apply(value: string): void;
  /** Offered as a "Remove" button while `open` says so. */
  remove?(): void;
  /** More controls below the field (e.g. files to pick), shown with it. */
  extra?: HTMLElement;
}

/**
 * A small form below a toolbar button that asks for one value (a link's URL,
 * an image's path): Enter or "Apply" applies a non-empty value, "Remove"
 * (where offered) removes, Escape or a click elsewhere closes it.
 */
export class FieldPopover {
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly removeButton: HTMLButtonElement;
  /** Closes on a mousedown outside; the composed path sees through shadow roots. */
  private readonly closeOnOutsideClick = (event: Event) => {
    const path = event.composedPath();
    if (!path.includes(this.form) && !(this.anchor && path.includes(this.anchor))) this.close();
  };
  private anchor: HTMLElement | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly options: FieldPopoverOptions,
  ) {
    const doc = parent.ownerDocument;
    this.form = doc.createElement('form');
    this.form.className = 'typst-popover';
    this.form.hidden = true;
    this.form.setAttribute('aria-label', options.label);
    this.input = doc.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = options.placeholder;
    this.input.setAttribute('aria-label', options.field);
    const apply = this.makeButton('Apply', 'submit');
    this.removeButton = this.makeButton('Remove', 'button');
    this.removeButton.dataset.action = 'remove';
    this.form.append(this.input, apply, this.removeButton);
    if (options.extra) this.form.append(options.extra);
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = this.input.value.trim();
      if (!value) return;
      this.close();
      options.apply(value);
    });
    this.removeButton.addEventListener('click', () => {
      this.close();
      options.remove?.();
    });
    this.form.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.close();
    });
    parent.append(this.form);
  }

  get isOpen(): boolean {
    return !this.form.hidden;
  }

  /** Shows the popover below `anchor` with `value` in its field, offering "Remove" if `removable`. */
  open(anchor: HTMLElement, value: string, removable: boolean): void {
    this.anchor = anchor;
    this.input.value = value;
    this.removeButton.hidden = !removable || !this.options.remove;
    this.form.hidden = false;
    // Below the anchor, but not past the right edge of the parent: that would scroll the editing pane sideways.
    const room = this.parent.clientWidth - this.form.offsetWidth;
    this.form.style.left = `${Math.max(0, room > 0 ? Math.min(anchor.offsetLeft, room) : anchor.offsetLeft)}px`;
    this.form.ownerDocument.addEventListener('mousedown', this.closeOnOutsideClick, true);
    this.input.focus();
    this.input.select();
  }

  close(): void {
    this.form.hidden = true;
    this.form.ownerDocument.removeEventListener('mousedown', this.closeOnOutsideClick, true);
  }

  destroy(): void {
    this.close();
    this.form.remove();
  }

  private makeButton(text: string, type: 'submit' | 'button'): HTMLButtonElement {
    const button = this.form.ownerDocument.createElement('button');
    button.type = type;
    button.textContent = text;
    return button;
  }
}
