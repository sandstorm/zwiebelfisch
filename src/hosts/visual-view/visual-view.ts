// VisualView: the WYSIWYG editing view, a Tiptap editor over the source-anchored projection of a TypstDocument;
// everything it shows beyond paragraphs and raw Typst is contributed through VisualViewContributions.
// Entry of hosts/visual-view/. See ARCHITECTURE.md, "VisualView".
import { Editor } from '@tiptap/core';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { Highlight, Presence, PresenceTarget, TypstDocument } from '../../core/typst-document/typst-document';
import type { Contributed, Gutter, VisualViewContext, VisualViewContributions } from './contributions/contributions';
import { highlights, setHighlights } from './highlights';
import { attachSpecs, editorExtensions, setBoxes } from './nodes/nodes';
import { onDidChangeGrammar, posToSource, print, project, sourceToPos, syncDoc } from './projection/projection';
import { Toolbar } from './toolbar/toolbar';

export {
  VisualViewContributions, setBoxDecorations, svg, type Action, type BoxPicture, type BoxRenderer, type BoxRendererProvider, type BoxCodeExtensionProvider,
  type BoxTools, type BoxToolsHost, type CodeBoxSpec, type ContributionContext, type EditorExtensionProvider, type Gutter, type HighlightProvider,
  type GutterProvider, type ToolbarContext, type ToolbarControl, type ToolbarGroup, type ToolbarItem, type TypstMarkSpec,
  type TypstNodeSpec, type VisualViewContext, type VisualViewContribution,
} from './contributions/contributions';
// the toolkit specs' projectors and printers use (see projection/grammar.ts)
export {
  children, decodeString, isClosedContent, isEmbeddable, parenthesized, posToSource, print, quote, sourceToPos, type Around, type BlockCallProjector, type BlockLabel,
  type BlockPrinter, type BlockSyntaxProjector, type Call, type InlineCallProjector, type InlineProjector, type Placed, type Printer,
  type ProjectionContext, type RunProjector,
} from './projection/projection';
// the projection framework itself, for tests of the specs: project a source, sync (print and the position maps are above)
export { project, syncDoc } from './projection/projection';
export { starterKitPart } from './nodes/nodes';
// source offsets ↔ positions in a view's document, and the decorations that draw a source range (other users' places)
export { nodeGrammar } from './projection/projection';
export { rangeDecorations } from './highlights';

/** Marks transactions that mirror a document change, so they are not written back. */
const FROM_DOCUMENT = 'typst-from-document';

/**
 * The Word-like editing view (Tiptap/ProseMirror) with its formatting
 * toolbar, a projection of a TypstDocument.
 *
 * Visual edits become one minimal text change on the document; document
 * changes from elsewhere are re-projected and applied as the smallest
 * replacement, so the cursor stays where it was. Unmodelled Typst shows as
 * raw boxes and is never rewritten. What the view models, shows and offers
 * beyond that (headings, tables, labels, comments, …) comes from
 * `contributions`, as registered when the view is created.
 */
export class VisualView implements PresenceTarget {
  /** The text and the gutters beside it, below the toolbar: what scrolls as the document's content. */
  readonly content: HTMLElement;
  private readonly editor: Editor;
  private readonly toolbar: Toolbar;
  private readonly gutters: Gutter[];
  private readonly selectionChanged = new EventEmitter<void>();
  private readonly presence = new EventEmitter<readonly Presence[]>();
  /** After the selection moved or the text changed; `selection()` already returns the new selection. */
  readonly onDidChangeSelection: Event<void> = this.selectionChanged.event;
  private readonly subscriptions: Disposable[];

  constructor(parent: HTMLElement, private readonly document: TypstDocument, contributions: VisualViewContributions) {
    const contributed = contributions.contributed();
    const view: VisualViewContext = { document, selection: () => this.selection(), onDidChangePresence: this.presence.event };
    // the text and, right of it, the gutters
    const body = parent.appendChild(parent.ownerDocument.createElement('div'));
    body.className = 'typst-visual__body';
    this.content = body;
    this.editor = new Editor({
      element: body,
      extensions: [
        ...editorExtensions(contributed.nodes, contributed.marks),
        highlights,
        ...contributed.editorExtensions.flatMap((provider) => provider(view)),
      ],
      injectCSS: false,
      editorProps: { attributes: { class: 'typst-visual', 'data-testid': 'typst-visual' } },
      onTransaction: ({ transaction }) => {
        this.afterTransaction(transaction);
        if (transaction.selectionSet || transaction.docChanged) this.selectionChanged.fire();
      },
    });
    const { schema } = this.editor;
    attachSpecs(schema, contributed.nodes, contributed.marks);
    setBoxes(this.editor, boxes(view, contributed));
    this.gutters = contributed.gutters.map((provider) => provider(view, body));
    // Load the projection itself (not a JSON copy): its node identities are what marks blocks as untouched.
    this.editor.view.updateState(
      EditorState.create({
        schema,
        doc: project(document.text, schema),
        plugins: [...this.editor.state.plugins, ...this.gutters.flatMap((gutter) => (gutter.plugin ? [gutter.plugin] : []))],
      }),
    );
    this.toolbar = new Toolbar(parent, this.editor, view, { groups: contributed.toolbarGroups, items: contributed.toolbarItems });
    const unsubscribe = document.onChange((_changes, origin) => {
      if (origin !== this) this.syncFromDocument();
    });
    this.subscriptions = [
      new Disposable(unsubscribe),
      // e.g. a style declared or removed changes what its calls project to
      ...onDidChangeGrammar(schema, () => this.syncFromDocument()),
      ...contributed.highlights.map(({ layer, provider }) => {
        this.setHighlights(layer, provider.provideHighlights(document));
        return provider.onDidChangeHighlights((changed) => {
          if (changed === document) this.setHighlights(layer, provider.provideHighlights(document));
        });
      }),
    ];
  }

  /** Selects what shows source range `from`..`to` (a caret if empty) and scrolls to it. */
  reveal(from: number, to: number): void {
    const { doc } = this.editor.state;
    const anchor = sourceToPos(doc, from);
    const head = to > from ? Math.max(anchor, sourceToPos(doc, to, -1)) : anchor;
    const selection = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
    this.editor.view.dispatch(this.editor.state.tr.setSelection(selection).scrollIntoView());
    this.editor.view.focus();
  }

  /** Replaces the highlights of `layer` (source ranges); they follow edits until set again. */
  setHighlights(layer: string, ranges: readonly Highlight[]): void {
    this.editor.view.dispatch(setHighlights(this.editor.state.tr, layer, ranges));
  }

  /** Hands other users' carets and selections (source offsets) to the contributions that draw them (`onDidChangePresence`). */
  setPresence(presences: readonly Presence[]): void {
    this.presence.fire(presences);
  }

  /** Whether the user works in this view (it has focus). */
  focused(): boolean {
    return this.editor.view.hasFocus();
  }

  /**
   * The source range the selection shows: where it starts, and where the
   * last character (or box) it covers ends; `from === to` for a caret.
   */
  selection(): { from: number; to: number } {
    const { doc, selection } = this.editor.state;
    const from = posToSource(doc, selection.from);
    return { from, to: selection.empty ? from : Math.max(from, posToSource(doc, selection.to, -1)) };
  }

  destroy(): void {
    for (const subscription of [...this.subscriptions].reverse()) subscription.dispose();
    this.selectionChanged.dispose();
    this.presence.dispose();
    this.toolbar.destroy();
    this.editor.destroy();
    for (const gutter of this.gutters) gutter.destroy();
  }

  private afterTransaction(tr: Transaction): void {
    if (!tr.docChanged || tr.getMeta(FROM_DOCUMENT)) return;
    this.document.setText(print(this.editor.state.doc), this);
  }

  private syncFromDocument(): void {
    const { state } = this.editor;
    const tr = syncDoc(state.tr, project(this.document.text, state.schema));
    if (tr.docChanged) this.editor.view.dispatch(tr.setMeta(FROM_DOCUMENT, true).setMeta('addToHistory', false));
  }
}

/** What the raw boxes of `view` get from the contributions. */
function boxes(view: VisualViewContext, contributed: Contributed) {
  return {
    view,
    renderers: contributed.boxRenderers.map((provider) => provider(view)).filter((renderer) => renderer !== null),
    codeExtensions: contributed.boxCodeExtensions.map((provider) => provider(view)),
    specs: new Map(contributed.nodes.flatMap((spec) => (spec.codeBox ? [[spec.name, spec.codeBox] as const] : []))),
  };
}
