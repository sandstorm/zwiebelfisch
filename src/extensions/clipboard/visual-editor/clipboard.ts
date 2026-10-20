// Copy and paste of the Visual editor as Typst text. See clipboard in ../clipboard.ts.
import { Extension, type AnyExtension } from '@tiptap/core';
import { Fragment, Node, Slice, type Schema } from '@tiptap/pm/model';
import { NodeSelection, Plugin, type EditorState } from '@tiptap/pm/state';
import { SourceRange, type TextChange, type TypstDocument } from '../../../core/typst-document/typst-document';
import { sortPasteEdits, type DocumentPasteEdit, type Languages, type TextDocument } from '../../../hosts/languages/languages';
import { applyTypstChanges, parseTypst, posToSource, serializeToTypst } from '../../../hosts/visual-editor/visual-editor';
import type { PasteChoices } from '../paste-as';
import { TYPST } from '../pasted-typst';
import { pasteChoicePlugin, pasteWith, type PasteAlternative } from './paste-as';

/** Who a Visual editor's clipboard asks: the paste edit providers, of `document`'s text (null: none), and where a paste's choice shows. */
export interface ClipboardServices {
  readonly languages: Pick<Languages, 'prepareDocumentPaste' | 'provideDocumentPasteEdits' | 'resolveDocumentPasteEdit'>;
  readonly document: () => TextDocument | null;
  readonly choices: PasteChoices;
}

/**
 * The Visual editor's clipboard, in Typst.
 *
 * Copy and cut put the selection's Typst on the clipboard (`text/plain`, and `text/x-typst`): its source byte for byte
 * where that reads as what is selected, else printed anew (part of a bold word: `*bo*`). ProseMirror's HTML goes along
 * for rich targets. A cut with nothing selected cuts the paragraph at the caret, as IntelliJ cuts the line.
 *
 * A paste goes in as one of the paste edits on offer (the providers', this extension's `TypstPasteEditProvider`
 * among them; other HTML as the schema reads it), in place of the selection, in one step with its other changes to
 * the text. Where there are others, the "Paste as" chip lets the user switch (`pasteWith`). No provider (a document
 * out of the project): ProseMirror's own paste.
 */
export function typstClipboard(document: TypstDocument, services: ClipboardServices): AnyExtension {
  return Extension.create({
    name: 'typstClipboard',
    priority: 1000,
    addProseMirrorPlugins() {
      // Mod+Shift+V was the last key pressed: the paste it starts is literal
      let literal = false;
      return [
        pasteChoicePlugin(services.choices),
        new Plugin({
          // after ProseMirror's own copy (and a raw box's): its text is Typst
          view: (view) => {
            const markTypst = (event: ClipboardEvent) => {
              const data = event.clipboardData;
              const copied = data?.getData('text/plain') ?? '';
              data?.setData(TYPST, copied);
              const text = services.document();
              if (data && text && copied !== '') services.languages.prepareDocumentPaste(text, copied, data);
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
            handlePaste: (view, event, slice) => {
              const data = event.clipboardData;
              const plain = literal;
              literal = false;
              if (!data || view.state.selection.$from.parent.type.spec.code) return false;
              const text = services.document();
              if (!text) return false;
              const edits = pasteEditsOf({ state: view.state, slice, data, document: text, languages: services.languages }, plain);
              if (edits.length === 0) return false;
              pasteWith(view, edits.map((edit) => alternative(edit, document)));
              return true;
            },
          },
        }),
      ];
    },
  });
}

/** What a paste is made in: the editor's state, ProseMirror's reading of the clipboard (`slice`), the clipboard, the text. */
interface PasteContext {
  readonly state: EditorState;
  readonly slice: Slice;
  readonly data: DataTransfer;
  readonly document: TextDocument;
  readonly languages: ClipboardServices['languages'];
}

/**
 * The ways a paste can go in, the one it goes in as first (`sortPasteEdits`; after Mod+Shift+V, `literal`: as plain
 * characters): the providers' by priority (Typst, code, plain text last), the HTML as ProseMirror reads it with the
 * schema's HTML rules (`slice`; not with Typst a Visual editor copied, which the HTML lacks, nor `literal`); each as
 * the providers resolve it (asked now, while the clipboard can be read).
 */
function pasteEditsOf({ state, slice, data, document, languages }: PasteContext, literal: boolean): DocumentPasteEdit[] {
  const ranges = [selectionSource(state)];
  const html = data.getData('text/html') && !data.getData(TYPST) && !literal;
  const printed = () => {
    const { content } = unwrapped(slice);
    // inline content alone (a `<span>`'s): a paragraph's
    const blocks = content.firstChild?.isInline ? Fragment.from(state.schema.nodes.paragraph.create(null, content)) : content;
    return serializeToTypst(state.schema.topNodeType.create({ trail: '' }, blocks));
  };
  const offered = [...languages.provideDocumentPasteEdits(document, ranges, data), ...(html ? [{ kind: 'typst.html', title: 'HTML', insertText: printed() }] : [])];
  return sortPasteEdits(offered, literal ? ['text.plain'] : []).map((edit) => languages.resolveDocumentPasteEdit(edit, document, ranges, data));
}

/** Pasting `edit` into `document`: its text read with the editor's specs, its additional edits made in the same step. */
function alternative({ kind, title, insertText, additionalEdit = [] }: DocumentPasteEdit, document: TypstDocument): PasteAlternative {
  return {
    kind,
    title,
    paste: (at) => {
      const { parent } = at.selection.$from;
      const tr = additionalEdit.length === 0 ? at.tr : applyTypstChanges(at.tr, parseTypst(applyChanges(document.text, additionalEdit), at.schema));
      return tr.replaceSelection(typstSlice(insertText, at.schema, parent.isTextblock && parent.content.size > 0));
    },
  };
}

/**
 * The Typst source of the selection, whose content is `slice`: the source range it shows, if that reads as the same
 * document as the slice printed (`*bold* text`); else the slice printed (`*bo*` for the start of a bold word). Text
 * within one block of code (a spec with `code`) is that text, as ProseMirror pastes into code: no fences.
 */
function typstOfSelection(state: EditorState, slice: Slice): string {
  const { doc, schema, selection } = state;
  const { $from, $to } = selection;
  if ($from.sameParent($to) && $from.parent.type.spec.code) return doc.textBetween($from.pos, $to.pos);
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
