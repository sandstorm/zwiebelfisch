// Copy and paste as Typst text. See VisualEditor in visual-editor.ts.
import { Extension, type AnyExtension } from '@tiptap/core';
import { Fragment, Node, Slice, type Schema } from '@tiptap/pm/model';
import { NodeSelection, Plugin, type EditorState } from '@tiptap/pm/state';
import { SourceRange, type TextChange, type TypstDocument } from '../../core/typst-document/typst-document';
import { applyTypstChanges, parseTypst, posToSource, serializeToTypst } from '../prosemirror-typst/prosemirror-typst';
import type { VisualEditorPasteEdits } from './visual-editor';

/**
 * The clipboard in Typst. Copy and cut put the selection's Typst source on the clipboard as text (`text/plain`, and
 * `text/x-typst` saying it is Typst): byte for byte where that source reads as what is selected, else the selection
 * printed anew (part of a bold word: `*bo*`). A cut with nothing selected cuts the paragraph at the caret, as IntelliJ
 * cuts the line: a list item or quote that is only that paragraph goes along (`caretBlock`). ProseMirror's HTML goes along for rich targets (a mail, a word
 * processor); a Visual editor reads the Typst instead, as the HTML leaves out what is never rendered (a raw box's
 * source).
 *
 * Pasted Typst, plain text, and code from a code editor (HTML that is one preformatted block, as VS Code copies) are
 * read with the editor's specs and go in place of the selection, as one step: a paragraph's inline content into the
 * text there, blocks as blocks (what no spec models: raw boxes). The paste edit providers (`pasteEdits`) may change
 * the text before and make other changes of the document's text in the same step (a copy gave them the clipboard).
 * Mod+Shift+V pastes the text as plain characters, written escaped. Other HTML (a web page, a word processor) goes
 * through ProseMirror's paste and the schema's HTML rules. Its priority puts its text serializer before Tiptap's.
 * See docs/40_architecture/04_visual-editor.typ.
 */
export function clipboard(document: TypstDocument, pasteEdits: VisualEditorPasteEdits | null): AnyExtension {
  return Extension.create({
    name: 'typstClipboard',
    priority: 1000,
    addProseMirrorPlugins() {
      // Mod+Shift+V was the last key pressed: the paste it starts is literal
      let literal = false;
      return [
        new Plugin({
          // after ProseMirror's own copy (and a raw box's): its text is Typst
          view: (view) => {
            const markTypst = (event: ClipboardEvent) => {
              const data = event.clipboardData;
              const copied = data?.getData('text/plain') ?? '';
              data?.setData(TYPST, copied);
              if (data && copied !== '') pasteEdits?.prepareDocumentPaste(document, copied, data);
            };
            view.dom.addEventListener('copy', markTypst);
            view.dom.addEventListener('cut', markTypst);
            return {
              destroy: () => {
                view.dom.removeEventListener('copy', markTypst);
                view.dom.removeEventListener('cut', markTypst);
              },
            };
          },
          props: {
            clipboardTextSerializer: (slice, view) => typstOfSelection(view.state, slice),
            handleDOMEvents: {
              // before ProseMirror's own cut, which then cuts what is selected here
              cut: (view) => {
                const block = caretBlock(view.state);
                if (block !== null) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, block)));
                return false;
              },
            },
            handleKeyDown: (_view, event) => {
              literal = (event.metaKey || event.ctrlKey) && event.shiftKey && (event.code === 'KeyV' || event.key.toLowerCase() === 'v');
              return false;
            },
            handlePaste: (view, event) => {
              const data = event.clipboardData;
              const text = literal ? null : typstText(data);
              literal = false;
              if (text === null || !data || view.state.selection.$from.parent.type.spec.code) return false;
              const { state } = view;
              const { parent } = state.selection.$from;
              const edit = pasteEdits?.provideDocumentPasteEdits(document, [selectionSource(state)], text, data) ?? { insertText: text, additionalEdits: [] };
              const tr = edit.additionalEdits.length === 0
                ? state.tr
                : applyTypstChanges(state.tr, parseTypst(applyChanges(document.text, edit.additionalEdits), state.schema));
              tr.replaceSelection(typstSlice(edit.insertText, state.schema, parent.isTextblock && parent.content.size > 0));
              view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
              return true;
            },
          },
        }),
      ];
    },
  });
}

/**
 * The Typst source of the selection, whose content is `slice`: the source range it shows, if that reads as the same
 * document as the slice printed (`*bold* text`); else the slice printed (`*bo*` for the start of a bold word).
 */
function typstOfSelection(state: EditorState, slice: Slice): string {
  const { doc, schema, selection } = state;
  const { from, to } = selectionSource(state);
  const text = serializeToTypst(doc).slice(from, to);
  // a selection from between blocks (a whole paragraph) starts after the source before it: without the blank lines
  const source = selection.$from.parent.isTextblock ? text : text.replace(/^\s*\n/, '');
  const printed = serializeToTypst(schema.topNodeType.create({ trail: '' }, unwrapped(slice).content));
  return source !== '' && reprinted(source, schema) === reprinted(printed, schema) ? source : printed;
}

/**
 * Where the block at the caret starts, for a cut with nothing selected: the paragraph, or the outermost container
 * that holds only it (a list item, a quote; not past an isolating node, as a table cell). Null: a selection, or a
 * caret in code (a code block's line is no paragraph).
 */
function caretBlock({ selection }: EditorState): number | null {
  const { $from, empty } = selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  let depth = $from.depth;
  while (depth > 1 && $from.node(depth - 1).childCount === 1 && !$from.node(depth - 1).type.spec.isolating) depth--;
  return $from.before(depth);
}

/** The source range the selection shows. */
function selectionSource({ doc, selection }: EditorState): SourceRange {
  const from = posToSource(doc, selection.from);
  return SourceRange.of({ from, to: Math.max(from, posToSource(doc, selection.to, -1)) });
}

/** Typst `text` with `changes` made (all of the text as it is, none overlapping; at one place in their order). */
function applyChanges(text: string, changes: readonly TextChange[]): string {
  let result = '';
  let at = 0;
  for (const { from, to, insert } of [...changes].sort((a, b) => a.from - b.from)) {
    result += text.slice(at, from) + insert;
    at = to;
  }
  return result + text.slice(at);
}

/** `slice` without the containers open on both ends around one child (a table cell's text: the paragraph, not the table). */
function unwrapped(slice: Slice): Slice {
  let { content, openStart, openEnd } = slice;
  while (openStart > 1 && openEnd > 1 && content.childCount === 1 && !content.firstChild!.isTextblock) {
    content = content.firstChild!.content;
    openStart--;
    openEnd--;
  }
  return new Slice(content, openStart, openEnd);
}

/** `source` read and every node printed anew (none unchanged since parsed): equal for sources that read the same. */
function reprinted(source: string, schema: Schema): string {
  return serializeToTypst(Node.fromJSON(schema, parseTypst(source, schema).toJSON())).trim();
}

/**
 * The type of the Typst a Visual editor copied, next to the same text as `text/plain`: what a paste reads as Typst
 * although HTML comes along (ProseMirror's HTML leaves out what is never rendered, as raw boxes' source).
 */
const TYPST = 'text/x-typst';

/**
 * The clipboard's text to read as Typst: Typst a Visual editor copied, or plain text without HTML or with HTML that is
 * one code block; null: none.
 */
function typstText(data: DataTransfer | null): string | null {
  if (!data) return null;
  const [typst, text, html] = [TYPST, 'text/plain', 'text/html'].map((type) => data.getData(type));
  const read = typst || (text && (!html || isCode(html)) ? text : null);
  return read && read.replace(/\r\n?/g, '\n');
}

/** Whether `html` is one preformatted block (`<pre>`, or an element styled `white-space: pre`, as code editors copy). */
function isCode(html: string): boolean {
  const roots = [...new DOMParser().parseFromString(html, 'text/html').body.children].filter((element) => element.tagName !== 'META');
  const [root] = roots;
  return roots.length === 1 && (root.tagName === 'PRE' || /white-space:\s*pre\b/.test(root.getAttribute('style') ?? ''));
}

/**
 * `text` read as Typst, a paragraph at either end open (its inline content joins the text there). Text of one
 * paragraph keeps the spaces around it (` and more`), which Typst would read as the document's lead and trail. One
 * line no spec models (`$x^2$`, read alone as a raw block) pasted `inText` (a paragraph with text) joins the text as
 * an inline raw box, as it would in the source.
 */
function typstSlice(text: string, schema: Schema, inText: boolean): Slice {
  const doc = parseTypst(text, schema);
  let { content } = doc;
  let only = content.childCount === 1 ? content.firstChild! : null;
  if (inText && only?.type === schema.nodes.rawBlock && only.attrs.label === null && !only.attrs.src.includes('\n')) {
    only = schema.nodes.paragraph.create(null, schema.nodes.rawInline.create({ src: only.attrs.src }));
  }
  if (only?.type === schema.nodes.paragraph) {
    const spaces = (s: string) => (s === '' ? [] : [schema.text(s)]);
    const lead = /^[ \t]*$/.test(doc.attrs.lead) ? doc.attrs.lead : '';
    const trail = /^[ \t]*/.exec(doc.attrs.trail)![0];
    content = Fragment.from(only.copy(Fragment.from(spaces(lead)).append(only.content).append(Fragment.from(spaces(trail)))));
  }
  const open = (node: Node | null) => (node?.type === schema.nodes.paragraph ? 1 : 0);
  return new Slice(content, open(content.firstChild), open(content.lastChild));
}
