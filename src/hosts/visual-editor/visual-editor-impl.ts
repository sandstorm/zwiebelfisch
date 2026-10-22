// See VisualEditorContributions in visual-editor.ts.
import { Editor } from '@tiptap/core';
import type { Extension } from '@codemirror/state';
import type { Node } from '@tiptap/pm/model';
import { EditorState, type Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import { SourceOffset, type SourceRange, type TextChange, type TypstDocument } from '../../core/typst-document/typst-document';
import { attachGrammar, onDidChangeGrammar, posToSource, parseTypst, sourceToPos, applyTypstChanges, typstChanges, type TypstMarkSpec } from './typst-conversion/typst-conversion';
import { applyChanges, insertTypst } from './visual-editor-helpers';
import { hasHighlights, highlights, setHighlights } from './highlights';
import { editorExtensions, nodeViewSpecs } from './nodes/node-views';
import type { RawBoxes } from './nodes/raw-box';
import { suggestions } from './suggestions/suggestions';
import { Toolbar, type ToolbarMenus } from './toolbar/toolbar';
import proseMirrorCss from './prosemirror.css?inline';
import css from './visual-editor.css?inline';
import type { VisualEditorContributions, TypstNodeSpec, SourceHighlight, SourceHighlightProvider, VisualEditorContext, RawBoxRendererProvider, RawBoxContext, RawBoxBehavior, CompletionTrigger, CompletionItemProvider, Submenu, FloatingBar } from './visual-editor';

/**
 * The Visual editor: a word-processor view of one Typst file, a Tiptap editor with a formatting toolbar. The
 * widget's `DocumentEditors` makes it, as one of the two editors for `*.typ`.
 *
 * A visual edit becomes one minimal text change on its `TypstDocument`. A change from elsewhere is applied as the
 * smallest replacement, so the cursor stays where it was. Typst that no node spec turns into a visual element
 * shows as a raw box: its source code, edited as code and never rewritten, or shown as a picture.
 *
 * Every construct beyond paragraphs, text and raw boxes (headings, tables, labels, comments, …) is contributed through
 * `VisualEditorHost`.
 */
export class VisualEditor {
  /** The text column below the toolbar (with what floats in it): what scrolls as the document's content. */
  readonly content: HTMLElement;
  private readonly tiptap: Editor;
  private readonly toolbar: Toolbar;
  private readonly selectionChanged = new EventEmitter<void>();
  /** After the selection moved or the text changed; `selection()` already returns the new selection. */
  readonly onDidChangeSelection: Event<void> = this.selectionChanged.event;
  private readonly subscriptions: Disposable[];
  /**
   * What `reveal` selected, while the selection is the one it made: `selection()` says that range, not what the
   * selection shows of it (the caret below a figure for its label, which no position in the text is), so who follows
   * the selection (the preview) goes where was asked.
   */
  private revealed: { selection: Selection; range: SourceRange } | null = null;

  constructor(parent: HTMLElement, private readonly document: TypstDocument, contributions: VisualEditorHost) {
    const contributed = contributions.contributed();
    const views = nodeViewSpecs(contributed.nodes);
    // block atoms, and inline atoms shown as a box of their own (raw inline Typst, a margin note)
    const isBox = (node: Node) => node.isAtom && (node.isBlock || views.get(node.type.name)?.box !== undefined);
    const editor: VisualEditorContext = { document, selection: () => this.selection(), isBox };
    // the text column: the text and what floats in it (bars, popovers), `position: relative`
    const body = parent.appendChild(parent.ownerDocument.createElement('div'));
    body.className = 'zwf-visual__body';
    this.content = body;
    this.tiptap = new Editor({
      element: body,
      extensions: [
        ...editorExtensions(contributed.nodes, contributed.marks, boxes(editor, contributed, views, contributions.rawBoxCodeMirrorExtensions(editor))),
        highlights,
        suggestions(contributed.completionItemProviders, (tiptap, query) => ({ ...editor, tiptap, query })),
        ...contributed.tiptapExtensions.flatMap((extension) => (typeof extension === 'function' ? extension(editor) : extension)),
      ],
      injectCSS: false,
      editorProps: { attributes: { class: 'zwf-visual', 'data-testid': 'zwf-visual' } },
      onTransaction: ({ transaction, appendedTransactions }) => {
        if (transaction.docChanged || !this.revealed?.selection.eq(transaction.selection)) this.revealed = null;
        this.afterTransaction(transaction, appendedTransactions);
        if (transaction.selectionSet || transaction.docChanged) this.selectionChanged.fire();
      },
    });
    const { schema } = this.tiptap;
    attachGrammar(schema, contributed.nodes, contributed.marks);
    // Load the parsed document itself (not a JSON copy): its node identities are what marks blocks as untouched.
    this.tiptap.view.updateState(
      EditorState.create({
        schema,
        doc: parseTypst(document.text, schema),
        plugins: this.tiptap.state.plugins,
      }),
    );
    this.toolbar = new Toolbar(parent, this.tiptap, {
      context: { ...editor, tiptap: this.tiptap },
      menus: contributions.menus,
      submenus: contributed.submenus,
      floatingBars: contributed.floatingBars,
    });
    this.subscriptions = [
      document.onDidChange(({ origin }) => {
        if (origin !== this) this.syncFromDocument();
      }),
      // e.g. a style declared or removed changes what its calls project to
      onDidChangeGrammar(schema, () => this.syncFromDocument()),
      // a layer per provider
      ...contributed.highlights.map((provider, index) => {
        const layer = String(index);
        this.setHighlights(layer, provider.provideHighlights(document));
        return provider.onDidChangeHighlights((changed) => {
          if (changed === document) this.setHighlights(layer, provider.provideHighlights(document));
        });
      }),
    ];
  }

  /**
   * Selects what shows source range `range` (a caret if empty) and scrolls to it. A range inside a raw box's code (not
   * the whole box) is selected in that code, which opens for it.
   */
  reveal({ from, to }: SourceRange): void {
    if (this.revealInBox(from, to)) return;
    const { doc } = this.tiptap.state;
    const anchor = sourceToPos(doc, from);
    const head = Math.max(anchor, sourceToPos(doc, to, -1));
    const selection = to > from ? TextSelection.between(doc.resolve(anchor), doc.resolve(head)) : this.caretAt(from);
    // focused first: ProseMirror scrolls to the DOM's selection, which it moves only while it has the focus
    this.tiptap.view.focus();
    const tr = this.tiptap.state.tr.setSelection(selection).scrollIntoView();
    this.revealed = { selection: tr.selection, range: { from, to } };
    this.tiptap.view.dispatch(tr);
  }

  /**
   * The caret at source offset `offset`: at the end of text ending there (a paragraph's before a code block, whose
   * caret beside it has the same offset); else what `createSelectionBetween` makes of a position there, innermost
   * first (the block-gaps extension's caret beside a box); else in the text nearest.
   */
  private caretAt(offset: SourceOffset): Selection {
    const { view } = this.tiptap;
    const { doc } = view.state;
    const textEnd = sourceToPos(doc, offset, -1);
    if (doc.resolve(textEnd).parent.inlineContent && posToSource(doc, textEnd) === offset) return TextSelection.create(doc, textEnd);
    const $at = doc.resolve(sourceToPos(doc, offset));
    for (let $pos = $at; ; $pos = doc.resolve($pos.before())) {
      const between = posToSource(doc, $pos.pos) === offset ? view.someProp('createSelectionBetween', (f) => f(view, $pos, $pos)) : null;
      if (between) return between;
      if ($pos.depth === 0 || $pos.parentOffset > 0) return TextSelection.between($at, $at);
    }
  }

  /** Inserts what Typst `source` is read as at the selection (`insertTypst`); focuses the editor. */
  insert(source: string): void {
    insertTypst(this.tiptap, source);
  }

  /** Applies `changes` of the source (its coordinates now) as one transaction: one undo step. */
  edit(changes: readonly TextChange[]): void {
    const { state } = this.tiptap;
    const tr = applyTypstChanges(state.tr, parseTypst(applyChanges(this.document.text, changes), state.schema));
    if (tr.docChanged) this.tiptap.view.dispatch(tr);
  }

  /**
   * The source range the selection shows: where it starts, and where the
   * last character (or box) it covers ends; `from === to` for a caret. After
   * `reveal`, until the selection moves or the text changes, the range revealed.
   */
  selection(): SourceRange {
    const { doc, selection } = this.tiptap.state;
    if (this.revealed?.selection.eq(selection)) return this.revealed.range;
    const from = posToSource(doc, selection.from);
    const end = posToSource(doc, selection.to, -1);
    return { from, to: selection.empty || end < from ? from : end };
  }

  dispose(): void {
    for (const subscription of [...this.subscriptions].reverse()) subscription.dispose();
    this.selectionChanged.dispose();
    this.toolbar.dispose();
    this.tiptap.destroy();
  }

  /** Opens the code of the raw box whose source holds `from..to` with that selected; whether there is one. */
  private revealInBox(from: SourceOffset, to: SourceOffset): boolean {
    const { doc } = this.tiptap.state;
    const pos = sourceToPos(doc, from);
    const src: unknown = doc.nodeAt(pos)?.attrs.src;
    if (typeof src !== 'string' || !doc.nodeAt(pos)!.isAtom) return false;
    const start = posToSource(doc, pos);
    // a caret at the box's start is before the box; the whole box is selected as one
    if (from < start || to > start + src.length || (from === start && (to === from || to === start + src.length))) return false;
    return this.tiptap.commands.editRawBox(pos, from - start, to - start);
  }

  /** Replaces the highlights of `layer` (source ranges); they follow edits until set again. */
  private setHighlights(layer: string, ranges: readonly SourceHighlight[]): void {
    // nothing drawn and nothing to draw (no errors after a compile, nobody else here): no transaction to react to
    if (ranges.length === 0 && !hasHighlights(this.tiptap.state, layer)) return;
    this.tiptap.view.dispatch(setHighlights(this.tiptap.state.tr, layer, ranges));
  }

  /** Writes what `tr` and the transactions plugins appended to it changed back to the text, block by block. */
  private afterTransaction(tr: Transaction, appended: readonly Transaction[]): void {
    if (tr.getMeta(FROM_DOCUMENT)) return;
    for (const each of [tr, ...appended]) {
      if (each.docChanged) this.document.change(typstChanges(each, this.document.text), this);
    }
  }

  private syncFromDocument(): void {
    const { state } = this.tiptap;
    const tr = applyTypstChanges(state.tr, parseTypst(this.document.text, state.schema));
    if (tr.docChanged) this.tiptap.view.dispatch(tr.setMeta(FROM_DOCUMENT, true).setMeta('addToHistory', false));
  }
}

/**
 * Keeps what is registered through `VisualEditorContributions` and hands it to each editor it creates (`contributed`).
 * The widget has one; tests make their own.
 */
export class VisualEditorHost implements VisualEditorContributions {
  private readonly rawBoxRenderers: Ranked<RawBoxRendererProvider>[] = [];
  private readonly lists = {
    nodes: [] as TypstNodeSpec[],
    marks: [] as TypstMarkSpec[],
    tiptapExtensions: [] as TiptapExtensions[],
    submenus: [] as Submenu[],
    floatingBars: [] as FloatingBar[],
    highlights: [] as SourceHighlightProvider[],
    rawBoxBehaviors: [] as ((box: RawBoxContext) => RawBoxBehavior | null)[],
    completionItemProviders: [] as { provider: CompletionItemProvider; trigger: CompletionTrigger }[],
  };
  /** The CSS of the editors (ProseMirror's own first), for the widget to put where the widget renders. */
  readonly styleSheet: string = proseMirrorCss + css;

  /** The toolbar's menus and their commands (the window's); default: none, an empty toolbar. */
  readonly menus: ToolbarMenus;

  /**
   * `rawBoxCodeMirrorExtensions`: those of the raw boxes' code in `editor` (the widget's: its CodeMirror
   * contributions); default: none. `menus`: see `menus`.
   */
  constructor(private readonly options: { rawBoxCodeMirrorExtensions?(editor: VisualEditorContext): Extension; menus?: ToolbarMenus } = {}) {
    this.menus = options.menus ?? NO_MENUS;
  }

  registerNode(spec: TypstNodeSpec): Disposable {
    return this.add(this.lists.nodes, spec);
  }

  registerMark(spec: TypstMarkSpec): Disposable {
    return this.add(this.lists.marks, spec);
  }

  registerTiptapExtension(extension: TiptapExtensions): Disposable {
    return this.add(this.lists.tiptapExtensions, extension);
  }

  registerSubmenu(submenu: Submenu): Disposable {
    return this.add(this.lists.submenus, submenu);
  }

  registerFloatingBar(bar: FloatingBar): Disposable {
    return this.add(this.lists.floatingBars, bar);
  }

  registerCompletionItemProvider(provider: CompletionItemProvider, trigger: CompletionTrigger): Disposable {
    return this.add(this.lists.completionItemProviders, { provider, trigger });
  }

  registerHighlightProvider(provider: SourceHighlightProvider): Disposable {
    return this.add(this.lists.highlights, provider);
  }

  registerRawBoxRenderer(provider: RawBoxRendererProvider, options: { readonly priority?: number } = {}): Disposable {
    return this.add(this.rawBoxRenderers, { value: provider, priority: options.priority ?? DEFAULT_PRIORITY });
  }

  registerRawBoxBehavior(provider: (box: RawBoxContext) => RawBoxBehavior | null): Disposable {
    return this.add(this.lists.rawBoxBehaviors, provider);
  }

  /** The CodeMirror extensions of the raw boxes' code in `editor` (see the constructor). */
  rawBoxCodeMirrorExtensions(editor: VisualEditorContext): Extension {
    return this.options.rawBoxCodeMirrorExtensions?.(editor) ?? [];
  }

  /** Everything registered now (for the host, when it creates an editor). */
  contributed(): Contributed {
    const lists = this.lists;
    return {
      nodes: [...lists.nodes],
      marks: [...lists.marks],
      tiptapExtensions: [...lists.tiptapExtensions],
      submenus: [...lists.submenus],
      floatingBars: [...lists.floatingBars],
      highlights: [...lists.highlights],
      rawBoxRenderers: [...this.rawBoxRenderers].sort((a, b) => b.priority - a.priority).map((entry) => entry.value),
      rawBoxBehaviors: [...lists.rawBoxBehaviors],
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

/** Everything registered: box renderers by priority, the rest in registration order. What the host applies to each editor it creates. */
export interface Contributed {
  readonly nodes: readonly TypstNodeSpec[];
  readonly marks: readonly TypstMarkSpec[];
  readonly tiptapExtensions: readonly TiptapExtensions[];
  readonly submenus: readonly Submenu[];
  readonly floatingBars: readonly FloatingBar[];
  readonly highlights: readonly SourceHighlightProvider[];
  readonly rawBoxRenderers: readonly RawBoxRendererProvider[];
  readonly rawBoxBehaviors: readonly ((box: RawBoxContext) => RawBoxBehavior | null)[];
  readonly completionItemProviders: readonly { readonly provider: CompletionItemProvider; readonly trigger: CompletionTrigger }[];
}

/** What `registerTiptapExtension` takes. */
type TiptapExtensions = Parameters<VisualEditorContributions['registerTiptapExtension']>[0];

/** What the raw boxes of `editor` get from the contributions. */
function boxes(editor: VisualEditorContext, contributed: Contributed, nodeViews: RawBoxes['nodeViews'], codeExtensions: Extension): RawBoxes {
  return {
    editor,
    renderers: contributed.rawBoxRenderers.map((provider) => provider(editor)).filter((renderer) => renderer !== null),
    codeExtensions,
    behaviors: contributed.rawBoxBehaviors,
    nodeViews,
  };
}

/** Without a window: no menu has entries. */
const NO_MENUS: ToolbarMenus = {
  getMenuItems: () => [],
  onDidChangeMenu: () => new Disposable(() => {}),
  executeCommand: (command) => Promise.reject(new Error(`No command ${command}`)),
  keybindingLabel: () => undefined,
};

/** Marks transactions that mirror a document change, so they are not written back. */
const FROM_DOCUMENT = 'zwf-from-document';

/** A registered value and its priority (the sort by it is stable: equal priorities stay in registration order). */
interface Ranked<T> {
  readonly value: T;
  readonly priority: number;
}

/** The default `priority` (Tiptap's). */
const DEFAULT_PRIORITY = 100;
