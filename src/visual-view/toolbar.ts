import type { ChainedCommands, Editor } from '@tiptap/core';

/** A toolbar button: how it looks, what it does, and when it shows as on. */
interface Action {
  label: string;
  /** Shortcut shown in the tooltip; `Mod` becomes ⌘ or Ctrl. */
  shortcut?: string;
  icon: string;
  run(chain: ChainedCommands): ChainedCommands;
  /** Toggles show their state (`aria-pressed`); plain actions (undo) do not. */
  active?(editor: Editor): boolean;
}

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  undo: svg('<path d="M9 15 4 10l5-5"/><path d="M4 10h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 15 5-5-5-5"/><path d="M20 10H9a5 5 0 0 0 0 10h3"/>'),
  bold: svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
  italic: svg('<path d="M10 5h8"/><path d="M6 19h8"/><path d="M14 5 10 19"/>'),
  bulletList: svg(
    '<circle cx="5" cy="7" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/>' +
      '<circle cx="5" cy="17" r="1" fill="currentColor"/><path d="M10 7h10M10 12h10M10 17h10"/>',
  ),
  orderedList: svg(
    '<path d="M10 7h10M10 12h10M10 17h10"/><path d="M4 5h1.5v4" stroke-width="1.5"/>' +
      '<path d="M3.5 14h2.5l-2.5 4h2.5" stroke-width="1.5"/>',
  ),
};

const HISTORY: Action[] = [
  { label: 'Undo', shortcut: 'Mod+Z', icon: ICONS.undo, run: (c) => c.undo() },
  { label: 'Redo', shortcut: 'Mod+Shift+Z', icon: ICONS.redo, run: (c) => c.redo() },
];
const MARKS: Action[] = [
  { label: 'Bold', shortcut: 'Mod+B', icon: ICONS.bold, run: (c) => c.toggleBold(), active: (e) => e.isActive('bold') },
  { label: 'Italic', shortcut: 'Mod+I', icon: ICONS.italic, run: (c) => c.toggleItalic(), active: (e) => e.isActive('italic') },
];
const LISTS: Action[] = [
  { label: 'Bulleted list', icon: ICONS.bulletList, run: (c) => c.toggleBulletList(), active: (e) => e.isActive('bulletList') },
  { label: 'Numbered list', icon: ICONS.orderedList, run: (c) => c.toggleOrderedList(), active: (e) => e.isActive('orderedList') },
];

/** Entries of the paragraph style menu, by `<option>` value. */
const STYLES: Record<string, { label: string; run(chain: ChainedCommands): ChainedCommands; level?: 1 | 2 | 3 }> = {
  paragraph: { label: 'Normal text', run: (c) => c.setParagraph() },
  'heading-1': { label: 'Heading 1', run: (c) => c.setHeading({ level: 1 }), level: 1 },
  'heading-2': { label: 'Heading 2', run: (c) => c.setHeading({ level: 2 }), level: 2 },
  'heading-3': { label: 'Heading 3', run: (c) => c.setHeading({ level: 3 }), level: 3 },
};

function currentStyle(editor: Editor): string {
  for (const [value, style] of Object.entries(STYLES)) {
    if (style.level ? editor.isActive('heading', { level: style.level }) : editor.isActive('paragraph')) return value;
  }
  return '';
}

/**
 * The Visual view's formatting toolbar: undo/redo, a paragraph style menu
 * (normal text, headings 1–3), bold/italic and the two list kinds. Buttons
 * reflect the selection (pressed, disabled) after every transaction and never
 * take the focus away from the text.
 */
export class Toolbar {
  private readonly root: HTMLElement;
  private readonly refreshers: (() => void)[] = [];
  private readonly refresh = () => this.refreshers.forEach((fn) => fn());

  constructor(parent: HTMLElement, private readonly editor: Editor) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'typst-toolbar';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Formatting');
    // Keep the selection in the text: buttons act on it, they must not take focus.
    this.root.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('button')) event.preventDefault();
    });
    this.root.append(
      this.group(HISTORY),
      this.styleMenu(),
      this.group(MARKS),
      this.group(LISTS),
    );
    parent.prepend(this.root);
    editor.on('transaction', this.refresh);
    editor.on('focus', this.refresh);
    this.refresh();
  }

  destroy(): void {
    this.editor.off('transaction', this.refresh);
    this.editor.off('focus', this.refresh);
    this.root.remove();
  }

  private group(actions: Action[]): HTMLElement {
    const group = this.root.ownerDocument.createElement('div');
    group.className = 'typst-toolbar__group';
    group.append(...actions.map((action) => this.button(action)));
    return group;
  }

  private button(action: Action): HTMLButtonElement {
    const button = this.root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'typst-toolbar__button';
    button.innerHTML = action.icon;
    button.setAttribute('aria-label', action.label);
    button.title = action.shortcut ? `${action.label} (${shortcutText(action.shortcut)})` : action.label;
    button.addEventListener('click', () => action.run(this.editor.chain().focus()).run());
    this.refreshers.push(() => {
      button.disabled = !action.run(this.editor.can().chain()).run();
      if (action.active) button.setAttribute('aria-pressed', String(action.active(this.editor)));
    });
    return button;
  }

  private styleMenu(): HTMLElement {
    const select = this.root.ownerDocument.createElement('select');
    select.className = 'typst-toolbar__style';
    select.setAttribute('aria-label', 'Text style');
    select.title = 'Text style';
    for (const [value, style] of Object.entries(STYLES)) select.add(new Option(style.label, value));
    select.addEventListener('change', () => STYLES[select.value]?.run(this.editor.chain().focus()).run());
    this.refreshers.push(() => {
      select.value = currentStyle(this.editor);
      for (const option of select.options) option.disabled = !STYLES[option.value].run(this.editor.can().chain()).run();
    });
    const group = this.root.ownerDocument.createElement('div');
    group.className = 'typst-toolbar__group';
    group.append(select);
    return group;
  }
}

function shortcutText(shortcut: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return shortcut.replace('Mod', mac ? '⌘' : 'Ctrl').replace('Shift', mac ? '⇧' : 'Shift').replace(/\+/g, mac ? '' : '+');
}
