// BoxActionBar: the buttons of the contributed box actions (`registerBoxAction`) that apply to one raw box,
// kept up to date with its node. See raw-box.ts.
import type { Node } from '@tiptap/pm/model';
import type { BoxAction } from '../contributions/boxes';
import type { VisualViewContext } from '../contributions/view-context';

/**
 * A raw box's action buttons (`.typst-visual__box-actions`): one per contributed action whose `when` holds for the
 * box's node, in registration order, asked again on every `update`. Pressing one keeps the editor's selection and
 * runs the action with the box's current node.
 */
export class BoxActionBar {
  readonly element: HTMLElement;
  private node: Node;
  /** The actions shown now. */
  private shown: readonly BoxAction[] = [];

  constructor(
    doc: Document,
    private readonly actions: readonly BoxAction[],
    private readonly view: VisualViewContext,
    node: Node,
  ) {
    this.node = node;
    this.element = doc.createElement('span');
    this.element.className = 'typst-visual__box-actions';
    this.element.addEventListener('mousedown', (event) => {
      if ((event.target as Element).closest('button')) event.preventDefault();
    });
    this.update(node);
  }

  update(node: Node): void {
    this.node = node;
    const doc = this.element.ownerDocument;
    const shown = this.actions.filter((action) => action.when?.(node, this.view) ?? true);
    if (shown.length === this.shown.length && shown.every((action, i) => action === this.shown[i])) return;
    this.shown = shown;
    this.element.replaceChildren(
      ...shown.map((action) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = action.title;
        button.addEventListener('click', () => action.run(this.node, this.view));
        return button;
      }),
    );
  }
}
