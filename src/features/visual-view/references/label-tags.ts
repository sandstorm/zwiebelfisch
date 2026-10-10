// Label tags: a block's label (`= Intro <intro>`) drawn as a small tag on the block, edited in a popover.
// See references.ts.
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { ProjectLabels } from '../../labels/labels';
import { FieldPopover } from '../field-popover';
import { labelName, renameLabel, setLabel } from './label-edits';

/** What the tags need besides the document: the project's labels (for "Rename and update N references"). */
export interface LabelTagsOptions {
  labels?: ProjectLabels;
  /** The document this view shows: its references are renamed in the view, the other files' by `labels`. */
  document?: TypstDocument;
}

const key = new PluginKey<DecorationSet>('typstLabelTags');

/**
 * Draws every labelled block's label as a tag: at the end of a heading's or
 * paragraph's text, or below other blocks (figures, equations, tables). A
 * click on the tag opens a popover to rename the label (optionally with every
 * reference to it in the project) or remove it; each is one undo step here.
 */
export function labelTags(options: LabelTagsOptions): Plugin {
  return new Plugin({
    key,
    state: {
      init: (_, state) => tags(state.doc, options),
      apply: (tr, old) => (tr.docChanged ? tags(tr.doc, options) : old),
    },
    props: { decorations: (state) => key.getState(state) },
  });
}

function tags(doc: Node, options: LabelTagsOptions): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    const name: string | undefined = node.attrs.label?.name;
    if (name === undefined) return true;
    const inline = node.isTextblock;
    const at = inline ? pos + node.nodeSize - 1 : pos + node.nodeSize;
    const toDOM = (view: EditorView, getPos: () => number | undefined) =>
      tagElement({ view, name, inline, block: () => blockAt(view, getPos(), inline), options });
    decorations.push(Decoration.widget(at, toDOM, { key: `label:${inline}:${name}`, side: inline ? 1 : -1, ignoreSelection: true, stopEvent: () => true }));
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/** The position of the block a tag at `widget` belongs to: the textblock it ends, or the block before it. */
function blockAt(view: EditorView, widget: number | undefined, inline: boolean): number | null {
  if (widget === undefined) return null;
  const $pos = view.state.doc.resolve(widget);
  if (inline) return $pos.depth > 0 ? $pos.before() : null;
  return $pos.nodeBefore ? widget - $pos.nodeBefore.nodeSize : null;
}

/** One drawn tag: the label's name, where it is drawn, how to find its block now, and the view's options. */
interface Tag {
  view: EditorView;
  name: string;
  /** Drawn in the text (at the end of a textblock) rather than below a block. */
  inline: boolean;
  /** The position of the labelled block in the current document. */
  block(): number | null;
  options: LabelTagsOptions;
}

function tagElement(tag: Tag): HTMLElement {
  const { view, name, inline } = tag;
  const doc = view.dom.ownerDocument;
  const wrap = doc.createElement('span');
  wrap.className = `typst-label-tag${inline ? '' : ' typst-label-tag--block'}`;
  wrap.contentEditable = 'false';
  const button = wrap.appendChild(doc.createElement('button'));
  button.type = 'button';
  button.className = 'typst-label-tag__name';
  button.dataset.testid = 'typst-label-tag';
  button.textContent = name;
  button.title = `Label <${name}>: click to rename or remove it`;
  let popover: FieldPopover | null = null;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    popover?.destroy();
    popover = tagPopover(tag, wrap);
    popover.open(button, name, true);
  });
  return wrap;
}

/** The popover of the tag of label `name`: rename, rename with the references, remove. */
function tagPopover({ view, name, block, options }: Tag, wrap: HTMLElement): FieldPopover {
  const { labels, document } = options;
  const references = labels?.referenceCount(name) ?? 0;
  const rename = (value: string, withReferences: boolean) => {
    const next = labelName(value);
    const pos = block();
    if (next === null || next === name || pos === null) return;
    view.dispatch(renameLabel(view.state, pos, next, withReferences));
    if (withReferences) labels?.renameReferences(name, next, document);
    view.focus();
  };
  return new FieldPopover(wrap, {
    label: 'Label',
    field: 'Label name',
    placeholder: 'e.g. intro',
    apply: (value) => rename(value, false),
    alternative: references > 0 ? { text: `Rename and update ${references} reference${references === 1 ? '' : 's'}`, apply: (value) => rename(value, true) } : undefined,
    remove: () => {
      const pos = block();
      if (pos !== null) view.dispatch(setLabel(view.state, pos, null));
      view.focus();
    },
  });
}
