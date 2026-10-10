// StyleMenu: the toolbar's text style menu — normal text, headings, and the project's custom styles. See visual-view.ts.
import type { ChainedCommands, Editor } from '@tiptap/core';
import type { Disposable } from '../../../core/disposable/disposable';
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { Style } from '../model/discover';

/** The custom styles the menu offers, and what happens around applying one. */
export interface MenuStyles {
  /** The project's styles (paragraph and text styles). */
  styles(): readonly Style[];
  /** Whenever `styles()` changed. */
  readonly onDidChange: Event<void>;
  /** `style` was just applied (e.g. to import it where it is used). */
  applied(style: Style): void;
  /** "New style…". */
  create(): void;
}

/** The built-in entries, by `<option>` value. */
const BUILT_IN: Record<string, { label: string; run(chain: ChainedCommands, editor: Editor): ChainedCommands; level?: 1 | 2 | 3 }> = {
  // Normal text also takes the blocks out of a paragraph style
  paragraph: { label: 'Normal text', run: (c, editor) => (editor.isActive('styledBlock') ? c.unsetParagraphStyle() : c).setParagraph() },
  'heading-1': { label: 'Heading 1', run: (c) => c.setHeading({ level: 1 }), level: 1 },
  'heading-2': { label: 'Heading 2', run: (c) => c.setHeading({ level: 2 }), level: 2 },
  'heading-3': { label: 'Heading 3', run: (c) => c.setHeading({ level: 3 }), level: 3 },
};

const NEW_STYLE = 'new-style';

/**
 * The text style `<select>`: *Normal text*, *Heading 1–3*, then the
 * project's paragraph styles (wrap the selected blocks, `#note[..]`) and text
 * styles (toggle on the selection, `#key[..]`; marked ✓ where on), and "New
 * style…". It shows the selection's style (a heading, else the paragraph
 * style around it, else normal text) and disables what cannot apply. The
 * custom entries follow the project's styles as they change.
 */
export class StyleMenu {
  readonly element: HTMLSelectElement;
  private shown = '';
  private readonly subscription: Disposable;

  constructor(
    doc: Document,
    private readonly editor: Editor,
    private readonly styles: MenuStyles,
  ) {
    this.element = doc.createElement('select');
    this.element.className = 'typst-toolbar__style';
    this.element.setAttribute('aria-label', 'Text style');
    this.element.title = 'Text style';
    this.element.addEventListener('change', () => this.choose(this.element.value));
    this.subscription = styles.onDidChange(() => this.refresh());
    this.refresh();
  }

  /** Shows the selection's style and what can apply now; rebuilds the custom entries when the styles changed. */
  refresh(): void {
    const custom = this.styles.styles();
    const key = JSON.stringify(custom);
    if (key !== this.shown) this.build(custom);
    this.shown = key;
    for (const option of this.element.options) {
      const style = this.custom(option.value);
      if (style?.kind === 'text') option.text = `${this.editor.isActive('style', { name: style.name }) ? '✓ ' : ''}${style.label}`;
      option.disabled = !this.can(option.value);
    }
    this.element.value = this.current();
  }

  destroy(): void {
    this.subscription.dispose();
    this.element.remove();
  }

  private build(custom: readonly Style[]): void {
    const doc = this.element.ownerDocument;
    this.element.replaceChildren(...Object.entries(BUILT_IN).map(([value, { label }]) => new Option(label, value)));
    for (const [kind, title] of [['paragraph', 'Paragraph styles'], ['text', 'Text styles']] as const) {
      const styles = custom.filter((style) => style.kind === kind);
      if (styles.length === 0) continue;
      const group = doc.createElement('optgroup');
      group.label = title;
      group.append(...styles.map((style) => new Option(style.label, `${kind}:${style.name}`)));
      this.element.append(group);
    }
    this.element.append(new Option('New style…', NEW_STYLE));
  }

  private choose(value: string): void {
    const style = this.custom(value);
    if (value === NEW_STYLE) this.styles.create();
    else if (style) {
      const applied = { name: style.name, label: style.label };
      const chain = this.editor.chain().focus();
      (style.kind === 'paragraph' ? chain.setParagraphStyle(applied) : chain.toggleTextStyle(applied)).run();
      this.styles.applied(style);
    } else BUILT_IN[value]?.run(this.editor.chain().focus(), this.editor).run();
    this.refresh();
  }

  private can(value: string): boolean {
    const style = this.custom(value);
    if (value === NEW_STYLE) return true;
    if (!style) return BUILT_IN[value].run(this.editor.can().chain(), this.editor).run();
    const applied = { name: style.name, label: style.label };
    return style.kind === 'paragraph' ? this.editor.can().setParagraphStyle(applied) : !this.editor.state.selection.empty && this.editor.can().toggleTextStyle(applied);
  }

  /** The option of the selection's style: a heading, else the paragraph style around it, else normal text. */
  private current(): string {
    for (const [value, { level }] of Object.entries(BUILT_IN)) if (level && this.editor.isActive('heading', { level })) return value;
    if (this.editor.isActive('styledBlock')) return `paragraph:${this.editor.getAttributes('styledBlock').name}`;
    return this.editor.isActive('paragraph') ? 'paragraph' : '';
  }

  /** The custom style an option value stands for. */
  private custom(value: string): Style | undefined {
    const [kind, name] = value.split(':');
    return this.styles.styles().find((style) => style.kind === kind && style.name === name);
  }
}
