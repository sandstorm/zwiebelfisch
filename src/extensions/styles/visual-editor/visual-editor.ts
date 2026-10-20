// Custom styles in the Visual editor. See styles in ../styles.ts.
import type { SyntaxNode } from '@lezer/common';
import { Extension, type Editor } from '@tiptap/core';
import type { Mark, Node } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { Disposable } from '../../../core/disposable/disposable';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { calleeName, children, trailingContent, withHash } from '../../../core/typst-syntax/typst-syntax';
import { svg, type TextStyle, type TextStyleProvider, type ToolbarAction, type ToolbarContext, type ToolbarGroup, type TypstNodeSpec, type VisualEditorContext, type VisualEditorContributions } from '../../../hosts/visual-editor/visual-editor';
import { type PlacedNode, type TypstMarkSpec, type TypstSerializeState, type TypstParseContext } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';
import type { ProjectStyles } from '../model/typst-style-index';
import type { TypstStyle, TypstStyleKind } from '../model/discover';
import { StyledBlock, TypstStyleMark } from './style-nodes';

/**
 * Custom styles (see `model/`): a call of a declared paragraph
 * style that is a block of its own (`#note[..]`, `#callout(..)[..]`) is a
 * `styledBlock` holding blocks; an inline style call in running text
 * (`#key[..]`) is text with a `style` mark. Undeclared calls stay raw; a style
 * declared or removed parses every Visual editor's document again. The text style menu lists the
 * project's styles and "New style…" (after normal text and what other
 * extensions contribute) and applies them, importing a style where it is now
 * used. The inline styles are also the "Styles" menu of the bar above a text
 * selection, toggled there as in the text style menu.
 */
export function registerCustomStyles(visualEditor: VisualEditorContributions, options: StylesOptions): Disposable {
  const declared = declaredStyles(options.styles);
  // a style declared or removed: every Visual editor parses its document again
  const onDidChange = options.styles.onDidChange;
  return Disposable.from(
    visualEditor.registerNode({
      ...STYLED_BLOCK,
      typst: { ...STYLED_BLOCK.typst, parseTypst: { calls: { '*': { block: (p, call, sep) => parseStyledBlock(p, call, sep, declared()) } } }, onDidChange },
    }),
    visualEditor.registerMark({
      ...STYLE,
      typst: {
        ...STYLE.typst,
        parseTypst: {
          calls: {
            '*': {
              inline: (p, call, marks) => parseStyleCall(p, call, marks, declared()),
              inRunningText: (p, call) => declared().get(calleeName(call, p.source))?.kind === 'inline',
            },
          },
        },
        onDidChange,
      },
    }),
    visualEditor.registerTextStyleProvider(textStyles(options)),
    visualEditor.registerToolbarGroup(INLINE_STYLES_MENU),
    visualEditor.registerToolbarItem({ group: INLINE_STYLES_MENU.id, provideActions: (toolbar) => inlineStyleActions(options.styles, toolbar) }),
  );
}

/** A letter over a line: an inline style. */
const STYLE_ICON = svg('<path d="m7 15 5-11 5 11"/><path d="M9 11h6"/><path d="M5 20h14"/>');

/** "Styles ▾" in the bar above a text selection, after the marks: the inline styles (left out while there are none). */
const INLINE_STYLES_MENU: ToolbarGroup = { kind: 'menu', id: 'inline-styles', bar: 'selection', order: 40, label: 'Styles', icon: () => STYLE_ICON };

export interface StylesOptions {
  /** The project's styles: their calls show as styled, editable text. */
  styles: ProjectStyles;
  /** "New style…" in the text style menu. */
  create(): void;
}

/** The Visual editors by document, so a style can be applied from outside the text style menu (search everywhere). */
export interface StyleApplier {
  /**
   * Applies `style` to the selection of `document`'s Visual editor as the text style menu does (with the import);
   * false if the document has no Visual editor or the style does not apply there (an inline style without a selection).
   */
  apply(document: TypstDocument, style: TypstStyle): boolean;
  dispose(): void;
}

/** A `StyleApplier` over the Visual editors of every document (each followed from its creation to its end). */
export function registerStyleApplier(visualEditor: VisualEditorContributions, source: ProjectStyles): StyleApplier {
  const editors = new Map<TypstDocument, { editor: VisualEditorContext; tiptap: Editor }>();
  const registration = visualEditor.registerTiptapExtension((editor) =>
    Extension.create({
      name: 'typstStyleApplier',
      addProseMirrorPlugins() {
        const tiptap = this.editor;
        // a plugin view lives exactly as long as the editor's view (Tiptap's onCreate comes a tick later)
        const follow = () => {
          editors.set(editor.document, { editor, tiptap });
          return { destroy: () => editors.get(editor.document)?.tiptap === tiptap && editors.delete(editor.document) };
        };
        return [new Plugin({ view: follow })];
      },
    }),
  );
  return {
    apply(document, style) {
      const shown = editors.get(document);
      return shown ? applyTextStyle(textStyle(style, shown.editor, source), shown.tiptap) : false;
    },
    dispose: () => registration.dispose(),
  };
}

/**
 * The inline styles as buttons of the Styles menu in the selection bar: pressed where the selection has the style; a
 * click toggles it as the text style menu's entry does.
 */
function inlineStyleActions(source: ProjectStyles, toolbar: ToolbarContext): ToolbarAction[] {
  return source
    .styles()
    .filter((style) => style.kind === 'inline')
    .map((style) => {
      const entry = textStyle(style, toolbar, source);
      return { label: entry.label, icon: STYLE_ICON, enabled: entry.enabled, active: entry.isActive, click: () => void applyTextStyle(entry, toolbar.editor) };
    });
}

/** Applies a text style menu `entry` to the selection of `tiptap` (with what follows, the import); false where it does not apply. */
function applyTextStyle(entry: TextStyle, tiptap: Editor): boolean {
  if (entry.enabled && !entry.enabled(tiptap)) return false;
  const applied = entry.apply(tiptap.chain().focus(), tiptap).run();
  if (applied) entry.applied?.();
  return applied;
}

/** The declared styles by function name, as of now (made anew when the list changes). */
function declaredStyles(source: ProjectStyles): () => Declared {
  let list: readonly TypstStyle[] | null = null;
  let map: Declared = new Map();
  return () => {
    const current = source.styles();
    if (current !== list) {
      list = current;
      map = new Map(current.map((style) => [style.name, { kind: style.kind, label: style.label }]));
    }
    return map;
  };
}

type Declared = ReadonlyMap<string, { kind: TypstStyleKind; label: string }>;

const STYLED_BLOCK: TypstNodeSpec = {
  name: 'styledBlock',
  tiptap: StyledBlock,
  typst: { toTypst: styledBlockToTypst, anchors: ['layout'], labelled: true },
};

/** `#name[..]` around a styled block's blocks, or the call around them as parsed. */
function styledBlockToTypst(state: TypstSerializeState, block: Node, pos: number): void {
  const { open, close }: StyleLayout = block.attrs.layout ?? { open: `#${block.attrs.name}[`, close: ']' };
  state.hidden(open);
  state.blocks(block, pos + 1, '\n\n');
  state.closing(close);
}

/** How a styled block's source lies around its content: `#note[` (or `#callout(..)[`) and `]`. Null: a new one. */
interface StyleLayout {
  open: string;
  close: string;
}

/** `#name(..)?[content]` of a declared block style: a `styledBlock` whose content is segmented like the document. */
function parseStyledBlock(p: TypstParseContext, call: SyntaxNode, sep: string | null, declared: Declared): Node | null {
  const name = calleeName(call, p.source);
  const style = declared.get(name);
  const blocks = trailingContent(call);
  if (style?.kind !== 'block' || blocks?.length !== 1) return null;
  const { content: inside, from, to } = p.blocks(blocks[0]);
  const { from: start, to: end } = withHash(call);
  const layout: StyleLayout = { open: p.source.slice(start, from), close: p.source.slice(to, end) };
  return p.schema.nodes.styledBlock.create({ name, title: style.label, sep, layout }, inside);
}

const STYLE: TypstMarkSpec = {
  name: 'style',
  tiptap: TypstStyleMark,
  typst: { toTypst: (mark) => ({ open: mark.attrs.head ?? `#${mark.attrs.name}[`, close: ']' }) },
};

/** `#key[text]` (or `#key(..)[text]`) of a declared inline style, with non-empty, single-paragraph text; null otherwise. */
function parseStyleCall(p: TypstParseContext, call: SyntaxNode, marks: readonly Mark[], declared: Declared): PlacedNode[] | null {
  const name = calleeName(call, p.source);
  const style = declared.get(name);
  const blocks = trailingContent(call);
  if (style?.kind !== 'inline' || blocks?.length !== 1) return null;
  const inside = children(blocks[0].getChild('Markup')!);
  if (inside.length === 0 || inside.some((n) => n.name === 'Parbreak')) return null;
  // the `#` before the call up to and with the `[`: printed again as is
  const head = p.source.slice(withHash(call).from, blocks[0].from + 1);
  return p.inline(inside, p.schema.marks.style.create({ name, title: style.label, head }).addToSet(marks));
}

/**
 * The text style menu's entries: the block styles (wrap the selected blocks, `#note[..]`; Normal text takes them
 * off), the inline styles (toggle on a selection, `#key[..]`), and "New style…". Applying a style imports it into the
 * editor's document where needed.
 */
function textStyles({ styles: source, create }: StylesOptions): TextStyleProvider {
  return {
    provideTextStyles: (editor) => [...source.styles().map((style) => textStyle(style, editor, source)), { id: 'new-style', label: 'New style…', order: 1000, apply: (chain) => chain, applied: create }],
    onDidChangeTextStyles: source.onDidChange,
  };
}

/** The menu entry of `style`, in `editor`. */
function textStyle(style: TypstStyle, editor: VisualEditorContext, source: ProjectStyles): TextStyle {
  const applied = { name: style.name, label: style.label };
  const entry = {
    label: style.label,
    applied: () => {
      const change = source.calculateImportChange(editor.document, style, editor.selection().from);
      if (change) editor.document.change([change], STYLE_IMPORT);
    },
  };
  if (style.kind === 'block') {
    return {
      ...entry,
      id: `block:${style.name}`,
      section: 'Block styles',
      order: 100,
      apply: (chain) => chain.setBlockStyle(applied),
      isActive: (editor) => editor.isActive('styledBlock', { name: style.name }),
      remove: (chain) => chain.unsetBlockStyle(),
    };
  }
  return {
    ...entry,
    id: `inline:${style.name}`,
    section: 'Inline styles',
    order: 200,
    toggle: true,
    apply: (chain) => chain.toggleInlineStyle(applied),
    enabled: (editor) => !editor.state.selection.empty && editor.can().toggleInlineStyle(applied),
    isActive: (editor) => editor.isActive('style', { name: style.name }),
  };
}

/** The origin of the import a newly applied style adds to the document. */
const STYLE_IMPORT = 'style-import';
