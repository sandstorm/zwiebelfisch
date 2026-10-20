// What the markup extension contributes to the Visual editor. See markup in ../markup.ts.
import type { SyntaxNode } from '@lezer/common';
import { Extension, Mark as TiptapMark, markInputRule, markPasteRule, mergeAttributes, type AnyExtension, type Editor, type Mark as MarkExtension } from '@tiptap/core';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import type { Mark, Node } from '@tiptap/pm/model';
import type { WindowApi } from '../../../hosts/window/window';
import { callArguments, children, decodeString, namedArgument, quote, trailingContent, withHash } from '../../../core/typst-syntax/typst-syntax';
import { svg, type Anchor, type ChainButton, type FloatingBar, type TypstNodeSpec, type VisualEditorMenuContext } from '../../../hosts/visual-editor/visual-editor';
import type { MenuItem } from '../../../hosts/commands/commands';
import { starterKitPart, type Around, type PlacedNode, type TypstMarkSpec, type TypstSerializeState, type TypstParseContext } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';
import { codeBlockView } from './code-block-view';
import { codeBlockDelimiters, codeIndent, inlineCodeDelimiters, rawCode, type RawCode } from '../model/raw-code';

// ------------------------------ strong, emph, underline, strike, highlight

/*
 * Typing (or pasting) Typst's markup puts the mark on the text between the delimiters, as Typst reads it: `*strong*`
 * bold, `_emph_` italic. Tiptap's Markdown rules (`**bold**`, `__bold__`, `*italic*`) are not: `*x*` is strong in
 * Typst. A delimiter opens after a space or at the start, as in Tiptap's own rules.
 */
const STRONG_INPUT = /(?:^|\s)(\*(?!\s+\*)([^*]+)\*(?!\s+\*))$/;
const STRONG_PASTE = /(?:^|\s)(\*(?!\s+\*)([^*]+)\*(?!\s+\*))/g;
const EMPH_INPUT = /(?:^|\s)(_(?!\s+_)([^_]+)_(?!\s+_))$/;
const EMPH_PASTE = /(?:^|\s)(_(?!\s+_)([^_]+)_(?!\s+_))/g;

/** `part` (a StarterKit part bringing one mark) whose mark is typed as `input` and pasted as `paste` (null: not), nothing else. */
function typedAs(part: AnyExtension, input: RegExp | null, paste: RegExp | null): AnyExtension {
  return part.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map((mark: AnyExtension) =>
        (mark as MarkExtension).extend({
          addInputRules() {
            return input ? [markInputRule({ find: input, type: this.type })] : [];
          },
          addPasteRules() {
            return paste ? [markPasteRule({ find: paste, type: this.type })] : [];
          },
        }),
      );
    },
  });
}

/** Tiptap's bold, italic, underline, strike, link and blockquote (StarterKit's), configured for Typst: each spec brings its own. */
const Bold = typedAs(starterKitPart('typstBold', { bold: {} }), STRONG_INPUT, STRONG_PASTE);

/**
 * The specs of strong, emphasis, underline, strike and highlight, links, raw text (inline code, code blocks) and block
 * quotes, and their toolbar entries.
 */
export const BOLD: TypstMarkSpec = {
  name: 'bold',
  tiptap: Bold,
  typst: { parseTypst: { syntaxNodes: { Strong: { inline: delimited('bold') } } }, toTypst: (_mark, around) => delimitedSyntax('*', 'strong', around) },
};

const Italic = typedAs(starterKitPart('typstItalic', { italic: {} }), EMPH_INPUT, EMPH_PASTE);

export const ITALIC: TypstMarkSpec = {
  name: 'italic',
  tiptap: Italic,
  typst: { parseTypst: { syntaxNodes: { Emph: { inline: delimited('italic') } } }, toTypst: (_mark, around) => delimitedSyntax('_', 'emph', around) },
};

/** `*…*` / `_…_` with both delimiters present: its content with the mark; null (raw) for unclosed ones. */
function delimited(markName: string) {
  return (p: TypstParseContext, node: SyntaxNode, marks: readonly Mark[]): PlacedNode[] | null => {
    const parts = children(node);
    const markup = node.getChild('Markup');
    if (parts.length !== 3 || !markup || parts[2].name !== parts[0].name) return null;
    return p.inline(children(markup), p.schema.marks[markName].create().addToSet(marks));
  };
}

/** `*x*`, or `#strong[x]` where a delimiter would touch a word character or the span starts or ends with a space. */
function delimitedSyntax(delimiter: string, func: string, { before, after, first, last }: Around): { open: string; close: string } {
  const needsFunction = (before !== undefined && WORD.test(before)) || (after !== undefined && WORD.test(after)) || /^\s/.test(first) || /\s$/.test(last);
  return needsFunction ? { open: `#${func}[`, close: ']' } : { open: delimiter, close: delimiter };
}

const WORD = /[\p{L}\p{N}_]/u;

const Underline = starterKitPart('typstUnderline', { underline: {} });

/**
 * `#underline[x]`, `#strike[x]`, `#highlight[x]` (no other arguments, one paragraph): their content with the mark;
 * other calls (`stroke:`, `fill:`, parentheses) stay raw, so an edited one prints back as it was written.
 */
export const UNDERLINE: TypstMarkSpec = plainCallMark('underline', Underline);

/** StarterKit's Strike, with its shortcut Mod-Shift-S; not typed as `~~x~~` (in Typst `~` is a non-breaking space). */
const Strike = typedAs(starterKitPart('typstStrike', { strike: {} }), null, null);

export const STRIKE: TypstMarkSpec = plainCallMark('strike', Strike);

/**
 * Tiptap's Highlight is a package of its own; this is its plain form (no colour), without its shortcut Mod-Shift-H:
 * that key is Replace in files (the search extension), so Highlight is in the toolbar only.
 */
const Highlight = TiptapMark.create({
  name: 'highlight',
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ HTMLAttributes }) => ['mark', mergeAttributes({ class: 'zwf-markup__highlight' }, HTMLAttributes), 0],
});

export const HIGHLIGHT: TypstMarkSpec = plainCallMark('highlight', Highlight);

/** The mark `name`, read from and written as `#name[..]` with only a content block. */
function plainCallMark(name: string, tiptap: AnyExtension): TypstMarkSpec {
  const parse = (p: TypstParseContext, call: SyntaxNode, marks: readonly Mark[]): PlacedNode[] | null => {
    const blocks = trailingContent(call);
    if (blocks?.length !== 1 || p.source.slice(call.from, blocks[0].from) !== name) return null;
    const content = children(blocks[0].getChild('Markup')!);
    if (content.length === 0 || !p.isOneParagraph(content)) return null;
    return p.inline(content, p.schema.marks[name].create().addToSet(marks));
  };
  return { name, tiptap, typst: { parseTypst: { calls: { [name]: { inline: parse } } }, toTypst: () => ({ open: `#${name}[`, close: ']' }) } };
}

// -------------------------------------------------------------------- links

const Link = starterKitPart('typstLink', {
  link: { openOnClick: false, autolink: false, HTMLAttributes: { class: 'zwf-markup__link', target: null, rel: null } },
}).extend({
  // the link mark StarterKit adds comes with priority 1000 (outside everything): outside bold and italic (100) only
  addExtensions() {
    return (this.parent?.() ?? []).map((link: AnyExtension) => link.extend({ priority: 120 }));
  },
});

/**
 * Links: a bare URL is text with a `link` mark whose `href` is the text;
 * `#link("plain string")[one paragraph]` puts the mark on its parsed
 * content (the call is hidden syntax). Other `link` calls stay raw, but in
 * running text. An edited link prints `#link("href")[..]`, or a bare URL when
 * its text is its `href`, a plain `http(s)://` URL between whitespace.
 */
export const LINK: TypstMarkSpec = {
  name: 'link',
  tiptap: Link,
  typst: {
    parseTypst: {
      syntaxNodes: { Link: { inline: (p, node, marks) => p.schema.text(p.text(node), p.schema.marks.link.create({ href: p.text(node) }).addToSet(marks)) } },
      calls: { link: { inline: parseLinkCall } },
    },
    toTypst: (mark) => ({ open: `#link(${quote(mark.attrs.href)})[`, close: ']' }),
    isBare: (mark, text, { before, after }) =>
      text === mark.attrs.href && BARE_URL.test(text) && (before === undefined || /\s/.test(before)) && (after === undefined || /\s/.test(after)),
  },
};

/** `#link("url")[text]` with a plain string and non-empty, single-paragraph text; null otherwise. */
function parseLinkCall(p: TypstParseContext, call: SyntaxNode, marks: readonly Mark[]): PlacedNode[] | null {
  const [url, ...others] = callArguments(call);
  const blocks = trailingContent(call);
  if (url?.name !== 'Str' || others.length > 0 || blocks?.length !== 1) return null;
  const href = decodeString(p.text(url));
  const content = children(blocks[0].getChild('Markup')!);
  if (href === null || content.length === 0 || content.some((n) => n.name === 'Parbreak')) return null;
  return p.inline(content, p.schema.marks.link.create({ href }).addToSet(marks));
}

/** Bare URL characters, not ending in punctuation that Typst would leave out of the link. */
const BARE_URL = /^https?:\/\/[\w\-.~:/?#@!$&'*+,;=%]*[\w\-~/#@$&+=%]$/;

// ----------------------------------------------------------------- raw text

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
}).configure({ HTMLAttributes: { class: 'zwf-markup__code-inline', spellcheck: 'false' } });

/** Inline raw text on one line: its text with a `code` mark remembering the delimiters (empty and multi-line raw stays raw). */
export const CODE: TypstMarkSpec = {
  name: 'code',
  tiptap: TypstCode,
  typst: {
    parseTypst: {
      syntaxNodes: {
        Raw: {
          inline: (p, node, marks) => {
            const code = rawCode(node, p.source);
            const text = code ? p.source.slice(code.from, code.to) : '';
            if (!code || code.block || !text || text.includes('\n')) return null;
            const mark = p.schema.marks.code.create({ fence: code.fence, lang: code.lang });
            return [{ node: p.schema.text(text, mark.addToSet(marks)), from: code.from, to: code.to }];
          },
        },
      },
    },
    raw: true,
    toTypst: (mark, { text }) => inlineCodeDelimiters(text, mark.attrs.lang, mark.attrs.fence),
  },
};

/**
 * Raw text in a block (```lang …```): plain text edited in place, under a
 * field for its language.
 */
const TypstCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: { default: null, rendered: false, keepOnSplit: false },
      sep: { default: null, rendered: false },
      fence: { default: 3, rendered: false },
      indent: { default: null, rendered: false },
    };
  },
  addNodeView() {
    return codeBlockView;
  },
}).configure({ HTMLAttributes: { class: 'zwf-markup__code-block' } });

/**
 * Raw text Typst shows as a block (3+ backticks around a line break): a code
 * block whose text is the source between the delimiters, the language tag and
 * the whitespace Typst trims; a block indented in a content block
 * (`#note[\n  ```typ\n  a\n  ```\n]`) without that indentation of its lines
 * (`indent`, see `codeIndent`), otherwise not dedented. An edited one prints
 * ```` ```lang\ntext\n``` ````, its lines indented by `indent` again, keeping
 * its fence unless the text needs a longer one; the language is cut to what
 * Typst reads as a tag.
 */
export const CODE_BLOCK: TypstNodeSpec = {
  name: 'codeBlock',
  tiptap: TypstCodeBlock,
  typst: {
    parseTypst: {
      syntaxNodes: {
        Raw: {
          block: (p, node, sep) => {
            const code = rawCode(node, p.source);
            if (!code?.block) return null;
            const indent = codeIndent(code, node, p.source);
            const attrs = { language: code.lang, fence: code.fence, indent, src: p.text(node), sep };
            return p.textblock({ type: 'codeBlock', attrs, contentTo: code.to }, node.from, codeLines(p, code, indent ?? ''));
          },
        },
      },
    },
    toTypst: (state, block, pos) => {
      const text = block.textContent;
      const indent: string = block.attrs.indent ?? '';
      const { open, close } = codeBlockDelimiters(text, block.attrs.language, block.attrs.fence);
      state.hidden(open);
      let at = pos + 1;
      for (const line of text ? text.split(/(?<=\n)/) : []) {
        if (line !== '\n') state.hidden(indent);
        state.shown(line, 'text', at, at + line.length);
        at += line.length;
      }
      state.endBlock(pos + block.nodeSize - 1, text.length === 0);
      state.closing(close.replace('\n', `\n${indent}`));
    },
    labelled: true,
  },
};

/** A code block's text, each line placed at its source without the `indent` before it (the line ends shown, too). */
function codeLines(p: TypstParseContext, code: RawCode, indent: string): PlacedNode[] {
  const placed: PlacedNode[] = [];
  let from = code.from;
  for (const line of p.source.slice(code.from, code.to).split(/(?<=\n)/)) {
    const start = from === code.from || line === '\n' ? from : from + indent.length;
    if (from + line.length > start) placed.push({ node: p.schema.text(p.source.slice(start, from + line.length)), from: start, to: from + line.length });
    from += line.length;
  }
  return placed;
}

// ------------------------------------------------------------------- quotes

const Blockquote = starterKitPart('typstBlockquote', { blockquote: { HTMLAttributes: { class: 'zwf-markup__quote' } } }).extend({
  // `sep`: the whitespace to the next block; `layout`: how the call around its blocks is written
  addGlobalAttributes: () => [{ types: ['blockquote'], attributes: { sep: { default: null, rendered: false }, layout: { default: null, rendered: false } } }],
});

/**
 * `#quote(block: true, ..named)[content]` (Tiptap's blockquote): its content
 * is segmented like the document; `layout` is the source around it (new:
 * `#quote(block: true)[` / `]`).
 */
export const BLOCKQUOTE: TypstNodeSpec = {
  name: 'blockquote',
  tiptap: Blockquote,
  typst: {
    parseTypst: { calls: { quote: { block: parseBlockquote } } },
    toTypst: (state, quote, pos) => writeAround(state, quote, pos, quote.attrs.layout ?? NEW_QUOTE),
    anchors: ['layout'],
    labelled: true,
  },
};

function parseBlockquote(p: TypstParseContext, call: SyntaxNode, sep: string | null): Node | null {
  const blocks = trailingContent(call);
  if (blocks?.length !== 1 || !isBlockQuoteArgs(p, call)) return null;
  const { content, from, to } = p.blocks(blocks[0]);
  const { from: start, to: end } = withHash(call);
  const layout: QuoteLayout = { open: p.source.slice(start, from), close: p.source.slice(to, end) };
  return p.schema.nodes.blockquote.create({ sep, layout }, content);
}

/** Named arguments only, `block: true` among them. */
function isBlockQuoteArgs(p: TypstParseContext, call: SyntaxNode): boolean {
  const block = namedArgument(call, 'block', p.source);
  return callArguments(call).every((a) => a.name === 'Named') && block !== null && p.text(block) === 'true';
}

/** How a block quote's source lies around its content: `#quote(..)[` and `]`, with any whitespace inside. */
interface QuoteLayout {
  open: string;
  close: string;
}

/** `open`, the container's blocks, `close`. */
function writeAround(state: TypstSerializeState, block: Node, pos: number, { open, close }: QuoteLayout): void {
  state.hidden(open);
  state.blocks(block, pos + 1, '\n\n');
  state.closing(close);
}

const NEW_QUOTE: QuoteLayout = { open: '#quote(block: true)[', close: ']' };

// ------------------------------------------------------------------ toolbar

const ICONS = {
  bold: svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
  italic: svg('<path d="M10 5h8"/><path d="M6 19h8"/><path d="M14 5 10 19"/>'),
  underline: svg('<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>'),
  strike: svg('<path d="M4 12h16"/><path d="M16 6.5A4 3 0 0 0 12 5c-2.5 0-4 1.3-4 3 0 1.5 1 2.4 3 3"/><path d="M8 17.5a4 3 0 0 0 4 1.5c2.5 0 4-1.3 4-3 0-.9-.3-1.5-.9-2"/>'),
  highlight: svg('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  code: svg('<path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
  codeBlock: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9-3 3 3 3"/><path d="m14 9 3 3-3 3"/>'),
  quote: svg('<path d="M4 6v12"/><path d="M9 7h11M9 12h11M9 17h7"/>'),
};

/** A button toggling mark or node `name` (pressed where the selection has it). */
const toggle = (name: string, button: Omit<ChainButton, 'toggled'>): ChainButton => ({ ...button, toggled: ({ editor }) => editor.isActive(name) });

/** Bold, italic, underline, strike, highlight, inline code: in the bar above the selection, their only place. */
export const MARK_BUTTONS: ChainButton[] = [
  toggle('bold', { command: 'markup.toggleBold', title: 'Bold', keybinding: 'Mod+B', icon: ICONS.bold, order: 10, chain: (c) => c.toggleBold() }),
  toggle('italic', { command: 'markup.toggleItalic', title: 'Italic', keybinding: 'Mod+I', icon: ICONS.italic, order: 15, chain: (c) => c.toggleItalic() }),
  toggle('underline', { command: 'markup.toggleUnderline', title: 'Underline', keybinding: 'Mod+U', icon: ICONS.underline, order: 20, chain: (c) => c.toggleUnderline() }),
  toggle('strike', { command: 'markup.toggleStrike', title: 'Strikethrough', keybinding: 'Mod+Shift+S', icon: ICONS.strike, order: 25, chain: (c) => c.toggleStrike() }),
  toggle('highlight', { command: 'markup.toggleHighlight', title: 'Highlight', icon: ICONS.highlight, order: 30, chain: (c) => c.toggleMark('highlight') }),
  toggle('code', { command: 'markup.toggleCode', title: 'Code', keybinding: 'Mod+E', icon: ICONS.code, order: 35, chain: (c) => c.toggleCode() }),
];

/** "Code block" and "Quote" in the Insert menu. */
export const INSERT_BUTTONS: ChainButton[] = [
  toggle('codeBlock', { command: 'markup.toggleCodeBlock', title: 'Code block', icon: ICONS.codeBlock, keywords: ['listing', 'raw'], order: 40, chain: (c) => c.toggleCodeBlock() }),
  toggle('blockquote', { command: 'markup.toggleBlockquote', title: 'Quote', keybinding: 'Mod+Shift+B', icon: ICONS.quote, keywords: ['blockquote', 'citation'], order: 50, chain: (c) => c.toggleBlockquote() }),
];

/** Where "Link" asks for the URL: the window's input box. */
export type LinkPrompt = Pick<WindowApi, 'showInputBox'>;

/** The command of "Link": asks for the URL of a link at the selection of the menu's editor (`askLink`). */
export const LINK_COMMAND = 'markup.link';

/** The command of "Link" (also Mod+K: `linkShortcut`). */
export function linkCommand(prompt: LinkPrompt): (context: VisualEditorMenuContext) => Promise<void> {
  return ({ editor }) => askLink(editor, prompt);
}

/** "Link" in the selection's bar and the link bar: asks for the URL in an input box; enabled where a link may go (not in code). */
export const LINK_BUTTON: MenuItem<VisualEditorMenuContext> = {
  command: LINK_COMMAND,
  title: 'Link',
  keybinding: 'Mod+K',
  icon: ICONS.link,
  order: 50,
  enabled: ({ editor }) => editor.can().setMark('link'),
  toggled: ({ editor }) => editor.isActive('link'),
};

/** The bar above a link holding the caret (no text selected: else the selection's bar shows), to edit the link. */
export const LINK_BAR: FloatingBar = {
  id: 'visualEditor/link',
  order: 11,
  label: 'Link',
  anchor: ({ editor }) => (editor.state.selection.empty && editor.isActive('link') ? caretCoords(editor) : null),
};

/** Above the caret, or null without layout. */
function caretCoords(editor: Editor): Anchor {
  try {
    const { top, left, right } = editor.view.coordsAtPos(editor.state.selection.from);
    return { top, left, right };
  } catch {
    return null; // no layout (e.g. not attached)
  }
}

/** Mod+K in the text (a raw box's code keeps its own keys): "Link", as in the selection's bar. */
export function linkShortcut(prompt: LinkPrompt): AnyExtension {
  return Extension.create({
    name: 'typstLinkShortcut',
    addKeyboardShortcuts() {
      return {
        'Mod-k': ({ editor }) => {
          if (!editor.can().setMark('link')) return false;
          void askLink(editor, prompt);
          return true;
        },
      };
    },
  });
}

/**
 * Asks for the URL of a link at the selection: with nothing selected it inserts the URL as linked text; inside a
 * link it edits the whole link, and an empty URL removes it.
 */
async function askLink(editor: Editor, prompt: LinkPrompt): Promise<void> {
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

// -------------------------------------------------------------- line breaks

const HardBreak = starterKitPart('typstHardBreak', { hardBreak: {} }).extend({
  // `src`: the break as written (new: `\` and a newline)
  addGlobalAttributes: () => [{ types: ['hardBreak'], attributes: { src: { default: '\\\n', rendered: false, keepOnSplit: false } } }],
});

/** Typst's line break `\` (Tiptap's hard break, Shift+Enter): an inline atom printing its `src`. */
export const HARD_BREAK: TypstNodeSpec = {
  name: 'hardBreak',
  tiptap: HardBreak,
  typst: { parseTypst: { syntaxNodes: { Linebreak: { inline: (p, node) => p.schema.nodes.hardBreak.create({ src: p.text(node) }) } } } },
};
