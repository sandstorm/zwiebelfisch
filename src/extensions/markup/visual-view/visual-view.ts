// What the markup extension contributes to the Visual view: the specs of strong and emphasis, links, raw text
// (inline code, code blocks) and block quotes, and their toolbar entries. See markup.ts.
import type { SyntaxNode } from '@lezer/common';
import type { Editor } from '@tiptap/core';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import type { Mark, Node } from '@tiptap/pm/model';
import { Disposable } from '../../../core/disposable/disposable';
import type { Window } from '../../../hosts/window/window';
import { children, decodeString, isClosedContent, parenthesized, quote } from '../../../core/typst-syntax/typst-syntax';
import { starterKitPart, svg, type Action, type ToolbarContext, type TypstMarkSpec, type TypstNodeSpec } from '../../../hosts/visual-view/visual-view';
import type { Around, Call, Placed, Printer, ProjectionContext } from '../../../hosts/projection/projection';
import { codeBlockView } from './code-block-view';
import { codeBlockDelimiters, inlineCodeDelimiters, rawCode } from '../model/raw-code';

/** Tiptap's bold, italic, link and blockquote (StarterKit's), configured for Typst: each spec brings its own. */
const Bold = starterKitPart('typstBold', { bold: {} });
const Italic = starterKitPart('typstItalic', { italic: {} });
const Link = starterKitPart('typstLink', {
  link: { openOnClick: false, autolink: false, HTMLAttributes: { class: 'typst-visual__link', target: null, rel: null } },
});
const Blockquote = starterKitPart('typstBlockquote', { blockquote: { HTMLAttributes: { class: 'typst-visual__quote' } } });

/**
 * Inline raw text (`code`). Unlike Tiptap's code mark it combines with other
 * formatting (Typst allows `*`code`*`). `fence` and `lang` remember the
 * delimiters (```lang …```) so they print back as written.
 */
const TypstCode = Code.extend({
  excludes: '',
  addAttributes() {
    return { fence: { default: 1, rendered: false }, lang: { default: null, rendered: false } };
  },
}).configure({ HTMLAttributes: { class: 'typst-visual__code-inline' } });

/**
 * Raw text in a block (```lang …```): plain text edited in place, under a
 * field for its language.
 */
const TypstCodeBlock = CodeBlock.extend({
  addNodeView() {
    return codeBlockView;
  },
}).configure({ HTMLAttributes: { class: 'typst-visual__code-block' } });

// ------------------------------------------------------------- strong, emph

const WORD = /[\p{L}\p{N}_]/u;

/** `*x*`, or `#strong[x]` where a delimiter would touch a word character or the span starts or ends with a space. */
function delimitedSyntax(delimiter: string, func: string, { before, after, first, last }: Around): { open: string; close: string } {
  const needsFunction = (before !== undefined && WORD.test(before)) || (after !== undefined && WORD.test(after)) || /^\s/.test(first) || /\s$/.test(last);
  return needsFunction ? { open: `#${func}[`, close: ']' } : { open: delimiter, close: delimiter };
}

/** `*…*` / `_…_` with both delimiters present: its content with the mark; null (raw) for unclosed ones. */
function delimited(markName: string) {
  return (p: ProjectionContext, node: SyntaxNode, marks: readonly Mark[]): Placed[] | null => {
    const parts = children(node);
    const markup = node.getChild('Markup');
    if (parts.length !== 3 || !markup || parts[2].name !== parts[0].name) return null;
    return p.inline(children(markup), p.schema.marks[markName].create().addToSet(marks));
  };
}

export const BOLD: TypstMarkSpec = {
  name: 'bold',
  extension: Bold,
  inlineSyntax: { Strong: delimited('bold') },
  print: (_mark, around) => delimitedSyntax('*', 'strong', around),
};

export const ITALIC: TypstMarkSpec = {
  name: 'italic',
  extension: Italic,
  inlineSyntax: { Emph: delimited('italic') },
  print: (_mark, around) => delimitedSyntax('_', 'emph', around),
};

// -------------------------------------------------------------------- links

/** Bare URL characters, not ending in punctuation that Typst would leave out of the link. */
const BARE_URL = /^https?:\/\/[\w\-.~:/?#@!$&'*+,;=%]*[\w\-~/#@$&+=%]$/;

/**
 * Links: a bare URL is text with a `link` mark whose `href` is the text;
 * `#link("plain string")[one paragraph]` puts the mark on its projected
 * content (the call is hidden syntax). Other `link` calls stay raw, but in
 * running text. An edited link prints `#link("href")[..]`, or a bare URL when
 * its text is its `href`, a plain `http(s)://` URL between whitespace.
 */
export const LINK: TypstMarkSpec = {
  name: 'link',
  extension: Link,
  inlineSyntax: { Link: (p, node, marks) => p.schema.text(p.text(node), p.schema.marks.link.create({ href: p.text(node) }).addToSet(marks)) },
  inlineCalls: [{ matches: (_p, call) => call.name === 'link', project: linkCall }],
  print: (mark) => ({ open: `#link(${quote(mark.attrs.href)})[`, close: ']' }),
  printsBare: (mark, text, { before, after }) =>
    text === mark.attrs.href && BARE_URL.test(text) && (before === undefined || /\s/.test(before)) && (after === undefined || /\s/.test(after)),
};

/** `#link("url")[text]` with a plain string and non-empty, single-paragraph text; null otherwise. */
function linkCall(p: ProjectionContext, { name, args }: Call, marks: readonly Mark[]): Placed[] | null {
  if (name !== 'link' || args.map((a) => a.name).join() !== 'LeftParen,Str,RightParen,ContentBlock') return null;
  const href = decodeString(p.text(args[1]));
  const markup = args[3].getChild('Markup');
  const content = markup ? children(markup) : [];
  if (href === null || !isClosedContent(args[3]) || content.length === 0) return null;
  if (content.some((n) => n.name === 'Parbreak')) return null;
  return p.inline(content, p.schema.marks.link.create({ href }).addToSet(marks));
}

// ----------------------------------------------------------------- raw text

/** Inline raw text on one line: its text with a `code` mark remembering the delimiters (empty and multi-line raw stays raw). */
export const CODE: TypstMarkSpec = {
  name: 'code',
  extension: TypstCode,
  inlineSyntax: {
    Raw: (p, node, marks) => {
      const code = rawCode(node, p.source);
      const text = code ? p.source.slice(code.from, code.to) : '';
      if (!code || code.block || !text || text.includes('\n')) return null;
      const mark = p.schema.marks.code.create({ fence: code.fence, lang: code.lang });
      return [{ node: p.schema.text(text, mark.addToSet(marks)), from: code.from, to: code.to }];
    },
  },
  raw: true,
  print: (mark, { text }) => inlineCodeDelimiters(text, mark.attrs.lang, mark.attrs.fence),
};

/**
 * Raw text Typst shows as a block (3+ backticks around a line break): a code
 * block whose text is the source between the delimiters, the language tag and
 * the whitespace Typst trims (not dedented). An edited one prints
 * ```` ```lang\ntext\n``` ````, keeping its fence unless the text needs a
 * longer one; the language is cut to what Typst reads as a tag.
 */
export const CODE_BLOCK: TypstNodeSpec = {
  name: 'codeBlock',
  extension: TypstCodeBlock,
  attributes: {
    src: { default: null, rendered: false, keepOnSplit: false },
    sep: { default: null, rendered: false },
    fence: { default: 3, rendered: false },
  },
  labelled: true,
  runSyntax: {
    Raw: (p, node, sep) => {
      const code = rawCode(node, p.source);
      if (!code?.block) return null;
      const text = p.source.slice(code.from, code.to);
      const attrs = { language: code.lang, fence: code.fence, src: p.text(node), sep };
      const content = text ? [{ node: p.schema.text(text), from: code.from, to: code.to }] : [];
      return p.textblock({ type: 'codeBlock', attrs, contentTo: code.to }, node.from, content);
    },
  },
  print: (out, block, pos) => {
    const text = block.textContent;
    const { open, close } = codeBlockDelimiters(text, block.attrs.language, block.attrs.fence);
    out.hidden(open);
    out.shown(text, 'text', pos + 1, pos + 1 + text.length);
    out.endBlock(pos + block.nodeSize - 1, text.length === 0);
    out.closing(close);
  },
};

// ------------------------------------------------------------------- quotes

/** How a block quote's source lies around its content: `#quote(..)[` and `]`, with any whitespace inside. */
interface QuoteLayout {
  open: string;
  close: string;
}

const NEW_QUOTE: QuoteLayout = { open: '#quote(block: true)[', close: ']' };

/**
 * `#quote(block: true, ..named)[content]` (Tiptap's blockquote): its content
 * is segmented like the document; `layout` is the source around it (new:
 * `#quote(block: true)[` / `]`).
 */
export const BLOCKQUOTE: TypstNodeSpec = {
  name: 'blockquote',
  extension: Blockquote,
  attributes: { sep: { default: null, rendered: false }, layout: { default: null, rendered: false } },
  anchors: ['layout'],
  labelled: true,
  blockCalls: { quote: blockquote },
  print: (out, quote, pos) => printAround(out, quote, pos, quote.attrs.layout ?? NEW_QUOTE),
};

function blockquote(p: ProjectionContext, call: Call, sep: string | null): Node | null {
  const { args } = call;
  const content = args.at(-1)!;
  const parens = args.slice(0, -1);
  if (!parenthesized(parens) || !isClosedContent(content) || !isBlockQuoteArgs(p, parens.slice(1, -1))) return null;
  const { content: blocks, from, to } = p.blocks(content);
  const layout: QuoteLayout = { open: p.source.slice(call.from, from), close: p.source.slice(to, call.to) };
  return p.schema.nodes.blockquote.create({ sep, layout }, blocks);
}

/** Named arguments only, `block: true` among them. */
function isBlockQuoteArgs(p: ProjectionContext, args: SyntaxNode[]): boolean {
  const named = args.filter((a) => a.name !== 'Space' && a.name !== 'Comma');
  return named.every((a) => a.name === 'Named') && named.some((a) => /^block\s*:\s*true$/.test(p.text(a)));
}

/** `open`, the container's blocks, `close`. */
function printAround(out: Printer, block: Node, pos: number, { open, close }: QuoteLayout): void {
  out.hidden(open);
  out.blocks(block, pos + 1, '\n\n');
  out.closing(close);
}

// ------------------------------------------------------------------ toolbar

const ICONS = {
  bold: svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
  italic: svg('<path d="M10 5h8"/><path d="M6 19h8"/><path d="M14 5 10 19"/>'),
  code: svg('<path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
  codeBlock: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9-3 3 3 3"/><path d="m14 9 3 3-3 3"/>'),
  quote: svg('<path d="M4 6v12"/><path d="M9 7h11M9 12h11M9 17h7"/>'),
};

/** Bold, italic, inline code: in the bar above the selection, their only place. */
export const MARK_ACTIONS: Record<'bold' | 'italic' | 'code', Action> = {
  bold: { label: 'Bold', shortcut: 'Mod+B', icon: ICONS.bold, run: (c) => c.toggleBold(), active: (e) => e.isActive('bold') },
  italic: { label: 'Italic', shortcut: 'Mod+I', icon: ICONS.italic, run: (c) => c.toggleItalic(), active: (e) => e.isActive('italic') },
  code: { label: 'Code', shortcut: 'Mod+E', icon: ICONS.code, run: (c) => c.toggleCode(), active: (e) => e.isActive('code') },
};

export const INSERT_CODE_BLOCK: Action = { label: 'Code block', icon: ICONS.codeBlock, run: (c) => c.toggleCodeBlock(), active: (e) => e.isActive('codeBlock') };
export const INSERT_QUOTE: Action = { label: 'Quote', shortcut: 'Mod+Shift+B', icon: ICONS.quote, run: (c) => c.toggleBlockquote(), active: (e) => e.isActive('blockquote') };

/** Where "Link" asks for the URL: the window's input box. */
export type LinkPrompt = Pick<Window, 'showInputBox'>;

/**
 * "Link" in the selection's bar, and Mod+K in the text (not in a raw box): asks
 * for the URL in an input box at the selection. With nothing selected it
 * inserts the URL as linked text; inside a link it edits the whole link, and an
 * empty URL removes it.
 */
export function linkAction(toolbar: ToolbarContext, prompt: LinkPrompt): Action {
  const { editor } = toolbar;
  const ask = async () => {
    const inLink = editor.isActive('link');
    const href = await prompt.showInputBox({
      title: 'Link',
      prompt: inLink ? 'URL (empty removes the link)' : 'URL',
      value: editor.getAttributes('link').href ?? '',
      placeHolder: 'https://…',
    });
    if (href === undefined) return void editor.commands.focus();
    if (href.trim() !== '') applyLink(editor, href.trim());
    else if (inLink) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.commands.focus();
  };
  const shortcut = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if ((event.target as Element).closest?.('.cm-editor')) return; // in a raw box
    event.preventDefault();
    void ask();
  };
  editor.view.dom.addEventListener('keydown', shortcut);
  toolbar.subscriptions.push(new Disposable(() => editor.view.dom.removeEventListener('keydown', shortcut)));
  return {
    label: 'Link',
    shortcut: 'Mod+K',
    icon: ICONS.link,
    run: (c) => c.setLink({ href: 'https://typst.app' }),
    click: () => void ask(),
    active: (e) => e.isActive('link'),
    showsBar: (e) => e.isActive('link'),
  };
}

/** Links the selection (or the link around the cursor) to `href`; with nothing selected, inserts `href` as linked text. */
function applyLink(editor: Editor, href: string): void {
  const chain = editor.chain().focus();
  if (editor.state.selection.empty && !editor.isActive('link')) {
    chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
  } else {
    chain.extendMarkRange('link').setLink({ href }).run();
  }
}
