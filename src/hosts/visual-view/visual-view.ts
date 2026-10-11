// VisualView: the WYSIWYG editing view, a Tiptap editor over the source-anchored ProseMirror document of a TypstDocument;
// everything it shows beyond paragraphs and raw Typst is contributed through VisualViewContributions (kept by
// VisualViewHost).
// Entry of hosts/visual-view/. See docs/30_architecture/04_visual-view.typ.
import { Editor, type AnyExtension, type ChainedCommands, type Range } from '@tiptap/core';
import { StateEffect, type Extension } from '@codemirror/state';
import type { Node } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection, type Plugin, type Transaction } from '@tiptap/pm/state';
import type { Decoration } from '@tiptap/pm/view';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { SourceOffset, SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import { attachGrammar, onDidChangeGrammar, posToSource, serializeToTypst, parseTypst, sourceToPos, applyTypstChanges, type DocumentNodeSpec, type TypstMarkSpec } from '../prosemirror-typst/prosemirror-typst';
import { highlights, setHighlights } from './highlights';
import { editorExtensions, nodeViewSpecs } from './nodes/node-views';
import type { RawBoxes } from './nodes/raw-box';
import { suggestions } from './suggestions/suggestions';
import { Toolbar } from './toolbar/toolbar';
import proseMirrorCss from './prosemirror.css?inline';
import css from './visual-view.css?inline';

/** Marks transactions that mirror a document change, so they are not written back. */
const FROM_DOCUMENT = 'typst-from-document';

/**
 * The view type of the Visual view's custom editor, for `workbench.open(path, { viewType })`,
 * `TextEditor.viewType` and the menu context key `activeCustomEditorId`.
 */
export const VISUAL_VIEW_TYPE = 'visualView.editor';

/**
 * The Word-like editing view (Tiptap/ProseMirror) with its formatting
 * toolbar, the parsed ProseMirror document of a TypstDocument.
 *
 * Visual edits become one minimal text change on the document; document
 * changes from elsewhere are parsed again and applied as the smallest
 * replacement, so the cursor stays where it was. Unmodelled Typst shows as
 * raw boxes and is never rewritten. What the view models, shows and offers
 * beyond that (headings, tables, labels, comments, …) comes from
 * `contributions`, as registered when the view is created.
 */
export class VisualView {
  /** The text and the gutters beside it, below the toolbar: what scrolls as the document's content. */
  readonly content: HTMLElement;
  private readonly editor: Editor;
  private readonly toolbar: Toolbar;
  private readonly gutters: Gutter[];
  private readonly selectionChanged = new EventEmitter<void>();
  /** After the selection moved or the text changed; `selection()` already returns the new selection. */
  readonly onDidChangeSelection: Event<void> = this.selectionChanged.event;
  private readonly subscriptions: Disposable[];

  constructor(parent: HTMLElement, private readonly document: TypstDocument, contributions: VisualViewHost) {
    const contributed = contributions.contributed();
    const views = nodeViewSpecs(contributed.nodes);
    // block atoms, and inline atoms shown as a box of their own (raw inline Typst, a margin note)
    const isBox = (node: Node) => node.isAtom && (node.isBlock || views.get(node.type.name)?.box !== undefined);
    const view: VisualViewContext = { document, selection: () => this.selection(), sourceToPos, posToSource, isBox };
    // the text and, right of it, the gutters
    const body = parent.appendChild(parent.ownerDocument.createElement('div'));
    body.className = 'typst-visual__body';
    this.content = body;
    this.editor = new Editor({
      element: body,
      extensions: [
        ...editorExtensions(contributed.nodes, contributed.marks, boxes(view, contributed, views)),
        highlights,
        suggestions(contributed.completionItemProviders, (editor, query) => ({
          ...view,
          editor,
          query,
          toolbarActions: (group) => this.toolbar.actions(group),
          textStyles: () => this.toolbar.textStyles(),
        })),
        ...contributed.tiptapExtensions.flatMap((provider) => provider(view)),
      ],
      injectCSS: false,
      editorProps: { attributes: { class: 'typst-visual', 'data-testid': 'typst-visual' } },
      onTransaction: ({ transaction }) => {
        this.afterTransaction(transaction);
        if (transaction.selectionSet || transaction.docChanged) this.selectionChanged.fire();
      },
    });
    const { schema } = this.editor;
    attachGrammar(schema, contributed.nodes, contributed.marks);
    this.gutters = contributed.gutters.map((provider) => provider(view, body));
    // Load the parsed document itself (not a JSON copy): its node identities are what marks blocks as untouched.
    this.editor.view.updateState(
      EditorState.create({
        schema,
        doc: parseTypst(document.text, schema),
        plugins: [...this.editor.state.plugins, ...this.gutters.flatMap((gutter) => (gutter.plugin ? [gutter.plugin] : []))],
      }),
    );
    this.toolbar = new Toolbar(parent, this.editor, view, { groups: contributed.toolbarGroups, items: contributed.toolbarItems, textStyles: contributed.textStyles });
    this.subscriptions = [
      document.onDidChange(({ origin }) => {
        if (origin !== this) this.syncFromDocument();
      }),
      // e.g. a style declared or removed changes what its calls project to
      onDidChangeGrammar(schema, () => this.syncFromDocument()),
      ...contributed.highlights.map(({ layer, provider }) => {
        this.setHighlights(layer, provider.provideHighlights(document));
        return provider.onDidChangeHighlights((changed) => {
          if (changed === document) this.setHighlights(layer, provider.provideHighlights(document));
        });
      }),
    ];
  }

  /** Selects what shows source range `range` (a caret if empty) and scrolls to it. */
  reveal({ from, to }: SourceRange): void {
    const { doc } = this.editor.state;
    const anchor = sourceToPos(doc, from);
    const head = to > from ? Math.max(anchor, sourceToPos(doc, to, -1)) : anchor;
    const selection = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
    this.editor.view.dispatch(this.editor.state.tr.setSelection(selection).scrollIntoView());
    this.editor.view.focus();
  }

  /**
   * The source range the selection shows: where it starts, and where the
   * last character (or box) it covers ends; `from === to` for a caret.
   */
  selection(): SourceRange {
    const { doc, selection } = this.editor.state;
    const from = posToSource(doc, selection.from);
    const end = posToSource(doc, selection.to, -1);
    return { from, to: selection.empty || end < from ? from : end };
  }

  dispose(): void {
    for (const subscription of [...this.subscriptions].reverse()) subscription.dispose();
    this.selectionChanged.dispose();
    this.toolbar.dispose();
    this.editor.destroy();
    for (const gutter of this.gutters) gutter.dispose();
  }

  /** Replaces the highlights of `layer` (source ranges); they follow edits until set again. */
  private setHighlights(layer: string, ranges: readonly SourceHighlight[]): void {
    this.editor.view.dispatch(setHighlights(this.editor.state.tr, layer, ranges));
  }

  private afterTransaction(tr: Transaction): void {
    if (!tr.docChanged || tr.getMeta(FROM_DOCUMENT)) return;
    this.document.setText(serializeToTypst(this.editor.state.doc), this);
  }

  private syncFromDocument(): void {
    const { state } = this.editor;
    const tr = applyTypstChanges(state.tr, parseTypst(this.document.text, state.schema));
    if (tr.docChanged) this.editor.view.dispatch(tr.setMeta(FROM_DOCUMENT, true).setMeta('addToHistory', false));
  }
}

/**
 * Inserts the blocks Typst `source` is read as in a view's `editor` (as the view reads any Typst: a figure of an
 * image is a figure, what no spec models a raw box) next to the selection: after the selected block, or after the
 * paragraph or heading holding the cursor; an empty paragraph is taken over. Nothing is split or replaced; the
 * editor keeps the focus. For an Insert entry whose result is easier written as Typst than built as nodes.
 */
export function insertTypstBlocks(editor: Editor, source: string): void {
  const { selection, schema } = editor.state;
  const blocks = parseTypst(source, schema).content;
  const $to = selection.$to;
  let target = { from: selection.to, to: selection.to };
  if (!(selection instanceof NodeSelection && selection.node.isBlock) && $to.parent.isTextblock && $to.depth > 0) {
    const after = $to.after();
    target = $to.parent.content.size === 0 ? { from: $to.before(), to: after } : { from: after, to: after };
  }
  editor.chain().focus().insertContentAt(target, blocks).run();
}

/** What the raw boxes of `view` get from the contributions. */
function boxes(view: VisualViewContext, contributed: Contributed, views: RawBoxes['views']): RawBoxes {
  return {
    view,
    renderers: contributed.rawBoxRenderers.map((provider) => provider(view)).filter((renderer) => renderer !== null),
    codeExtensions: contributed.rawBoxCodeMirrorExtensions.map((provider) => provider(view)),
    actions: contributed.rawBoxActions,
    views,
  };
}

// The contribution points: what extensions register, and what they are given.

/**
 * A Typst construct the Visual view models as a node, its fields grouped by whose concept they are: `tiptap`, the
 * Tiptap extension defining the node type (`Node.create(..)`: schema, attributes, node view, commands, keymap,
 * priority; given to Tiptap untouched); `typst`, how it is read from Typst and written back (`TypstNodeConversion`);
 * `view`, what the Visual view host does for its nodes.
 */
export interface TypstNodeSpec extends DocumentNodeSpec {
  readonly view?: {
    /** Shown as a box a remote caret inside outlines: `code` edits its `src` in a nested code editor (the host's raw box). */
    readonly box?: 'code' | 'widget';
    /** For `box: 'code'`: a heading above the code saying what the box shows (an outline: "Table of contents"); `className` goes on the box. */
    readonly title?: { readonly className: string; text(src: string): string };
    /** For `box: 'code'`: tools on every box of this type (an image's resize handles and toolbar). */
    tools?(host: RawBoxToolsHost, node: Node): RawBoxTools;
    /** Keeps its DOM (and what is inside) while a new version renders the same, as after every outside edit its `src` changes. */
    readonly keepsDom?: boolean;
    /**
     * Its DOM draws with `::before` / `::after` of its own (a page break's dashed lines). The host marks such nodes'
     * DOM `data-typst-pseudo="own"`, so what others draw on boxes (another user's name flag) leaves them alone.
     */
    readonly ownsPseudoElements?: boolean;
  };
}

/** A column beside the text (the notes gutter), made for one view. */
export interface Gutter {
  /** Added to the view's editor state. */
  readonly plugin?: Plugin;
  dispose(): void;
}

/** Makes a view's gutter in `body`, the element holding the text (`.typst-visual__body`). */
export type GutterProvider = (view: VisualViewContext, body: HTMLElement) => Gutter;

/**
 * A styled stretch of the source (UTF-16 offsets) that the Visual view draws
 * over its text, e.g. another user's selection or a diagnostic. `attributes`
 * are set on the marked DOM (e.g. a style with the user's color). Views follow
 * edits with their highlights until the owner sets them again.
 */
export interface SourceHighlight extends SourceRange {
  className: string;
  attributes?: Record<string, string>;
}

/** Styled source ranges of each document (diagnostics), kept up to date in its Visual views. */
export interface SourceHighlightProvider {
  /** The highlights of `document` now (source offsets in its current text). */
  provideHighlights(document: TypstDocument): readonly SourceHighlight[];
  /** Fires with a document whose highlights changed. */
  readonly onDidChangeHighlights: Event<TypstDocument>;
}

/** What a contribution's `activate` gets: a part of the extension context (which offers more). */
export interface ContributionContext {
  readonly visualView: VisualViewContributions;
  /** Disposed when the contribution is deactivated, in reverse order. */
  readonly subscriptions: { dispose(): unknown }[];
}

/**
 * A construct or feature contributing to the Visual view: `activate` registers
 * its parts and pushes each registration's Disposable to `subscriptions`.
 * Shaped like an extension (`TypstExtension`): a construct without
 * configuration is one, in the widget's list of built-in extensions; a
 * feature's extension activates the contributions it configures.
 */
export interface VisualViewContribution {
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

/** The default `priority` (Tiptap's). */
const DEFAULT_PRIORITY = 100;

/**
 * Everything registered: box renderers by priority (see `PriorityOptions`), the rest in registration order. What the
 * host applies to each view it creates.
 */
export interface Contributed {
  readonly nodes: readonly TypstNodeSpec[];
  readonly marks: readonly TypstMarkSpec[];
  readonly tiptapExtensions: readonly ((view: VisualViewContext) => AnyExtension | readonly AnyExtension[])[];
  readonly toolbarGroups: readonly ToolbarGroup[];
  readonly toolbarItems: readonly ToolbarItem[];
  readonly gutters: readonly GutterProvider[];
  readonly highlights: readonly { readonly layer: string; readonly provider: SourceHighlightProvider }[];
  readonly rawBoxRenderers: readonly RawBoxRendererProvider[];
  readonly rawBoxCodeMirrorExtensions: readonly ((view: VisualViewContext) => Extension)[];
  readonly rawBoxActions: readonly RawBoxAction[];
  readonly textStyles: readonly TextStyleProvider[];
  readonly completionItemProviders: readonly { readonly provider: CompletionItemProvider; readonly trigger: CompletionTrigger }[];
}

/**
 * The Visual view's contribution points (what `ExtensionContext.visualView` is). Contributions register once, at
 * activation; the host applies what is registered to every view it creates from then on (views are created lazily,
 * per document), so a contribution never tracks views. Everything a contribution needs per view (its document, a
 * popover) it gets through the `…Provider` functions. Disposing a registration takes it out of views created later.
 * Experimental: the shapes may still change.
 */
export interface VisualViewContributions {
  /**
   * A node type: its Tiptap extension, its Typst, what the view does for it (see `TypstNodeSpec`). The priority of
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
   * Tiptap extensions made for each view (they may use its document): decorations, plugins (drops, appended
   * transactions), commands not tied to a node. Their hooks see the view's editor (`this.editor`).
   */
  registerTiptapExtension(provider: (view: VisualViewContext) => AnyExtension | readonly AnyExtension[]): Disposable;
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
  /** A column beside the text, made for each view. */
  registerGutter(provider: GutterProvider): Disposable;
  /**
   * Highlights from `provider` in every view, as layer `layer` (one per provider): set when the view is created and
   * again whenever the provider reports a change of its document; they follow edits in between.
   */
  registerHighlights(layer: string, provider: SourceHighlightProvider): Disposable;
  /**
   * What raw boxes of each view show instead of their code while not edited. The renderers are asked by `priority`
   * (default 100, higher first; equal: registration order), and the first that `renders` a box draws it: the image
   * renderer (110) draws image boxes, compiled snippets (100) the rest.
   */
  registerRawBoxRenderer(provider: RawBoxRendererProvider, options?: PriorityOptions): Disposable;
  /** CodeMirror extensions for the code of every raw box of each view (e.g. links on file paths). */
  registerRawBoxCodeMirrorExtension(provider: (view: VisualViewContext) => Extension): Disposable;
  /**
   * A button on every raw box `action.when` holds for (any box: a contribution need not own the box's node type),
   * in registration order: with the box's tools (an image box's toolbar), else above its code.
   */
  registerRawBoxAction(action: RawBoxAction): Disposable;
}

/**
 * Keeps what is registered through `VisualViewContributions` and hands it to each view it creates (`contributed`).
 * The workbench host has one; tests make their own (`from`).
 */
export class VisualViewHost implements VisualViewContributions {
  private readonly rawBoxRenderers: Ranked<RawBoxRendererProvider>[] = [];
  private readonly lists = {
    nodes: [] as TypstNodeSpec[],
    marks: [] as TypstMarkSpec[],
    tiptapExtensions: [] as ((view: VisualViewContext) => AnyExtension | readonly AnyExtension[])[],
    toolbarGroups: [] as ToolbarGroup[],
    toolbarItems: [] as ToolbarItem[],
    gutters: [] as GutterProvider[],
    highlights: [] as { layer: string; provider: SourceHighlightProvider }[],
    rawBoxCodeMirrorExtensions: [] as ((view: VisualViewContext) => Extension)[],
    rawBoxActions: [] as RawBoxAction[],
    textStyles: [] as TextStyleProvider[],
    completionItemProviders: [] as { provider: CompletionItemProvider; trigger: CompletionTrigger }[],
  };
  /** The CSS of the views (ProseMirror's own first), for the workbench to put where the widget renders. */
  readonly styleSheet: string = proseMirrorCss + css;

  /** A registry with `contributions` activated, for as long as it lives (for a view without the workbench, as in tests). */
  static from(contributions: readonly VisualViewContribution[]): VisualViewHost {
    const visualView = new VisualViewHost();
    const subscriptions: { dispose(): unknown }[] = [];
    for (const contribution of contributions) contribution.activate({ visualView, subscriptions });
    return visualView;
  }

  registerNode(spec: TypstNodeSpec): Disposable {
    return this.add(this.lists.nodes, spec);
  }

  registerMark(spec: TypstMarkSpec): Disposable {
    return this.add(this.lists.marks, spec);
  }

  registerTiptapExtension(provider: (view: VisualViewContext) => AnyExtension | readonly AnyExtension[]): Disposable {
    return this.add(this.lists.tiptapExtensions, provider);
  }

  registerToolbarGroup(group: ToolbarGroup): Disposable {
    return this.add(this.lists.toolbarGroups, group);
  }

  registerToolbarItem(item: ToolbarItem): Disposable {
    return this.add(this.lists.toolbarItems, item);
  }

  registerCompletionItemProvider(provider: CompletionItemProvider, trigger: CompletionTrigger): Disposable {
    return this.add(this.lists.completionItemProviders, { provider, trigger });
  }

  registerGutter(provider: GutterProvider): Disposable {
    return this.add(this.lists.gutters, provider);
  }

  registerHighlights(layer: string, provider: SourceHighlightProvider): Disposable {
    return this.add(this.lists.highlights, { layer, provider });
  }

  registerRawBoxRenderer(provider: RawBoxRendererProvider, options: PriorityOptions = {}): Disposable {
    return this.add(this.rawBoxRenderers, { value: provider, priority: options.priority ?? DEFAULT_PRIORITY });
  }

  registerRawBoxCodeMirrorExtension(provider: (view: VisualViewContext) => Extension): Disposable {
    return this.add(this.lists.rawBoxCodeMirrorExtensions, provider);
  }

  registerRawBoxAction(action: RawBoxAction): Disposable {
    return this.add(this.lists.rawBoxActions, action);
  }

  registerTextStyleProvider(provider: TextStyleProvider): Disposable {
    return this.add(this.lists.textStyles, provider);
  }

  /** Everything registered now (for the host, when it creates a view). */
  contributed(): Contributed {
    const lists = this.lists;
    return {
      nodes: [...lists.nodes],
      marks: [...lists.marks],
      tiptapExtensions: [...lists.tiptapExtensions],
      toolbarGroups: [...lists.toolbarGroups],
      toolbarItems: [...lists.toolbarItems],
      gutters: [...lists.gutters],
      highlights: [...lists.highlights],
      rawBoxRenderers: [...this.rawBoxRenderers].sort((a, b) => b.priority - a.priority).map((entry) => entry.value),
      rawBoxCodeMirrorExtensions: [...lists.rawBoxCodeMirrorExtensions],
      rawBoxActions: [...lists.rawBoxActions],
      textStyles: [...lists.textStyles],
      completionItemProviders: [...lists.completionItemProviders],
    };
  }

  private add<T>(list: T[], value: T): Disposable {
    list.push(value);
    return new Disposable(() => {
      const index = list.indexOf(value);
      if (index >= 0) list.splice(index, 1);
    });
  }
}

/** A registered value and its priority (the sort by it is stable: equal priorities stay in registration order). */
interface Ranked<T> {
  readonly value: T;
  readonly priority: number;
}

/** One Visual view, as contributions made for it see it (see the `…Provider` types). */
export interface VisualViewContext {
  /** The document the view shows. */
  readonly document: TypstDocument;
  /** The source range the view's selection shows (see `VisualView.selection`). */
  selection(): SourceRange;
  /**
   * The position in `doc` (the view's document node, e.g. a transaction's) that shows source offset `offset`: with
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

/** The renderer of one view's boxes (null: none for this view). */
export type RawBoxRendererProvider = (view: VisualViewContext) => RawBoxRenderer | null;

/**
 * The decorations the Visual view gives a raw box's node (e.g. one marking another user's caret inside the box),
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
  readonly editor: Editor;
  /** The view the box is in. */
  readonly view: VisualViewContext;
  /** The box's document position, while it is in the document. */
  getPos(): number | undefined;
  /** Shows and focuses the code. */
  editCode(): void;
  /**
   * The box's action buttons (`registerRawBoxAction`), kept up to date by the host: the tools put the element where
   * they show their buttons (else the box shows it above the code).
   */
  readonly actions: HTMLElement;
}

/** Tools on a code box (an image's resize handles and toolbar); a click on the picture then selects the box. */
export interface RawBoxTools {
  /** The box's node changed. */
  update(node: Node): void;
  /** The box was selected. */
  select(): void;
  dispose(): void;
}

/**
 * A button any contribution adds to the raw boxes it applies to (an image box of a diagram: "Edit diagram"), shown
 * with the box's tools (an image box's toolbar), or above the code of a box without tools.
 */
export interface RawBoxAction {
  /** The button's text. */
  readonly title: string;
  /** Whether the box of `node` (its Typst: `node.attrs.src`) in `view` offers it; asked whenever the node changes. Default: every box. */
  when?(node: Node, view: VisualViewContext): boolean;
  /** Runs it for the box of `node` (the box's node now). */
  run(node: Node, view: VisualViewContext): void;
}

// The toolbar: buttons (actions), controls, groups, menus and floating bars.

/** A toolbar button: how it looks, what it does, and when it shows as on. */
export interface ToolbarAction {
  label: string;
  /** Shortcut shown in the tooltip; `Mod` becomes ⌘ or Ctrl. */
  shortcut?: string;
  icon: string;
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
 * own: `history` (undo/redo, order 10), `text-style` (the text style menu, 20;
 * see `TextStyle`), the `insert` menu ("Insert", 50) and the `selection` bar
 * (above a text selection, 10).
 */
export type ToolbarGroup =
  | { readonly kind: 'group'; readonly id: string; readonly order: number }
  | { readonly kind: 'menu'; readonly id: string; readonly order: number; readonly label: string; icon(editor: Editor): string }
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

/** The text style menu's entries of one view; the menu asks again whenever `onDidChangeTextStyles` fires. */
export interface TextStyleProvider {
  provideTextStyles(view: VisualViewContext): readonly TextStyle[];
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

/** What a completion item provider is asked with: the view, its editor and what its toolbar offers. */
export interface CompletionContext extends VisualViewContext {
  readonly editor: Editor;
  /** What is typed after the trigger character (the list filters the items by it). */
  readonly query: string;
  /** The entries of toolbar group or menu `group` of this view (the Insert menu: `insert`), sorted as shown. */
  toolbarActions(group: string): readonly ToolbarAction[];
  /** The text style menu's entries of this view, sorted as shown (without the host's "Normal text"). */
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

/** What an item created per view gets: the view, its editor, the toolbar. */
export interface ToolbarContext extends VisualViewContext {
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
      /** The item for one view, when it keeps state there (a popover) or is a control of its own. */
      create(toolbar: ToolbarContext): ToolbarAction | ToolbarControl;
    };
