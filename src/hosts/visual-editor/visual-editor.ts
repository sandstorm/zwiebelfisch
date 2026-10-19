import type { AnyExtension, ChainedCommands, Editor, Range } from '@tiptap/core';
import { StateEffect, type Extension } from '@codemirror/state';
import type { Node } from '@tiptap/pm/model';
import type { Decoration } from '@tiptap/pm/view';
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { SourceOffset, SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import type { DocumentPasteEdit, PasteChoices } from '../languages/languages';
import type { DocumentNodeSpec, TypstMarkSpec } from '../prosemirror-typst/prosemirror-typst';

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
   * Tiptap extensions made for each editor (they may use its document): decorations, plugins (drops, appended
   * transactions), commands not tied to a node. Their hooks see the editor's Tiptap editor (`this.editor`).
   */
  registerTiptapExtension(provider: (editor: VisualEditorContext) => AnyExtension | readonly AnyExtension[]): Disposable;
  /** A place for toolbar items: a group, a menu or a floating bar. */
  registerToolbarGroup(group: ToolbarGroup): Disposable;
  /** A button or control in a toolbar group (one the host or a contribution registered). */
  registerToolbarItem(item: ToolbarItem): Disposable;
  /**
   * Entries of the toolbar's text style menu (headings' levels, a project's custom styles), after the host's own
   * "Normal text". The menu shows once any provider is registered.
   */
  registerTextStyleProvider(provider: TextStyleProvider): Disposable;
  /**
   * A list that pops up while `trigger.char` and a query are typed in the text (the labels after `@`, the slash
   * commands after `/`): the provider's items, filtered by the query (see `CompletionItem`). Not in code (code
   * blocks, inline code) nor raw boxes. Of two providers with the same character, each opens its own list.
   */
  registerCompletionItemProvider(provider: CompletionItemProvider, trigger: CompletionTrigger): Disposable;
  /**
   * Highlights from `provider` in every editor, as layer `layer` (one per provider): set when the editor is created and
   * again whenever the provider reports a change of its document; they follow edits in between.
   */
  registerHighlights(layer: string, provider: SourceHighlightProvider): Disposable;
  /**
   * What raw boxes of each editor show instead of their code while not edited. The renderers are asked by `priority`
   * (default 100, higher first; equal: registration order), and the first that `renders` a box draws it: the image
   * renderer (110) draws image boxes, compiled snippets (100) the rest.
   */
  registerRawBoxRenderer(provider: RawBoxRendererProvider, options?: PriorityOptions): Disposable;
  /** CodeMirror extensions for the code of every raw box of each editor (e.g. the shared ones of the Source editors). */
  registerRawBoxCodeMirrorExtension(provider: (editor: VisualEditorContext) => Extension): Disposable;
  /**
   * Takes part in the picture of every raw box a box renderer draws, in each editor (document links: hovered, the
   * picture shows the box's link; Mod+click follows it): `provider` is called once per picture, before the box adds
   * its own listeners to it, so the provider's run first; one that stops a `mousedown` (`stopImmediatePropagation`)
   * keeps the box from opening. What it returns is disposed with the box.
   */
  registerRawBoxPictureExtension(provider: (box: RawBoxPictureHost) => Disposable): Disposable;
}

/**
 * The view type of the Visual editor's custom editor, for `workbench.open(path, { viewType })`,
 * `TextEditor.viewType` and the menu context key `activeCustomEditorId`.
 */
export const VISUAL_EDITOR = 'visualEditor';

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
    /** For `box: 'code'`: tools on every box of this type (an image's heading and resize handles). */
    tools?(host: RawBoxToolsHost, node: Node): RawBoxTools;
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

/** What a contribution's `activate` gets: a part of the extension context (which offers more). */
export interface ContributionContext {
  readonly visualEditor: VisualEditorContributions;
  /** Disposed when the contribution is deactivated, in reverse order. */
  readonly subscriptions: { dispose(): unknown }[];
}

/**
 * A construct or feature contributing to the Visual editor: `activate` registers
 * its parts and pushes each registration's Disposable to `subscriptions`.
 * Shaped like an extension (`Extension`): a construct without
 * configuration is one, in the widget's list of built-in extensions; a
 * feature's extension activates the contributions it configures.
 */
export interface VisualEditorContribution {
  readonly id: string;
  activate(context: ContributionContext): void;
}

/**
 * Who wins where box renderers compete: higher `priority` first (default 100, as Tiptap's extension priority), and
 * equal priorities in registration order. Registration order alone never carries meaning between extensions. (Nodes
 * and marks compete by their Tiptap extensions' own priority.)
 */
export interface PriorityOptions {
  readonly priority?: number;
}

/**
 * Everything registered: box renderers by priority (see `PriorityOptions`), the rest in registration order. What the
 * host applies to each editor it creates.
 */
export interface Contributed {
  readonly nodes: readonly TypstNodeSpec[];
  readonly marks: readonly TypstMarkSpec[];
  readonly tiptapExtensions: readonly ((editor: VisualEditorContext) => AnyExtension | readonly AnyExtension[])[];
  readonly toolbarGroups: readonly ToolbarGroup[];
  readonly toolbarItems: readonly ToolbarItem[];
  readonly highlights: readonly { readonly layer: string; readonly provider: SourceHighlightProvider }[];
  readonly rawBoxRenderers: readonly RawBoxRendererProvider[];
  readonly rawBoxCodeMirrorExtensions: readonly ((editor: VisualEditorContext) => Extension)[];
  readonly rawBoxPictureExtensions: readonly ((box: RawBoxPictureHost) => Disposable)[];
  readonly textStyles: readonly TextStyleProvider[];
  readonly completionItemProviders: readonly { readonly provider: CompletionItemProvider; readonly trigger: CompletionTrigger }[];
}

/** One Visual editor, as contributions made for it see it (see the `…Provider` types). */
export interface VisualEditorContext {
  /** The document the editor shows. */
  readonly document: TypstDocument;
  /** The source range the editor's selection shows (see `VisualEditor.selection`). */
  selection(): SourceRange;
  /**
   * The position in `doc` (the editor's document node, e.g. a transaction's) that shows source offset `offset`: with
   * `bias` -1, a position at the end of the text before it (a caret at a line end stays there). The only way from
   * source offsets to ProseMirror positions.
   */
  sourceToPos(doc: Node, offset: SourceOffset, bias?: 1 | -1): number;
  /** The source offset a position in `doc` shows (with `bias` -1: where the text before it ends); the only way back. */
  posToSource(doc: Node, pos: number, bias?: 1 | -1): SourceOffset;
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

/** The box tools of a code box belong to. */
export interface RawBoxToolsHost {
  /** The box's element. */
  readonly dom: HTMLElement;
  /** The element holding the code editor; tools go in before it. */
  readonly code: HTMLElement;
  /** The rendered picture (the tools may move it, e.g. into a frame), or null without a renderer. */
  readonly picture: HTMLImageElement | null;
  readonly tiptap: Editor;
  /** The editor the box is in. */
  readonly editor: VisualEditorContext;
  /** The box's document position, while it is in the document. */
  getPos(): number | undefined;
  /** Shows and focuses the code. */
  editCode(): void;
}

/** Tools on a code box (an image's heading and resize handles); a click on the picture then selects the box. */
export interface RawBoxTools {
  /** The box's node changed. */
  update(node: Node): void;
  dispose(): void;
}

/** The picture of a raw box, as a picture extension (`registerRawBoxPictureExtension`) gets it. */
export interface RawBoxPictureHost {
  /** The picture (`<img>`) the box shows instead of its code. */
  readonly picture: HTMLImageElement;
  /** The editor the box is in. */
  readonly editor: VisualEditorContext;
  /** The box's Typst now (its node's `src`; a figure's body is code, without `#`). */
  src(): string;
}

/**
 * Who takes part in copy and paste of Typst in the Visual editor (the workbench's `languages`: the paste edit
 * providers of Typst): a copy or cut adds to the clipboard, a paste may go in as other kinds and what goes in may
 * change, and change the document elsewhere, in the paste's step; a paste that may go in as another kind shows its
 * choice there (the "Paste as" chip asks which). The workbench gives it to the host.
 */
export interface VisualEditorPasteEdits extends PasteChoices {
  /** On a copy or cut of `copied` (Typst) from `document`: adds what a paste will need to the clipboard `dataTransfer`. */
  prepareDocumentPaste(document: TypstDocument, copied: string, dataTransfer: DataTransfer): void;
  /** The providers' edits of a paste of the clipboard `dataTransfer` into `document` in place of `ranges`, besides the editor's own. */
  provideDocumentPasteEdits(document: TypstDocument, ranges: readonly SourceRange[], dataTransfer: DataTransfer): readonly DocumentPasteEdit[];
  /**
   * `edit` as it goes in, as the providers resolve it: its text, and the other changes of the document's text it makes
   * (of the text before the paste, overlapping neither the ranges nor each other).
   */
  resolveDocumentPasteEdit(edit: DocumentPasteEdit, document: TypstDocument, ranges: readonly SourceRange[], dataTransfer: DataTransfer): DocumentPasteEdit;
}

// The toolbar: buttons (actions), controls, groups, menus and floating bars.

/** A toolbar button: how it looks, what it does, and when it shows as on. */
export interface ToolbarAction {
  label: string;
  /** Shortcut shown in the tooltip; `Mod` becomes ⌘ or Ctrl. */
  shortcut?: string;
  /** An `svg(..)` icon; or `text`. */
  icon?: string;
  /** A short text shown in place of an icon, where it says more (`25%`). */
  text?: string;
  /** The command; also decides, dry-run, whether the button is enabled. An action with `click` has none. */
  run?(chain: ChainedCommands): ChainedCommands;
  /** Instead of running a command, e.g. to ask for a value first. */
  click?(): void;
  /** Other words it is found by where entries are searched (the slash commands): `['grid']` for a table. */
  readonly keywords?: readonly string[];
  /** Whether the button is enabled, instead of the dry run of `run` (default for an action without `run`: enabled). */
  enabled?(editor: Editor): boolean;
  /** Toggles show their state (`aria-pressed`); plain actions (undo) do not. */
  active?(editor: Editor): boolean;
  /** Whether the button shows (default: always): one that does not apply here is left out rather than disabled. */
  visible?(editor: Editor): boolean;
  /** In a floating bar: shows the bar at its anchor also without a selection (a link at the cursor). */
  showsBar?(editor: Editor): boolean;
}

/** A toolbar icon: 24×24 outline strokes in the text colour. */
export function svg(body: string): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** A control of its own in the toolbar (the text style `<select>`). */
export interface ToolbarControl {
  readonly element: HTMLElement;
  /** Shows the selection's state; called after every transaction, focus and blur. */
  refresh(): void;
  dispose?(): void;
}

/**
 * A place for toolbar items: a group of buttons in the toolbar row, a menu
 * button there ("Insert ▾", its icon following the selection), or a bar
 * floating in the text above its anchor. The row is sorted by `order`; of the
 * floating bars, only the first (by `order`) with an anchor shows. The host's
 * own: `history` (for undo and redo, order 10), `text-style` (the text style menu, 20;
 * see `TextStyle`), the `insert` menu ("Insert", 50), the `selection` bar
 * (above a text selection, 10) and the `paste` bar (the "Paste as" chip above
 * a paste's end, 1). A menu without items is left out.
 */
export type ToolbarGroup =
  | { readonly kind: 'group'; readonly id: string; readonly order: number }
  | {
      readonly kind: 'menu';
      readonly id: string;
      /** Its place in the row, or among the items of its `bar`. */
      readonly order: number;
      readonly label: string;
      icon(editor: Editor): string;
      /** The floating bar it is in (`selection`); none: the toolbar row. */
      readonly bar?: string;
    }
  | {
      readonly kind: 'floating';
      readonly id: string;
      readonly order: number;
      readonly label: string;
      /** Where the bar floats (null: hidden); `held` when an item asks to show it (see `ToolbarAction.showsBar`). */
      anchor(editor: Editor, held: boolean): Anchor;
    };

/**
 * An entry of the toolbar's text style menu: a block style (a heading level, a custom block style) the menu shows as
 * its value where the selection has it, or a `toggle` on the selection's text (an inline style). The menu lists its
 * entries by `order`, those of one `section` together under its title. The host's own first entry, "Normal text",
 * takes off the selection's style (the first active entry's `remove`) and makes its blocks paragraphs.
 */
export interface TextStyle {
  /** The entry's id, unique in the menu (`heading-1`, `block:note`). */
  readonly id: string;
  readonly label: string;
  /** The title of the menu section it is listed in (`Block styles`); none: in the menu itself. */
  readonly section?: string;
  /** Where it is listed (default 0; then as provided). */
  readonly order?: number;
  /** The command; also decides, dry-run, whether the entry is enabled. An entry that only asks (New style…) applies nothing. */
  apply(chain: ChainedCommands, editor: Editor): ChainedCommands;
  /** Whether the entry is enabled, instead of the dry run of `apply`. */
  enabled?(editor: Editor): boolean;
  /** Whether the selection has it: the menu's value (the first active entry), or for a toggle a ✓. */
  isActive?(editor: Editor): boolean;
  /** Applied on top of the block's style (an inline style): marked ✓ where on, never the menu's value. */
  readonly toggle?: boolean;
  /** Takes it off the selection, where it is active (a block style: its blocks lifted out); for Normal text. */
  remove?(chain: ChainedCommands): ChainedCommands;
  /** After it was applied (importing a style where it is now used; New style…: asking for one). */
  applied?(): void;
  /** Other words it is found by where entries are searched (the slash commands): `['h1']` for Heading 1. */
  readonly keywords?: readonly string[];
}

/** The text style menu's entries of one editor; the menu asks again whenever `onDidChangeTextStyles` fires. */
export interface TextStyleProvider {
  provideTextStyles(editor: VisualEditorContext): readonly TextStyle[];
  readonly onDidChangeTextStyles?: Event<void>;
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

/** What a completion item provider is asked with: the editor, its Tiptap editor and what its toolbar offers. */
export interface CompletionContext extends VisualEditorContext {
  readonly editor: Editor;
  /** What is typed after the trigger character (the list filters the items by it). */
  readonly query: string;
  /** The entries of toolbar group or menu `group` of this editor (the Insert menu: `insert`), sorted as shown. */
  toolbarActions(group: string): readonly ToolbarAction[];
  /** The text style menu's entries of this editor, sorted as shown (without the host's "Normal text"). */
  textStyles(): readonly TextStyle[];
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
  command(props: { editor: Editor; range: Range }): void;
}

/** The items of one completion list; asked again on every keystroke while the list is open. */
export interface CompletionItemProvider {
  provideCompletionItems(context: CompletionContext): readonly CompletionItem[];
}

/** Where a floating bar points: a viewport rectangle (e.g. a selection's or a table's), or nothing (hidden). */
export type Anchor = { top: number; left: number; right: number } | null;

/** What an item created per editor gets: the editor, its Tiptap editor, the toolbar. */
export interface ToolbarContext extends VisualEditorContext {
  readonly editor: Editor;
  /** The toolbar row's element (popovers of menu items go in here). */
  readonly root: HTMLElement;
  /** Disposed with the toolbar: popovers, listeners, plugins an item adds. */
  readonly subscriptions: Disposable[];
}

/** A button (or control) in toolbar group `group`, sorted by `order` (then registration order). */
export type ToolbarItem =
  | { readonly group: string; readonly order?: number; readonly action: ToolbarAction }
  | {
      readonly group: string;
      readonly order?: number;
      /** The item for one editor, when it keeps state there (a popover) or is a control of its own. */
      create(toolbar: ToolbarContext): ToolbarAction | ToolbarControl;
    }
  | {
      readonly group: string;
      readonly order?: number;
      /** In a menu: buttons that come and go while the editor lives (one per inline style), asked again as it shows and opens. */
      provideActions(toolbar: ToolbarContext): readonly ToolbarAction[];
    };

export { VisualEditor, insertTypst, VisualEditorHost } from './visual-editor-impl';
