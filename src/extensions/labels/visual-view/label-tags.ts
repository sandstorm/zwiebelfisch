// Label tags: a block's label (`= Intro <intro>`) drawn as a small tag on the block, edited in a popover; a new
// label typed into a draft tag right where it will show.
// See references.ts.
import type { Node } from '@tiptap/pm/model';
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { ProjectLabels } from '../labels';
import { FieldPopover } from '../../../ui/field-popover/field-popover';
import { renameLabel, setLabel } from './label-edits';
import { labelName } from './reference-syntax';
import { labelPrefix, labelTarget } from './add-label';

/** What the tags need besides the document: the project's labels (renaming updates their references by default). */
export interface LabelTagsOptions {
  labels?: ProjectLabels;
  /** The document this view shows: its references are renamed in the view, the other files' by `labels`. */
  document?: TypstDocument;
}

/** The tags drawn, and the block a new label is being typed for (its position), if any. */
interface TagsState {
  decorations: DecorationSet;
  draft: number | null;
}

const key = new PluginKey<TagsState>('typstLabelTags');

/**
 * Draws every labelled block's label as a tag: at the end of a heading's or
 * paragraph's text, or below other blocks (figures, equations, tables). A
 * click on the tag opens a popover to rename the label (optionally with every
 * reference to it in the project) or remove it; each is one undo step here.
 * `startNewLabel` draws a draft tag with a field at the same place instead.
 */
export function labelTags(options: LabelTagsOptions): Plugin {
  return new Plugin<TagsState>({
    key,
    state: {
      init: (_, state) => ({ decorations: tags(state.doc, null, options), draft: null }),
      apply: (tr, old) => {
        const meta: { draft: number | null } | undefined = tr.getMeta(key);
        const draft = meta ? meta.draft : old.draft === null ? null : tr.mapping.map(old.draft);
        if (!tr.docChanged && draft === old.draft) return old;
        return { decorations: tags(tr.doc, draft, options), draft };
      },
    },
    props: { decorations: (state) => key.getState(state)!.decorations },
  });
}

/**
 * Starts a new label on the figure or block the selection is in (see
 * `labelTarget`): a draft tag where the label will show, holding a field
 * (prefilled `fig:`, `tab:` or `sec:`). Enter adds the label, Escape or
 * leaving the field drops it. False when there is no such block or it has a
 * label already.
 */
export function startNewLabel(view: EditorView): boolean {
  const target = canStartNewLabel(view.state);
  if (target === null) return false;
  view.dispatch(view.state.tr.setMeta(key, { draft: target }));
  return true;
}

/** The block a new label would go on (its position), or null (none, or it has one). */
export function canStartNewLabel(state: EditorState): number | null {
  const target = labelTarget(state);
  return target && !target.node.attrs.label ? target.pos : null;
}

function tags(doc: Node, draft: number | null, options: LabelTagsOptions): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    const name: string | undefined = node.attrs.label?.name;
    const inline = node.isTextblock;
    const at = inline ? pos + node.nodeSize - 1 : pos + node.nodeSize;
    const spec = { side: inline ? 1 : -1, ignoreSelection: true, stopEvent: () => true };
    if (pos === draft && name === undefined) {
      const toDOM = (view: EditorView) => draftElement(view, pos, labelPrefix(node), inline);
      decorations.push(Decoration.widget(at, toDOM, { ...spec, key: `draft:${pos}` }));
    }
    if (name === undefined) return true;
    const toDOM = (view: EditorView, getPos: () => number | undefined) =>
      tagElement({ view, name, inline, block: () => blockAt(view, getPos(), inline), options });
    decorations.push(Decoration.widget(at, toDOM, { ...spec, key: `label:${inline}:${name}` }));
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/** The draft tag: a field for the new label of the block at `pos`; Enter adds it, Escape or blur drops it. */
function draftElement(view: EditorView, pos: number, prefix: string, inline: boolean): HTMLElement {
  const doc = view.dom.ownerDocument;
  const wrap = doc.createElement('span');
  wrap.className = `typst-label-tag typst-label-tag--draft${inline ? '' : ' typst-label-tag--block'}`;
  wrap.contentEditable = 'false';
  const input = wrap.appendChild(doc.createElement('input'));
  input.className = 'typst-label-tag__input';
  input.setAttribute('aria-label', 'New label');
  input.placeholder = 'label';
  input.value = prefix;
  input.size = Math.max(8, prefix.length + 6);
  let done = false;
  const finish = (name: string | null) => {
    if (done) return;
    done = true;
    const block = key.getState(view.state)?.draft ?? pos;
    const tr = name ? setLabel(view.state, block, name) : view.state.tr;
    view.dispatch(tr.setMeta(key, { draft: null }));
    view.focus();
  };
  input.addEventListener('input', () => (input.size = Math.max(8, input.value.length + 2)));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(labelName(input.value));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(null);
    }
  });
  input.addEventListener('blur', () => finish(null));
  // once the widget is in the document
  setTimeout(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  return wrap;
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
    // with references, updating them is what Enter does; renaming only the label is the exception
    ...(references > 0
      ? {
          applyText: `Rename and update ${references} reference${references === 1 ? '' : 's'}`,
          apply: (value: string) => rename(value, true),
          alternative: { text: 'Rename without updating references', apply: (value: string) => rename(value, false) },
        }
      : { applyText: 'Rename', apply: (value: string) => rename(value, false) }),
    remove: () => {
      const pos = block();
      if (pos !== null) view.dispatch(setLabel(view.state, pos, null));
      view.focus();
    },
  });
}
