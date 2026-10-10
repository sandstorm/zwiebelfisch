// Toolbar: the Visual view's formatting toolbar (styles, marks, lists, alignment, insert). Entry of
// visual-view/toolbar/. See ARCHITECTURE.md, "VisualView".
import type { ChainedCommands, Editor } from '@tiptap/core';
import { FieldPopover } from '../field-popover';
import { type ImageAssets, ImageChoices, imageFileDrops, insertImages } from '../images/images';
import { TextSelection, type Plugin } from '@tiptap/pm/state';
import { textAlignAt, type TextAlignment } from '../nodes/nodes';
import { svg, type Action } from './toolbar-action';
import { BLOCKS as QUOTE_AND_TASKS, BREAKS, HEADER_ROW } from './toolbar-blocks';

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
  link: svg('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
  code: svg('<path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/>'),
  codeBlock: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9-3 3 3 3"/><path d="m14 9 3 3-3 3"/>'),
  outline: svg('<path d="M4 6h10M7 10h13M7 14h13M4 18h10"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M12 4v16"/>'),
  addRow: svg('<rect x="3" y="4" width="18" height="9" rx="2"/><path d="M12 16v5M9.5 18.5h5"/>'),
  addColumn: svg('<rect x="3" y="3" width="9" height="18" rx="2"/><path d="M15 12h5M17.5 9.5v5"/>'),
  deleteRow: svg('<rect x="3" y="4" width="18" height="9" rx="2"/><path d="M9.5 18.5h5"/>'),
  deleteColumn: svg('<rect x="3" y="3" width="9" height="18" rx="2"/><path d="M15 12h5"/>'),
  alignLeft: svg('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
  alignCenter: svg('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  alignRight: svg('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
  alignJustify: svg('<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>'),
  comment: svg('<path d="M4 5h16v11h-9l-5 4v-4H4z"/>'),
};

const HISTORY: Action[] = [
  { label: 'Undo', shortcut: 'Mod+Z', icon: ICONS.undo, run: (c) => c.undo() },
  { label: 'Redo', shortcut: 'Mod+Shift+Z', icon: ICONS.redo, run: (c) => c.redo() },
];
const MARKS: Action[] = [
  { label: 'Bold', shortcut: 'Mod+B', icon: ICONS.bold, run: (c) => c.toggleBold(), active: (e) => e.isActive('bold') },
  { label: 'Italic', shortcut: 'Mod+I', icon: ICONS.italic, run: (c) => c.toggleItalic(), active: (e) => e.isActive('italic') },
  { label: 'Code', shortcut: 'Mod+E', icon: ICONS.code, run: (c) => c.toggleCode(), active: (e) => e.isActive('code') },
];
const LISTS: Action[] = [
  { label: 'Bulleted list', icon: ICONS.bulletList, run: (c) => c.toggleBulletList(), active: (e) => e.isActive('bulletList') },
  { label: 'Numbered list', icon: ICONS.orderedList, run: (c) => c.toggleOrderedList(), active: (e) => e.isActive('orderedList') },
  { label: 'Code block', icon: ICONS.codeBlock, run: (c) => c.toggleCodeBlock(), active: (e) => e.isActive('codeBlock') },
];
const OUTLINE: Action = {
  label: 'Table of contents',
  icon: ICONS.outline,
  run: (c) => c.insertContent({ type: 'outline', attrs: { src: '#outline()' } }),
};

/** Radio-like: the button of the selection's (effective) alignment is pressed. */
const alignAction = (label: string, alignment: TextAlignment, shortcut: string, icon: string): Action => ({
  label,
  shortcut,
  icon,
  run: (c) => c.setTextAlign(alignment),
  active: (e) => textAlignAt(e.state) === alignment,
});
const ALIGNMENTS: Action[] = [
  alignAction('Align left', 'left', 'Mod+Shift+L', ICONS.alignLeft),
  alignAction('Center', 'center', 'Mod+Shift+E', ICONS.alignCenter),
  alignAction('Align right', 'right', 'Mod+Shift+R', ICONS.alignRight),
  alignAction('Justify', 'justify', 'Mod+Shift+J', ICONS.alignJustify),
];

const TABLES: Action[] = [
  { label: 'Insert table', icon: ICONS.table, run: (c) => c.insertTable({ rows: 2, cols: 2, withHeaderRow: false }) },
  { label: 'Add row', icon: ICONS.addRow, run: (c) => c.addRowAfter() },
  { label: 'Add column', icon: ICONS.addColumn, run: (c) => c.addColumnAfter() },
  { label: 'Delete row', icon: ICONS.deleteRow, run: (c) => c.deleteRow() },
  { label: 'Delete column', icon: ICONS.deleteColumn, run: (c) => c.deleteColumn() },
];

/** Links the selection (or the link around the cursor) to `href`; with nothing selected, inserts `href` as linked text. */
function applyLink(editor: Editor, href: string): void {
  const chain = editor.chain().focus();
  if (editor.state.selection.empty && !editor.isActive('link')) {
    chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
  } else {
    chain.extendMarkRange('link').setLink({ href }).run();
  }
}

export interface ToolbarOptions {
  /** Lets "Insert image" offer the project's images and upload new ones. */
  assets?: ImageAssets;
  /** Adds a comment (margin note) at the selection: shows the "Comment" button. */
  comment?(): void;
}

/** "Comment": enabled with a caret or selection in text (not in a code block or on a selected box). */
function commentAction(comment: () => void): Action {
  return {
    label: 'Comment',
    shortcut: 'Mod+Alt+M',
    icon: ICONS.comment,
    run: (c) => c,
    click: () => comment(),
    enabled: (editor) => {
      const { selection } = editor.state;
      const { parent } = selection.$from;
      return selection instanceof TextSelection && parent.inlineContent && !parent.type.spec.code;
    },
  };
}

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
 * (normal text, headings 1–3), bold/italic/inline code, link (Mod+K, asks for
 * the URL in a popover), the two list kinds and code block, text alignment
 * (left, center, right, justify), insert image (asks for its path, or offers
 * the project's images and an upload when given `assets`), table of contents
 * (`#outline()`), table editing and, given `comment`, "Comment" (adds a
 * margin note; Mod+Alt+M is the widget's). Buttons reflect the selection
 * (pressed, disabled) after every transaction and never take the focus away
 * from the text.
 */
export class Toolbar {
  private readonly root: HTMLElement;
  private readonly refreshers: (() => void)[] = [];
  private readonly refresh = () => this.refreshers.forEach((fn) => fn());
  private readonly linkPopover: FieldPopover;
  private readonly imagePopover: FieldPopover;
  /** Takes image files dropped on or pasted into the text (with `assets` only). */
  private imageFiles: Plugin | null = null;
  private readonly linkShortcut = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if ((event.target as Element).closest?.('.cm-editor')) return; // in a raw box
    event.preventDefault();
    this.root.querySelector<HTMLButtonElement>('button[aria-label="Link"]')?.click();
  };

  constructor(
    parent: HTMLElement,
    private readonly editor: Editor,
    { assets, comment }: ToolbarOptions = {},
  ) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'typst-toolbar';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Formatting');
    // Keep the selection in the text: buttons act on it, they must not take focus.
    this.root.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('button')) event.preventDefault();
    });
    this.linkPopover = new FieldPopover(this.root, {
      label: 'Link',
      field: 'URL',
      placeholder: 'https://…',
      apply: (href) => applyLink(editor, href),
      remove: () => editor.chain().focus().extendMarkRange('link').unsetLink().run(),
    });
    const [image, imagePopover] = this.imageAction(assets);
    this.imagePopover = imagePopover;
    const link: Action = {
      label: 'Link',
      shortcut: 'Mod+K',
      icon: ICONS.link,
      run: (c) => c.setLink({ href: 'https://typst.app' }),
      click: (button) => this.toggle(this.linkPopover, button, editor.getAttributes('link').href ?? '', editor.isActive('link')),
      active: (e) => e.isActive('link'),
    };
    this.root.append(
      this.group(HISTORY),
      this.styleMenu(),
      this.group([...MARKS, link]),
      this.group(LISTS),
      this.group(QUOTE_AND_TASKS),
      this.group(ALIGNMENTS),
      this.group([image, OUTLINE, ...TABLES, HEADER_ROW]),
      this.group(BREAKS),
    );
    if (comment) this.root.append(this.group([commentAction(comment)]));
    parent.prepend(this.root);
    editor.view.dom.addEventListener('keydown', this.linkShortcut);
    editor.on('transaction', this.refresh);
    editor.on('focus', this.refresh);
    this.refresh();
  }

  destroy(): void {
    if (this.imageFiles) this.editor.unregisterPlugin(this.imageFiles.spec.key!);
    this.editor.view.dom.removeEventListener('keydown', this.linkShortcut);
    this.linkPopover.destroy();
    this.imagePopover.destroy();
    this.editor.off('transaction', this.refresh);
    this.editor.off('focus', this.refresh);
    this.root.remove();
  }

  /**
   * "Insert image" and its popover: a path field, plus the project's images
   * and an upload with `assets`. With them, image files dropped on or pasted
   * into the text are uploaded and inserted too (refusals open the popover),
   * and an image dragged from the file panel is inserted where it is dropped.
   */
  private imageAction(assets: ImageAssets | undefined): [Action, FieldPopover] {
    const choices = assets
      ? new ImageChoices(this.root.ownerDocument, assets, (paths, near) => {
          popover.close();
          insertImages(this.editor, paths, near);
        })
      : null;
    const popover = new FieldPopover(this.root, {
      label: 'Image',
      field: 'Image path',
      placeholder: 'images/figure.png',
      apply: (path) => insertImages(this.editor, [path]),
      extra: choices?.element,
    });
    if (choices) {
      this.imageFiles = imageFileDrops(
        async (files, near) => {
          const added = await choices.upload(files, near);
          const button = this.root.querySelector<HTMLButtonElement>('button[aria-label="Insert image"]');
          if (!added && !popover.isOpen && button) popover.open(button, '', false);
        },
        (path, near) => {
          const reference = assets!.reference(path);
          if (reference !== null) insertImages(this.editor, [reference], near);
          return reference !== null;
        },
      );
      this.editor.registerPlugin(this.imageFiles);
    }
    const action: Action = {
      label: 'Insert image',
      icon: ICONS.image,
      run: (c) => c.insertContent({ type: 'image' }),
      click: (button) => {
        choices?.refresh();
        this.toggle(popover, button, '', false);
      },
    };
    return [action, popover];
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
    button.addEventListener('click', () => (action.click ? action.click(button) : action.run(this.editor.chain().focus()).run()));
    this.refreshers.push(() => {
      button.disabled = action.enabled ? !action.enabled(this.editor) : !action.run(this.editor.can().chain()).run();
      if (action.active) button.setAttribute('aria-pressed', String(action.active(this.editor)));
    });
    return button;
  }

  private toggle(popover: FieldPopover, button: HTMLButtonElement, value: string, removable: boolean): void {
    if (popover.isOpen) popover.close();
    else popover.open(button, value, removable);
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
  return shortcut.replace('Mod', mac ? '⌘' : 'Ctrl').replace('Shift', mac ? '⇧' : 'Shift').replace('Alt', mac ? '⌥' : 'Alt').replace(/\+/g, mac ? '' : '+');
}
