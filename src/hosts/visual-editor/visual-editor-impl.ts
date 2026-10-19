// See VisualEditorContributions in visual-editor.ts.
import { Editor, type AnyExtension } from '@tiptap/core';
import type { Extension } from '@codemirror/state';
import type { Node, ResolvedPos } from '@tiptap/pm/model';
import { EditorState, NodeSelection, type Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import { SourceOffset, type SourceRange, type TextChange, type TypstDocument } from '../../core/typst-document/typst-document';
import type { DocumentPasteEditProvider } from '../languages/languages';
import { attachGrammar, onDidChangeGrammar, posToSource, serializeToTypst, parseTypst, sourceToPos, applyTypstChanges, typstChanges, type TypstMarkSpec } from '../prosemirror-typst/prosemirror-typst';
import { BlockGaps, caretAtSource } from './block-gaps';
import { BlockHandle } from './block-handle';
import { clipboard } from './clipboard';
import { pasteChoice } from './paste-as';
import { typstPasteEdits } from './pasted-typst';
import { hasHighlights, highlights, setHighlights } from './highlights';
import { editorExtensions, nodeViewSpecs } from './nodes/node-views';
import type { RawBoxes } from './nodes/raw-box';
import { suggestions } from './suggestions/suggestions';
import { TabKeys } from './tab-keys';
import { textLinks } from './text-links';
import { Toolbar } from './toolbar/toolbar';
import proseMirrorCss from './prosemirror.css?inline';
import css from './visual-editor.css?inline';
import type { VisualEditorContributions, TypstNodeSpec, SourceHighlight, SourceHighlightProvider, VisualEditorContribution, PriorityOptions, Contributed, VisualEditorContext, RawBoxRendererProvider, VisualEditorLinks, VisualEditorPasteEdits, ToolbarGroup, TextStyleProvider, CompletionTrigger, CompletionItemProvider, ToolbarItem } from './visual-editor';

/**
 * The Visual editor: a word-processor view of one Typst file, a Tiptap editor with a formatting toolbar. The
 * workbench's `DocumentEditors` makes it, as one of the two editors for `*.typ`.
 *
 * A visual edit becomes one minimal text change on its `TypstDocument`. A change from elsewhere is applied as the
 * smallest replacement, so the cursor stays where it was. Typst nothing models shows as a raw box: edited as code,
 * never rewritten, or shown as a picture.
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
    const choice = pasteChoice(contributions.pasteEdits);
    const views = nodeViewSpecs(contributed.nodes);
    // block atoms, and inline atoms shown as a box of their own (raw inline Typst, a margin note)
    const isBox = (node: Node) => node.isAtom && (node.isBlock || views.get(node.type.name)?.box !== undefined);
    const editor: VisualEditorContext = { document, selection: () => this.selection(), sourceToPos, posToSource, isBox };
    // the text column: the text and what floats in it (bars, popovers), `position: relative`
    const body = parent.appendChild(parent.ownerDocument.createElement('div'));
    body.className = 'zwf-visual__body';
    this.content = body;
    this.tiptap = new Editor({
      element: body,
      extensions: [
        ...editorExtensions(contributed.nodes, contributed.marks, boxes(editor, contributed, views, contributions.links)),
        highlights,
        TabKeys,
        BlockHandle,
        BlockGaps,
        ...(contributions.links ? [textLinks(document, contributions.links, isBox)] : []),
        clipboard(document, contributions.pasteEdits),
        ...choice.extensions,
        suggestions(contributed.completionItemProviders, (tiptap, query) => ({
          ...editor,
          editor: tiptap,
          query,
          toolbarActions: (group) => this.toolbar.actions(group),
          textStyles: () => this.toolbar.textStyles(),
        })),
        ...contributed.tiptapExtensions.flatMap((provider) => provider(editor)),
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
    this.toolbar = new Toolbar(parent, this.tiptap, editor, { groups: [...contributed.toolbarGroups, ...choice.bars], items: [...contributed.toolbarItems, ...choice.items], textStyles: contributed.textStyles });
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

  /**
   * Selects what shows source range `range` (a caret if empty) and scrolls to it. A range inside a raw box's code (not
   * the whole box) is selected in that code, which opens for it.
   */
  reveal({ from, to }: SourceRange): void {
    if (this.revealInBox(from, to)) return;
    const { doc } = this.tiptap.state;
    const anchor = sourceToPos(doc, from);
    const head = Math.max(anchor, sourceToPos(doc, to, -1));
    // a caret: at the end of text ending there, in the gap whose source is there, else in the text nearest
    const selection = to > from ? TextSelection.between(doc.resolve(anchor), doc.resolve(head)) : caretAtSource(doc, from);
    // focused first: ProseMirror scrolls to the DOM's selection, which it moves only while it has the focus
    this.tiptap.view.focus();
    const tr = this.tiptap.state.tr.setSelection(selection).scrollIntoView();
    this.revealed = { selection: tr.selection, range: { from, to } };
    this.tiptap.view.dispatch(tr);
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
 * Inserts what Typst `source` is read as in the Tiptap `editor` (as the Visual editor reads any Typst: a figure of an
 * image is a figure, what no spec models a raw box), at the selection or at document position `at` (where something was
 * dropped). One paragraph's inline content (`*bold*`, `$x$`) goes into the text there, in place of the selection;
 * blocks go next to it: after the selected block, or after the paragraph or heading holding the position, an empty
 * paragraph taken over. Blocks never split or replace anything. `changes` of the editor's Typst (in its coordinates
 * before the insert, e.g. the import `source` needs) go into the same transaction, so one undo takes back both. The
 * editor gets the focus, the cursor after what was inserted. For an entry whose result is easier written as Typst than
 * built as nodes.
 */
export function insertTypst(editor: Editor, source: string, at?: number, changes: readonly TextChange[] = []): void {
  const { schema } = editor.state;
  const content = parseTypst(source, schema).content;
  const paragraph = content.childCount === 1 && content.firstChild!.type === schema.nodes.paragraph ? content.firstChild! : null;
  editor
    .chain()
    .focus()
    .command(({ tr, commands }) => {
      const { selection, doc } = tr;
      const $at = at === undefined ? selection.$to : doc.resolve(Math.min(at, doc.content.size));
      const inline = paragraph !== null && $at.parent.inlineContent;
      const range = insertionRange(at === undefined ? selection : null, $at, inline);
      const edge = posToSource(doc, range.from);
      const before = serializeToTypst(doc).length;
      if (!commands.insertContentAt(range, inline ? paragraph.content : content)) return false;
      if (changes.length === 0) return true;
      // the changes go in after the insert: a fresh parse of the text before it has no empty paragraph to take over
      const text = serializeToTypst(tr.doc);
      applyTypstChanges(tr, parseTypst(applyChanges(text, shiftedPast(changes, edge, text.length - before)), schema));
      return true;
    })
    .run();
}

/**
 * Where `insertTypst` puts inline content (`inline`): in place of `selection`, else (a position given) at `$at`; where
 * blocks: after the selected block, else beside the text block of `$at`.
 */
function insertionRange(selection: Selection | null, $at: ResolvedPos, inline: boolean): { from: number; to: number } {
  if (inline) return selection ? { from: selection.from, to: selection.to } : { from: $at.pos, to: $at.pos };
  return selection instanceof NodeSelection && selection.node.isBlock ? { from: $at.pos, to: $at.pos } : besideTextblock($at);
}

/** `changes` with those after source offset `edge` moved by `delta` (what an edit at `edge` added). */
function shiftedPast(changes: readonly TextChange[], edge: SourceOffset, delta: number): TextChange[] {
  return changes.map((change) => (change.to <= edge ? change : { ...change, from: SourceOffset.of(change.from + delta), to: SourceOffset.of(change.to + delta) }));
}

/** `text` with `changes` (in its coordinates, not overlapping) applied. */
function applyChanges(text: string, changes: readonly TextChange[]): string {
  return [...changes].sort((a, b) => b.from - a.from).reduce((current, { from, to, insert }) => current.slice(0, from) + insert + current.slice(to), text);
}

/** Where blocks go for `$pos`: after its textblock (instead of an empty one), else right there. */
function besideTextblock($pos: ResolvedPos): { from: number; to: number } {
  if (!$pos.parent.isTextblock || $pos.depth === 0) return { from: $pos.pos, to: $pos.pos };
  const after = $pos.after();
  return $pos.parent.content.size === 0 ? { from: $pos.before(), to: after } : { from: after, to: after };
}

/**
 * Keeps what is registered through `VisualEditorContributions` and hands it to each editor it creates (`contributed`),
 * with where its links lead (`links`; null: nowhere) and who takes part in copy and paste (`pasteEdits`; null: nobody).
 * The workbench has one; tests make their own (`from`).
 */
export class VisualEditorHost implements VisualEditorContributions {
  /** The editor's own paste edits of Typst (Typst, code, plain text), for the Source editors to offer the same. */
  readonly typstPasteEdits: DocumentPasteEditProvider = typstPasteEdits;
  private readonly rawBoxRenderers: Ranked<RawBoxRendererProvider>[] = [];
  private readonly lists = {
    nodes: [] as TypstNodeSpec[],
    marks: [] as TypstMarkSpec[],
    tiptapExtensions: [] as ((editor: VisualEditorContext) => AnyExtension | readonly AnyExtension[])[],
    toolbarGroups: [] as ToolbarGroup[],
    toolbarItems: [] as ToolbarItem[],
    highlights: [] as { layer: string; provider: SourceHighlightProvider }[],
    rawBoxCodeMirrorExtensions: [] as ((editor: VisualEditorContext) => Extension)[],
    textStyles: [] as TextStyleProvider[],
    completionItemProviders: [] as { provider: CompletionItemProvider; trigger: CompletionTrigger }[],
  };
  /** The CSS of the editors (ProseMirror's own first), for the workbench to put where the widget renders. */
  readonly styleSheet: string = proseMirrorCss + css;

  constructor(
    readonly links: VisualEditorLinks | null = null,
    readonly pasteEdits: VisualEditorPasteEdits | null = null,
  ) {}

  /** A registry with `contributions` activated, for as long as it lives (for an editor without the workbench, as in tests). */
  static from(contributions: readonly VisualEditorContribution[]): VisualEditorHost {
    const visualEditor = new VisualEditorHost();
    const subscriptions: { dispose(): unknown }[] = [];
    for (const contribution of contributions) contribution.activate({ visualEditor, subscriptions });
    return visualEditor;
  }

  registerNode(spec: TypstNodeSpec): Disposable {
    return this.add(this.lists.nodes, spec);
  }

  registerMark(spec: TypstMarkSpec): Disposable {
    return this.add(this.lists.marks, spec);
  }

  registerTiptapExtension(provider: (editor: VisualEditorContext) => AnyExtension | readonly AnyExtension[]): Disposable {
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

  registerHighlights(layer: string, provider: SourceHighlightProvider): Disposable {
    return this.add(this.lists.highlights, { layer, provider });
  }

  registerRawBoxRenderer(provider: RawBoxRendererProvider, options: PriorityOptions = {}): Disposable {
    return this.add(this.rawBoxRenderers, { value: provider, priority: options.priority ?? DEFAULT_PRIORITY });
  }

  registerRawBoxCodeMirrorExtension(provider: (editor: VisualEditorContext) => Extension): Disposable {
    return this.add(this.lists.rawBoxCodeMirrorExtensions, provider);
  }

  registerTextStyleProvider(provider: TextStyleProvider): Disposable {
    return this.add(this.lists.textStyles, provider);
  }

  /** Everything registered now (for the host, when it creates an editor). */
  contributed(): Contributed {
    const lists = this.lists;
    return {
      nodes: [...lists.nodes],
      marks: [...lists.marks],
      tiptapExtensions: [...lists.tiptapExtensions],
      toolbarGroups: [...lists.toolbarGroups],
      toolbarItems: [...lists.toolbarItems],
      highlights: [...lists.highlights],
      rawBoxRenderers: [...this.rawBoxRenderers].sort((a, b) => b.priority - a.priority).map((entry) => entry.value),
      rawBoxCodeMirrorExtensions: [...lists.rawBoxCodeMirrorExtensions],
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

/** What the raw boxes of `editor` get from the contributions. */
function boxes(editor: VisualEditorContext, contributed: Contributed, nodeViews: RawBoxes['nodeViews'], links: VisualEditorLinks | null): RawBoxes {
  return {
    editor,
    renderers: contributed.rawBoxRenderers.map((provider) => provider(editor)).filter((renderer) => renderer !== null),
    codeExtensions: contributed.rawBoxCodeMirrorExtensions.map((provider) => provider(editor)),
    linkOf: (src) => links?.linkOf(src, editor.document) ?? null,
    nodeViews,
  };
}

/** Marks transactions that mirror a document change, so they are not written back. */
const FROM_DOCUMENT = 'zwf-from-document';

/** A registered value and its priority (the sort by it is stable: equal priorities stay in registration order). */
interface Ranked<T> {
  readonly value: T;
  readonly priority: number;
}

/** The default `priority` (Tiptap's). */
const DEFAULT_PRIORITY = 100;
