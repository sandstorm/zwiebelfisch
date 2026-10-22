import type { AnyExtension, ChainedCommands, Editor, Range } from '@tiptap/core';
import { StateEffect } from '@codemirror/state';
import type { Node } from '@tiptap/pm/model';
import type { Decoration } from '@tiptap/pm/view';
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { SourceOffset, SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import type { MenuItem } from '../commands/commands';
import type { DocumentNodeSpec, TypstMarkSpec } from './typst-conversion/typst-conversion';

/**
 * The Visual editor's contribution points (what `ExtensionContext.visualEditor` is). Contributions register once, at
 * activation; the host applies what is registered to every editor it creates from then on (editors are created lazily,
 * per document), so a contribution never tracks editors. Everything a contribution needs per editor (its document, a
 * popover) it gets through the `…Provider` functions. Disposing a registration takes it out of editors created later.
 * Experimental: the shapes may still change.
 */
export interface VisualEditorContributions {
  /**
   * A node type: its Tiptap extension, its Typst, what the editor does for it (see `TypstNodeSpec`). The priority of
   * its Tiptap extension (Tiptap's: default 100, higher first) orders the schema (a group's first node type is its
   * default), keymaps and plugins, and the specs' parse rules: of specs reading the same syntax or call, the higher
   * one is asked first (task lists, 110, before bullet lists, both `- ..`). Of two specs of the same name, the later
   * one in that order extends the earlier.
   */
  registerNode(spec: TypstNodeSpec): Disposable;
  /**
   * A mark type and its Typst (see `TypstMarkSpec`). The priority of its Tiptap extension orders the schema, which is
   * how marks nest: a higher one is outside a lower one (a comment's range, 130, outside a link, 120, outside bold,
   * 100); it also orders the parse rules, as for nodes.
   */
  registerMark(spec: TypstMarkSpec): Disposable;
  /**
   * Tiptap extensions in every editor, the same value for all, or made for each (they may use its document):
   * decorations, plugins (drops, appended transactions), commands not tied to a node. Their hooks see the editor's
   * Tiptap editor (`this.editor`).
   */
  registerTiptapExtension(extension: AnyExtension | readonly AnyExtension[] | ((editor: VisualEditorContext) => AnyExtension | readonly AnyExtension[])): Disposable;
  /**
   * A menu button (VS Code's submenu) in the menu `submenu.parent` (the toolbar row, a floating bar), placed by `group`
   * and `order` as an entry there: it opens the entries of the menu `submenu.id`, and is left out while that has none.
   * The host's own: `visualEditor/insert` ("Insert", in the row's group `5_insert`).
   */
  registerSubmenu(submenu: Submenu): Disposable;
  /**
   * A bar floating in the text above `bar.anchor`, holding the entries of the menu `bar.id` (and the submenus placed
   * there). Of the bars with entries, only the first (by `order`) with an anchor shows. The host's own:
   * `visualEditor/selection` (above a text selection, order 10).
   */
  registerFloatingBar(bar: FloatingBar): Disposable;
  /**
   * A list that pops up while `trigger.char` and a query are typed in the text (the labels after `@`, the slash
   * commands after `/`): the provider's items, filtered by the query (see `CompletionItem`). Not in code (code
   * blocks, inline code) nor raw boxes. Of two providers with the same character, each opens its own list.
   */
  registerCompletionItemProvider(provider: CompletionItemProvider, trigger: CompletionTrigger): Disposable;
  /**
   * Highlights from `provider` in every editor, apart from other providers': set when the editor is created and again
   * whenever the provider reports a change of its document; they follow edits in between.
   */
  registerHighlightProvider(provider: SourceHighlightProvider): Disposable;
  /**
   * What raw boxes of each editor show instead of their code while not edited. The renderers are asked by `priority`
   * (default 100, higher first; equal: registration order), and the first that `renders` a box draws it: the image
   * renderer (110) draws image boxes, compiled snippets (100) the rest.
   */
  registerRawBoxRenderer(provider: RawBoxRendererProvider, options?: { readonly priority?: number }): Disposable;
  /**
   * Takes part in every raw box of each editor: `provider` is called once per box, as it is made, and decides by the
   * box's node itself (an image: resize handles; document links: the picture's link); null: nothing for this box.
   * Providers are called in registration order, before the box adds its own listeners to its picture, so theirs run
   * first: one that stops a `mousedown` there (`stopImmediatePropagation`) keeps the box from opening its code. What
   * it returns is told of the box's new nodes and disposed with the box.
   */
  registerRawBoxBehavior(provider: (box: RawBoxContext) => RawBoxBehavior | null): Disposable;
}

/**
 * The view type of the Visual editor, for `window.showDocument(path, { viewType })`,
 * `TextEditor.viewType` and the menu context key `activeEditorId`.
 */
export const VISUAL_EDITOR = 'visualEditor';

/**
 * What the Visual editor's menus are shown with and run their commands with (the command's one argument): the editor
 * they are in. Its menus (`window.registerMenuItem`), their buttons drawn with the entry's icon (else its
 * `shortTitle`, else its title), its title and key as the tooltip, pressed where `toggled` holds, disabled where
 * `enabled` does not, left out where `when` does not:
 * - `visualEditor/toolbar`: the toolbar row, a group of buttons per `group` (by name: `1_history`, `2_textStyle` the
 *   text style menu, `3_lists`, `4_align`, `5_insert` the Insert menu, `6_comments`)
 * - `visualEditor/insert`: the Insert menu
 * - `visualEditor/selection`: the bar above a text selection
 * - `visualEditor/textStyle`: the text style menu (a `<select>`), after the host's "Normal text": its value the first
 *   entry whose `toggled` holds; the entries of group `inline` are toggles instead (✓ where on, never the value);
 *   consecutive entries of one `category` under its title. An entry chosen where it is on takes itself off (a
 *   heading level, a block style): "Normal text" runs the value's command, then makes the blocks paragraphs
 * - the menus of the submenus and floating bars that extensions add (`registerSubmenu`, `registerFloatingBar`)
 */
export type VisualEditorMenuContext = VisualEditorContext & { readonly tiptap: Editor };

// The contribution points: what extensions register, and what they are given.

/**
 * A Typst construct the Visual editor models as a node, its fields grouped by whose concept they are: `tiptap`, the
 * Tiptap extension defining the node type (`Node.create(..)`: schema, attributes, node view, commands, keymap,
 * priority; given to Tiptap untouched); `typst`, how it is read from Typst and written back (`TypstNodeConversion`);
 * `view`, what the Visual editor host does for its nodes.
 */
export interface TypstNodeSpec extends DocumentNodeSpec {
  readonly view?: {
    /** Shown as a box a remote caret inside outlines: `code` edits its `src` in a nested code editor (the host's raw box). */
    readonly box?: 'code' | 'widget';
    /** For `box: 'code'`: a heading above the code saying what the box shows (an outline: "Table of contents"); `className` goes on the box. */
    readonly title?: { readonly className: string; text(src: string): string };
    /** Keeps its DOM (and what is inside) while a new version renders the same, as after every outside edit its `src` changes. */
    readonly keepsDom?: boolean;
  };
}

/**
 * A styled stretch of the source (UTF-16 offsets) that the Visual editor draws
 * over its text, e.g. another user's selection or a diagnostic. `attributes`
 * are set on the marked DOM (e.g. a style with the user's color). Editors follow
 * edits with their highlights until the owner sets them again.
 */
export interface SourceHighlight extends SourceRange {
  className: string;
  attributes?: Record<string, string>;
}

/** Styled source ranges of each document (diagnostics), kept up to date in its Visual editors. */
export interface SourceHighlightProvider {
  /** The highlights of `document` now (source offsets in its current text). */
  provideHighlights(document: TypstDocument): readonly SourceHighlight[];
  /** Fires with a document whose highlights changed. */
  readonly onDidChangeHighlights: Event<TypstDocument>;
}

/** One Visual editor, as contributions made for it see it (see the `…Provider` types). */
export interface VisualEditorContext {
  /** The document the editor shows. */
  readonly document: TypstDocument;
  /** The source range the editor's selection shows (see `VisualEditor.selection`). */
  selection(): SourceRange;
  /** Whether `node` shows as a box of its own (raw Typst, an image, a page break, a margin note), not as text. */
  isBox(node: Node): boolean;
}

// Raw boxes: what contributions add to Typst kept verbatim (edited as code).

/** A picture a box shows instead of its code: a URL and CSS lengths ('' or absent: automatic). */
export interface RawBoxPicture {
  url: string;
  width?: string;
  height?: string;
  margin?: string;
}

/**
 * What raw boxes show instead of their code while they are not being edited.
 * The first renderer that `renders` a box draws it; without one, it shows code.
 */
export interface RawBoxRenderer {
  /** Whether it draws boxes of `node`'s kind. */
  renders(node: Node): boolean;
  /** The picture of the box `node` whose source starts at `from`; null: show the code. */
  render(node: Node, from: SourceOffset): Promise<RawBoxPicture | null>;
  /** Draws a box again as soon as its node changes (an image follows its path), not only on `onDidChange`. */
  readonly followsEdits?: boolean;
  /** A class of the renderer's own on the picture (`<img>`), for its CSS (compiled snippets inverted in the dark). */
  readonly className?: string;
  /** Fires whenever pictures may have changed (a new compile). */
  readonly onDidChange: Event<void>;
}

/** The renderer of one editor's boxes (null: none for this editor). */
export type RawBoxRendererProvider = (editor: VisualEditorContext) => RawBoxRenderer | null;

/**
 * The decorations the Visual editor gives a raw box's node (e.g. one marking another user's caret inside the box),
 * dispatched to the box's code editor when the box is made and on every update of its node: how a box code
 * extension learns what is drawn on its box (a transaction extender or state field reads the effect).
 */
export const setRawBoxDecorations = StateEffect.define<readonly Decoration[]>();

/** One raw box, as a raw box behavior (`registerRawBoxBehavior`) gets it. */
export interface RawBoxContext {
  /** The box's element. */
  readonly dom: HTMLElement;
  /** The element holding the code editor; what the extension adds goes in before it. */
  readonly code: HTMLElement;
  /**
   * The picture (`<img>`) a box renderer draws instead of the code (the extension may move it, e.g. into a frame);
   * null: no renderer draws the box. The element stays for the box's life; a new picture changes its `src` (`load`).
   */
  readonly picture: HTMLImageElement | null;
  readonly tiptap: Editor;
  /** The editor the box is in. */
  readonly editor: VisualEditorContext;
  /** The box's node now. */
  node(): Node;
  /** The box's Typst now (its node's `src`; a figure's body is code, without `#`). */
  src(): string;
  /** The box's document position, while it is in the document. */
  getPos(): number | undefined;
  /** Shows and focuses the code. */
  editCode(): void;
}

/** What a raw box behavior adds to one box. */
export interface RawBoxBehavior {
  /** The box's node changed (e.g. its code was edited). */
  update?(node: Node): void;
  dispose(): void;
}

// The toolbar: menus of commands (`window.registerMenuItem`), submenus and floating bars.

/** A menu button: its menu (the entries it opens), where it is, and its icon. */
export interface Submenu {
  /** Its menu's id: the entries it opens (`window.registerMenuItem(id, ..)`), e.g. `visualEditor/align`. */
  readonly id: string;
  readonly label: string;
  /** The button's icon, asked after every transaction (the selection's alignment). */
  icon(context: VisualEditorMenuContext): string;
  /** The menu the button is in: `visualEditor/toolbar` or a floating bar's. */
  readonly parent: string;
  /** Its group and place there, as an entry's. */
  readonly group?: string;
  readonly order?: number;
}

/** A button that runs a Tiptap chain, as `registerChainButton` registers it: a menu entry, and what its command does. */
export interface ChainButton extends Omit<MenuItem<VisualEditorMenuContext>, 'enabled'> {
  /** Runs on the menu's editor, focused; its dry run there is whether the entry is enabled. */
  chain(chain: ChainedCommands): ChainedCommands;
}

/** A bar floating in the text: its menu (`id`), where it floats, and its place among the bars. */
export interface FloatingBar {
  /** Its menu's id: the buttons it holds (`window.registerMenuItem(id, ..)`), e.g. `visualEditor/table`. */
  readonly id: string;
  readonly label: string;
  readonly order: number;
  /** Where it floats now (null: hidden), asked after every transaction. */
  anchor(context: VisualEditorMenuContext): Anchor;
}

// Suggestions: lists that pop up while a trigger character and a query are typed.

/**
 * Where a completion list opens: right after `char` is typed at the start of a text block or after one of
 * `allowedPrefixes` (default: a space). Named as Tiptap's suggestion options.
 */
export interface CompletionTrigger {
  readonly char: string;
  readonly allowedPrefixes?: readonly string[];
}

/** What a completion item provider is asked with: the editor, its Tiptap editor and the query. */
export interface CompletionContext extends VisualEditorContext {
  readonly tiptap: Editor;
  /** What is typed after the trigger character (the list filters the items by it). */
  readonly query: string;
}

/**
 * An entry of a completion list. The list shows the items whose label or keywords contain the query (what is
 * typed after the trigger character; case ignored): a label equal to it first, then labels starting with it, then
 * labels containing it, then keywords containing it, each in the provider's order.
 */
export interface CompletionItem {
  readonly label: string;
  /** Shown after the label, dimmed (what a label labels, the menu an entry is from). */
  readonly detail?: string;
  /** A toolbar icon (`svg(..)`), shown before the label. */
  readonly icon?: string;
  /** Other words it is found by. */
  readonly keywords?: readonly string[];
  /** Typed while the item is the chosen one, these choose it first and are then typed (`@intro` + `.`). */
  readonly commitCharacters?: readonly string[];
  /** Chooses it: replaces `range`, the trigger character and the query, with what the item stands for. */
  command(props: { tiptap: Editor; range: Range }): void;
}

/** The items of one completion list; asked again on every keystroke while the list is open. */
export interface CompletionItemProvider {
  provideCompletionItems(context: CompletionContext): readonly CompletionItem[];
}

/** Where a floating bar points: a viewport rectangle (e.g. a selection's or a table's), or nothing (hidden). */
export type Anchor = { top: number; left: number; right: number } | null;

export { VisualEditor, VisualEditorHost } from './visual-editor-impl';
export { chainCommand, insertTypst, registerChainButton, svg } from './visual-editor-helpers';
