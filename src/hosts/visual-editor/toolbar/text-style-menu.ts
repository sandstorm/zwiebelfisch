// TextStyleMenu. See toolbar.ts and docs/30_architecture/04_visual-editor.typ.
import type { ChainedCommands, Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type { Disposable } from '../../../core/disposable/disposable';
import type { TextStyle, TextStyleProvider, ToolbarControl, VisualEditorContext } from '../visual-editor';

/**
 * The text style `<select>`: *Normal text*, then the providers' entries by
 * `order`, a section's under its title (`<optgroup>`). It shows the
 * selection's style (the first active entry that is no toggle, else normal
 * text in a paragraph), marks toggles ✓ where they are on, and disables what
 * cannot apply. The entries follow the providers as they change.
 *
 * The toolbar's text style menu — "Normal text" and what the text style providers contribute (headings, custom styles).
 */
export class TextStyleMenu implements ToolbarControl {
  readonly element: HTMLSelectElement;
  private entries: readonly TextStyle[] = [];
  private readonly subscriptions: Disposable[];

  constructor(
    doc: Document,
    private readonly editor: Editor,
    private readonly view: VisualEditorContext,
    private readonly providers: readonly TextStyleProvider[],
  ) {
    this.element = doc.createElement('select');
    this.element.className = 'typst-toolbar__style';
    this.element.setAttribute('aria-label', 'Text style');
    this.element.title = 'Text style';
    this.element.addEventListener('change', () => this.choose(this.element.value));
    this.subscriptions = providers.flatMap((provider) => (provider.onDidChangeTextStyles ? [provider.onDidChangeTextStyles(() => this.update())] : []));
    this.update();
  }

  /** Shows the selection's style and what can apply now. */
  refresh(): void {
    for (const option of this.element.options) {
      const entry = this.entry(option.value);
      if (entry?.toggle) option.text = `${entry.isActive?.(this.editor) ? '✓ ' : ''}${entry.label}`;
      option.disabled = !this.can(option.value);
    }
    this.element.value = this.current();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.element.remove();
  }

  /** Asks the providers again and rebuilds the options. */
  private update(): void {
    this.entries = textStyleEntries(this.providers, this.view);
    const doc = this.element.ownerDocument;
    this.element.replaceChildren(new Option('Normal text', NORMAL_TEXT));
    let section: HTMLOptGroupElement | null = null;
    for (const entry of this.entries) {
      const option = new Option(entry.label, entry.id);
      if (!entry.section) section = null;
      else if (section?.label !== entry.section) {
        section = doc.createElement('optgroup');
        section.label = entry.section;
        this.element.append(section);
      }
      (section ?? this.element).append(option);
    }
    this.refresh();
  }

  private choose(id: string): void {
    const entry = this.entry(id);
    this.command(id, this.editor.chain().focus())?.run();
    entry?.applied?.();
    this.refresh();
  }

  private can(id: string): boolean {
    const entry = this.entry(id);
    if (entry?.enabled) return entry.enabled(this.editor);
    return this.command(id, this.editor.can().chain())?.run() ?? false;
  }

  /** What choosing `id` does, on `chain`. */
  private command(id: string, chain: ChainedCommands): ChainedCommands | undefined {
    if (id === NORMAL_TEXT) {
      const styled = this.entries.find((entry) => entry.remove && entry.isActive?.(this.editor));
      // setParagraph fails on blocks that are paragraphs already, e.g. those a block style was just taken off
      return (styled ? styled.remove!(chain) : chain).command(({ state, commands }) => onlyParagraphs(state) || commands.setParagraph());
    }
    return this.entry(id)?.apply(chain, this.editor);
  }

  /** The option of the selection's style: the first active entry that is no toggle, else normal text in a paragraph. */
  private current(): string {
    const active = this.entries.find((entry) => !entry.toggle && entry.isActive?.(this.editor));
    if (active) return active.id;
    return this.editor.isActive('paragraph') ? NORMAL_TEXT : '';
  }

  private entry(id: string): TextStyle | undefined {
    return this.entries.find((entry) => entry.id === id);
  }
}

/** The providers' entries for `view`, by `order` (equal: as provided): the menu's entries after "Normal text". */
export function textStyleEntries(providers: readonly TextStyleProvider[], view: VisualEditorContext): TextStyle[] {
  const provided = providers.flatMap((provider) => provider.provideTextStyles(view));
  return provided.map((entry, index) => ({ entry, index })).sort((a, b) => (a.entry.order ?? 0) - (b.entry.order ?? 0) || a.index - b.index).map(({ entry }) => entry);
}

/** The host's own entry: paragraphs, after taking off the selection's style. */
const NORMAL_TEXT = 'paragraph';

/** Whether every text block the selection touches is a paragraph (Normal text has nothing to change there). */
function onlyParagraphs({ doc, selection }: EditorState): boolean {
  let only = true;
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isTextblock && node.type.name !== NORMAL_TEXT) only = false;
    return only;
  });
  return only;
}
