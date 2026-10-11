// Label tags. See visual-editor.ts.
import type { Node } from '@tiptap/pm/model';
import { type EditorState, NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { QuickPickItem, WindowApi } from '../../../hosts/window/window';
import { renameLabel, setLabel } from './label-edits';
import { labelName } from '../model/reference-syntax';
import type { ProjectLabels } from '../model/label-index';

/**
 * Draws every labelled block's label as a tag: at the end of a heading's or
 * paragraph's text, or below other blocks (figures, equations, tables). A
 * click on the tag offers to rename the label (with every reference to it in
 * the project, or alone) or remove it; each is one undo step here.
 * `startNewLabel` draws a draft tag with a field at the same place instead.
 *
 * A block's label (`= Intro <intro>`) drawn as a small tag on the block, renamed or removed through the window's quick
 * pick and input box; a new label typed into a draft tag right where it will show, on the block the selection would
 * label.
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

/** Where a tag asks what to do with its label, and for the new name. */
export type LabelPrompts = Pick<WindowApi, 'showQuickPick' | 'showInputBox'>;

/** What the tags need: the project's labels (renaming updates their references by default), the editor's document. */
export interface LabelTagsOptions {
  labels: ProjectLabels;
  /** The document this editor shows: its references are renamed in the editor, the other files' by `labels`. */
  document: TypstDocument;
  prompts: LabelPrompts;
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

/** The tags drawn, and the block a new label is being typed for (its position), if any. */
interface TagsState {
  decorations: DecorationSet;
  draft: number | null;
}

const key = new PluginKey<TagsState>('typstLabelTags');

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
  wrap.className = `typst-labels__tag typst-labels__tag--draft${inline ? '' : ' typst-labels__tag--block'}`;
  wrap.contentEditable = 'false';
  const input = wrap.appendChild(doc.createElement('input'));
  input.className = 'typst-labels__tag-input';
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

function tagElement(tag: Tag): HTMLElement {
  const { view, name, inline } = tag;
  const doc = view.dom.ownerDocument;
  const wrap = doc.createElement('span');
  wrap.className = `typst-labels__tag${inline ? '' : ' typst-labels__tag--block'}`;
  wrap.contentEditable = 'false';
  const button = wrap.appendChild(doc.createElement('button'));
  button.type = 'button';
  button.className = 'typst-labels__tag-name';
  button.dataset.testid = 'typst-label-tag';
  button.textContent = name;
  button.title = `Label <${name}>: click to rename or remove it`;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => void editTag(tag));
  return wrap;
}

/** One drawn tag: the label's name, where it is drawn, how to find its block now, and the editor's options. */
interface Tag {
  view: EditorView;
  name: string;
  /** Drawn in the text (at the end of a textblock) rather than below a block. */
  inline: boolean;
  /** The position of the labelled block in the current document. */
  block(): number | null;
  options: LabelTagsOptions;
}

/**
 * What a click on the tag of label `name` offers: rename (updating its references, the first choice while there are
 * any), rename only the label, remove; renaming asks for the new name.
 */
async function editTag(tag: Tag): Promise<void> {
  const { prompts } = tag.options;
  const references = countedReferences(tag);
  const choice = await prompts.showQuickPick(tagChoices(references), {
    title: `Label <${tag.name}>`,
    placeHolder: references ? `${references} to it` : 'No references to it',
  });
  if (choice?.action === 'remove') removeLabel(tag);
  else if (choice) await renameTag(tag, prompts, choice.action === 'rename' ? references : null);
  tag.view.focus();
}

/** "2 references" to the tag's label; null for none. */
function countedReferences({ name, options }: Tag): string | null {
  const count = options.labels.referenceCount(name);
  return count > 0 ? `${count} reference${count === 1 ? '' : 's'}` : null;
}

/** What a tag offers: rename (with the references, if `references` says how many), rename only the label, remove. */
function tagChoices(references: string | null): (QuickPickItem & { action: 'rename' | 'renameOnly' | 'remove' })[] {
  const rename = { label: 'Rename…', description: references ? `and update ${references}` : undefined, action: 'rename' as const };
  const renameOnly = { label: 'Rename without updating references…', action: 'renameOnly' as const };
  const remove = { label: 'Remove label', action: 'remove' as const };
  return references ? [rename, renameOnly, remove] : [rename, remove];
}

function removeLabel({ view, block }: Tag): void {
  const pos = block();
  if (pos !== null) view.dispatch(setLabel(view.state, pos, null));
}

/** Asks for the new name of the tag's label and renames it; with `references` (how many), them too. */
async function renameTag({ view, name, block, options }: Tag, prompts: LabelPrompts, references: string | null): Promise<void> {
  const value = await prompts.showInputBox({
    title: references ? `Rename <${name}> and update ${references}` : `Rename <${name}>`,
    prompt: 'Label name',
    value: name,
    placeHolder: 'e.g. intro',
    validateInput: (text) => (labelName(text) === null ? 'Enter a label name.' : null),
  });
  const next = value === undefined ? null : labelName(value);
  const pos = block();
  if (next === null || next === name || pos === null) return;
  view.dispatch(renameLabel(view.state, pos, next, references !== null));
  if (references) options.labels.renameReferences(name, next, options.document);
}

/** The position of the block a tag at `widget` belongs to: the textblock it ends, or the block before it. */
function blockAt(view: EditorView, widget: number | undefined, inline: boolean): number | null {
  if (widget === undefined) return null;
  const $pos = view.state.doc.resolve(widget);
  if (inline) return $pos.depth > 0 ? $pos.before() : null;
  return $pos.nodeBefore ? widget - $pos.nodeBefore.nodeSize : null;
}

// --- A new label: which block the selection would label, and a name to start from

/**
 * The block a new label goes on: a figure the selection is in (its image or
 * caption), else the selected block or the innermost block around the
 * selection that can carry a label (paragraph, heading, table, code block,
 * raw block, …). Null when there is none.
 */
function labelTarget(state: EditorState): { pos: number; node: Node } | null {
  const { selection } = state;
  const candidates: { pos: number; node: Node }[] = [];
  if (selection instanceof NodeSelection) candidates.push({ pos: selection.from, node: selection.node });
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) candidates.push({ pos: $from.before(depth), node: $from.node(depth) });
  return candidates.find((c) => c.node.type.name === 'figure') ?? candidates.find((c) => canHaveLabel(c.node)) ?? null;
}

/** Whether `node`'s type has the `label` attribute (its spec is `labelled`). */
function canHaveLabel(node: Node): boolean {
  return 'label' in node.attrs;
}

/** How a new label for `node` starts, by Typst custom: `fig:` / `tab:` for figures, `sec:` for headings, else nothing. */
function labelPrefix(node: Node): string {
  if (node.type.name === 'heading') return 'sec:';
  if (node.type.name !== 'figure') return '';
  return node.firstChild?.type.name === 'table' ? 'tab:' : 'fig:';
}
