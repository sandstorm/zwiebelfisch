// Copy and paste as Typst text. See VisualEditor in visual-editor.ts.
import { Extension } from '@tiptap/core';
import { Fragment, Node, Slice, type Schema } from '@tiptap/pm/model';
import { Plugin, type EditorState } from '@tiptap/pm/state';
import { parseTypst, posToSource, serializeToTypst } from '../prosemirror-typst/prosemirror-typst';

/**
 * The clipboard in Typst. Copy and cut put the selection's Typst source on the clipboard as text (`text/plain`, and
 * `text/x-typst` saying it is Typst): byte for byte where that source reads as what is selected, else the selection
 * printed anew (part of a bold word: `*bo*`). ProseMirror's HTML goes along for rich targets (a mail, a word
 * processor); a Visual editor reads the Typst instead, as the HTML leaves out what is never rendered (a raw box's
 * source).
 *
 * Pasted Typst, plain text, and code from a code editor (HTML that is one preformatted block, as VS Code copies) are
 * read with the editor's specs and go in place of the selection, as one step: a paragraph's inline content into the
 * text there, blocks as blocks (what no spec models: raw boxes). Mod+Shift+V pastes the text as plain characters,
 * written escaped. Other HTML (a web page, a word processor) goes through ProseMirror's paste and the schema's HTML
 * rules. Its priority puts its text serializer before Tiptap's. See docs/30_architecture/04_visual-editor.typ.
 */
export const clipboard = Extension.create({
  name: 'typstClipboard',
  priority: 1000,
  addProseMirrorPlugins() {
    // Mod+Shift+V was the last key pressed: the paste it starts is literal
    let literal = false;
    return [
      new Plugin({
        // after ProseMirror's own copy (and a raw box's): its text is Typst
        view: (view) => {
          const markTypst = (event: ClipboardEvent) => event.clipboardData?.setData(TYPST, event.clipboardData.getData('text/plain'));
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
          handleKeyDown: (_view, event) => {
            literal = (event.metaKey || event.ctrlKey) && event.shiftKey && (event.code === 'KeyV' || event.key.toLowerCase() === 'v');
            return false;
          },
          handlePaste: (view, event) => {
            const text = literal ? null : typstText(event.clipboardData);
            literal = false;
            if (text === null || view.state.selection.$from.parent.type.spec.code) return false;
            const tr = view.state.tr.replaceSelection(typstSlice(text, view.state.schema));
            view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * The Typst source of the selection, whose content is `slice`: the source range it shows, if that reads as the same
 * document as the slice printed (`*bold* text`); else the slice printed (`*bo*` for the start of a bold word).
 */
function typstOfSelection(state: EditorState, slice: Slice): string {
  const { doc, selection, schema } = state;
  const from = posToSource(doc, selection.from);
  const to = Math.max(from, posToSource(doc, selection.to, -1));
  const source = serializeToTypst(doc).slice(from, to);
  const printed = serializeToTypst(schema.topNodeType.create({ trail: '' }, unwrapped(slice).content));
  return source !== '' && reprinted(source, schema) === reprinted(printed, schema) ? source : printed;
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
 * paragraph keeps the spaces around it (` and more`), which Typst would read as the document's lead and trail.
 */
function typstSlice(text: string, schema: Schema): Slice {
  const doc = parseTypst(text, schema);
  let { content } = doc;
  const only = content.childCount === 1 ? content.firstChild! : null;
  if (only?.type === schema.nodes.paragraph) {
    const spaces = (s: string) => (s === '' ? [] : [schema.text(s)]);
    const lead = /^[ \t]*$/.test(doc.attrs.lead) ? doc.attrs.lead : '';
    const trail = /^[ \t]*/.exec(doc.attrs.trail)![0];
    content = Fragment.from(only.copy(Fragment.from(spaces(lead)).append(only.content).append(Fragment.from(spaces(trail)))));
  }
  const open = (node: Node | null) => (node?.type === schema.nodes.paragraph ? 1 : 0);
  return new Slice(content, open(content.firstChild), open(content.lastChild));
}
