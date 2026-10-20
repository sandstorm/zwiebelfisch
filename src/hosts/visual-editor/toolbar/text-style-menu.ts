// See Toolbar in toolbar.ts.
import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type { MenuItem } from '../../commands/commands';
import type { VisualEditorMenuContext } from '../visual-editor';
import type { ToolbarMenus } from './toolbar';

/**
 * The text style `<select>`: *Normal text*, then the entries of the menu `visualEditor/textStyle` as the workbench
 * sorts them, consecutive ones of one `category` under its title.
 *
 * Its value is the first entry whose `toggled` holds, outside the group `inline`: those are toggles on the selection's
 * text, marked ✓ where on and never the value. It disables what cannot apply (`enabled`, looked at when the menu is
 * pressed), and follows the menu as its entries change (headings, custom styles). Choosing an entry runs its command
 * with the menu context. "Normal text" is the host's, the paragraph being its own node: it runs the command of the
 * value's entry (an entry chosen where it is on takes itself off, as a heading level or a block style) and makes the
 * blocks paragraphs.
 *
 * @internal Extensions add to it through `workbench.registerMenuItem('visualEditor/textStyle', ..)`.
 */
export class TextStyleMenu {
  readonly element: HTMLSelectElement;
  private entries: readonly MenuItem<VisualEditorMenuContext>[] = [];

  constructor(
    doc: Document,
    private readonly tiptap: Editor,
    private readonly context: VisualEditorMenuContext,
    private readonly menus: ToolbarMenus,
  ) {
    this.element = doc.createElement('select');
    this.element.className = 'zwf-toolbar__style';
    this.element.setAttribute('aria-label', 'Text style');
    this.element.title = 'Text style';
    this.element.addEventListener('change', () => this.choose(this.element.value));
    // before the list opens (a click, the keyboard after focus)
    this.element.addEventListener('mousedown', () => this.refreshOptions());
    this.element.addEventListener('focus', () => this.refreshOptions());
  }

  /** The menu's entries now. */
  items(): readonly MenuItem<VisualEditorMenuContext>[] {
    return this.menus.getMenuItems(TEXT_STYLE, this.context);
  }

  /** Follows the entries; shows the selection's style, and what can apply now while the menu has the focus. */
  refresh(): void {
    const items = this.items();
    if (items.length !== this.entries.length || items.some((item, i) => item !== this.entries[i])) this.update(items);
    if (this.element.ownerDocument.activeElement === this.element) this.refreshOptions();
    this.element.value = this.current();
  }

  dispose(): void {
    this.element.remove();
  }

  /** Marks toggles ✓ where they are on and disables what cannot apply. */
  private refreshOptions(): void {
    for (const option of this.element.options) {
      const entry = this.entry(option.value);
      if (entry && isToggle(entry)) option.text = `${entry.toggled?.(this.context) ? '✓ ' : ''}${title(entry)}`;
      option.disabled = entry ? !(entry.enabled?.(this.context) ?? true) : !this.canNormalText();
    }
  }

  /** The options anew: Normal text, then `items`, those of a category under its title. */
  private update(items: readonly MenuItem<VisualEditorMenuContext>[]): void {
    this.entries = items;
    const doc = this.element.ownerDocument;
    this.element.replaceChildren(new Option('Normal text', NORMAL_TEXT));
    let section: HTMLOptGroupElement | null = null;
    for (const entry of items) {
      const option = new Option(title(entry), entry.command);
      if (!entry.category) section = null;
      else if (section?.label !== entry.category) {
        section = doc.createElement('optgroup');
        section.label = entry.category;
        this.element.append(section);
      }
      (section ?? this.element).append(option);
    }
  }

  private choose(value: string): void {
    if (value === NORMAL_TEXT) this.normalText();
    else this.run(value);
    this.refresh();
  }

  /** Takes off the selection's style (its entry's command again), then makes its blocks paragraphs. */
  private normalText(): void {
    const styled = this.styled();
    if (styled) this.run(styled.command);
    // setParagraph fails on blocks that are paragraphs already, e.g. those a block style was just taken off
    if (!onlyParagraphs(this.tiptap.state)) this.tiptap.chain().focus().setParagraph().run();
  }

  private canNormalText(): boolean {
    return this.styled() !== undefined || onlyParagraphs(this.tiptap.state) || this.tiptap.can().setParagraph();
  }

  private run(command: string): void {
    this.menus.executeCommand(command, this.context).catch((error: unknown) => console.error(`Command ${command} failed:`, error));
  }

  /** The entry of the selection's style: the first that is on and no toggle. */
  private styled(): MenuItem<VisualEditorMenuContext> | undefined {
    return this.entries.find((entry) => !isToggle(entry) && entry.toggled?.(this.context));
  }

  /** The option of the selection's style, else normal text in a paragraph. */
  private current(): string {
    const styled = this.styled();
    if (styled) return styled.command;
    return this.tiptap.isActive('paragraph') ? NORMAL_TEXT : '';
  }

  private entry(command: string): MenuItem<VisualEditorMenuContext> | undefined {
    return this.entries.find((entry) => entry.command === command);
  }
}

/** The menu. */
export const TEXT_STYLE = 'visualEditor/textStyle';

/** The host's own option: paragraphs, after taking off the selection's style. */
const NORMAL_TEXT = 'paragraph';

/** The group of the toggles (inline styles), applied on top of the block's style. */
const TOGGLES = 'inline';

function isToggle(entry: MenuItem<VisualEditorMenuContext>): boolean {
  return entry.group === TOGGLES;
}

function title(entry: MenuItem<VisualEditorMenuContext>): string {
  return entry.title ?? entry.command;
}

/** Whether every text block the selection touches is a paragraph (Normal text has nothing to change there). */
function onlyParagraphs({ doc, selection }: EditorState): boolean {
  let only = true;
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isTextblock && node.type.name !== NORMAL_TEXT) only = false;
    return only;
  });
  return only;
}
