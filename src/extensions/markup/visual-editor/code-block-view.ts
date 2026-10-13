// The node view of code blocks: the language tag and the code. See markup in ../markup.ts.
import type { Editor, NodeViewRenderer } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import { codeLanguage } from '../model/raw-code';

export const codeBlockView: NodeViewRenderer = ({ node, editor, getPos }) => new CodeBlockView(node, editor, getPos);

/**
 * A code block: its text edited in place (monospace, plain text), under a
 * small header with a field for its language. The field accepts only what
 * Typst reads as a language tag and writes it to the node's `language` as
 * one types; Enter, Escape or ArrowDown in it move on to the code.
 */
class CodeBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly header: HTMLElement;
  private readonly language: HTMLInputElement;

  constructor(
    private node: Node,
    private readonly editor: Editor,
    private readonly getPos: () => number | undefined,
  ) {
    const doc = editor.view.dom.ownerDocument;
    this.dom = doc.createElement('div');
    this.dom.className = 'zwf-markup__code-block';
    this.dom.setAttribute('spellcheck', 'false');
    this.header = this.dom.appendChild(doc.createElement('div'));
    this.header.className = 'zwf-markup__code-header';
    this.header.contentEditable = 'false';
    const label = this.header.appendChild(doc.createElement('span'));
    label.textContent = 'Code';
    this.language = this.header.appendChild(doc.createElement('input'));
    this.language.className = 'zwf-markup__code-language';
    this.language.setAttribute('aria-label', 'Language');
    this.language.placeholder = 'language';
    this.language.spellcheck = false;
    this.language.value = node.attrs.language ?? '';
    this.language.addEventListener('input', () => this.setLanguage());
    this.language.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== 'Escape' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      this.focusCode();
    });
    const pre = this.dom.appendChild(doc.createElement('pre'));
    this.contentDOM = pre.appendChild(doc.createElement('code'));
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const language = node.attrs.language ?? '';
    if (this.language.value !== language) this.language.value = language;
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.header.contains(event.target as globalThis.Node);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return this.header.contains(mutation.target);
  }

  private setLanguage(): void {
    const value = codeLanguage(this.language.value);
    if (value !== this.language.value) this.language.value = value;
    const pos = this.getPos();
    if (pos === undefined || (this.node.attrs.language ?? '') === value) return;
    const { view } = this.editor;
    view.dispatch(view.state.tr.setNodeAttribute(pos, 'language', value || null));
  }

  /** Moves the cursor to the start of the code. */
  private focusCode(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const { view } = this.editor;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)).scrollIntoView());
    view.focus();
  }
}
