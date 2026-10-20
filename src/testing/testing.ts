import { Editor } from '@tiptap/core';
import type { Node, Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { expect, vi } from 'vitest';
import { Disposable } from '../core/disposable/disposable';
import { EventEmitter } from '../core/event-emitter/event-emitter';
import { ProjectPath } from '../core/paths/paths';
import type { FileChange, FileContent, Project } from '../core/project/project';
import { SourceOffset, type TypstDocument } from '../core/typst-document/typst-document';
import { alignment } from '../extensions/alignment/alignment';
import { blockHandle as blockHandleExtension } from '../extensions/block-handle/block-handle';
import { clipboard } from '../extensions/clipboard/clipboard';
import { tabKeys } from '../extensions/tab-keys/tab-keys';
import { undoRedo } from '../extensions/undo-redo/undo-redo';
import { figures } from '../extensions/figures/figures';
import { headings } from '../extensions/headings/headings';
import { lists } from '../extensions/lists/lists';
import { markup } from '../extensions/markup/markup';
import { math } from '../extensions/math/math';
import { outline } from '../extensions/outline/outline';
import { pageLayout } from '../extensions/page-layout/page-layout';
import { tables } from '../extensions/tables/tables';
import { images } from '../extensions/images/images';
import { renderedBoxes } from '../extensions/rendered-boxes/rendered-boxes';
import type { Commands } from '../hosts/commands/commands';
import { LanguagesHost } from '../hosts/languages/languages';
import type { SourceEditorContributions } from '../hosts/source-editor/source-editor';
import type { PreviewContributions } from '../hosts/preview/preview';
import { VisualEditor, VisualEditorHost, type ContributionContext, type VisualEditorContribution, attachGrammar, createSchema, documentExtensions, posToSource, serializeToTypst, parseTypst as parseTypstWith, sourceToPos } from '../hosts/visual-editor/visual-editor';
import type { InputBoxOptions, MessageItem, QuickPickItem, QuickPickOptions, WindowApi } from '../hosts/window/window';
import type { Workbench } from '../hosts/workbench/workbench';
import type { Workspace } from '../hosts/workspace/workspace';

/**
 * The schema of a Visual editor with the built-ins configured from `options`.
 *
 * testing/ puts the built-in extensions together for an extension's tests that need the others (a figure holds a
 * table or an image). It offers this schema, a Visual editor with the built-ins activated in a test's extension
 * context, and helpers for a parsed document (apply an edit, find text, check the position map exhaustively).
 * Only `*.test.ts` files may import it.
 */
export function schemaWith(options: TestEditorOptions = {}): Schema {
  return schemaFrom(contributions(options));
}

/** The schema of a Visual editor with only `list` (built-in constructs or features), activated in that order. */
export function schemaOf(list: readonly VisualEditorContribution[]): Schema {
  return schemaFrom(activate(list));
}

function schemaFrom(registry: VisualEditorHost): Schema {
  const { nodes, marks } = registry.contributed();
  return createSchema(nodes, marks);
}

/** The path of the document a test editor shows, in the test's project. */
export const TEST_DOCUMENT_PATH = ProjectPath.of('/main.typ');

/**
 * What a test gives a Visual editor: the parts of the extension context the built-ins use (the project's files, the preview's
 * snippets, the document links, the window's prompts), and the contributions under test.
 */
export interface TestEditorOptions {
  /** The project's other files (images as bytes), by path; the editor's document is `TEST_DOCUMENT_PATH`. Default: none. */
  files?: Readonly<Record<string, FileContent>>;
  /** Applies a change (an uploaded image): resolves to why it was refused, or null. Default: the file is added. */
  applyEdit?(change: FileChange): Promise<string | null>;
  /** The preview's compiled snippets of the document (raw boxes show them; default: none) and when they change. */
  preview?: Partial<Pick<PreviewContributions, 'snippet' | 'onDidRender'>>;
  /** What the user answers when the editor asks (link URL, image, alt text, …); default: every question cancelled. */
  prompts?: TestPrompts;
  /** The contributions of the extension under test, activated after the built-ins (as the widget's features are). */
  contributions?: readonly VisualEditorContribution[];
}

/**
 * The window's input box, quick pick and messages in a test: each question takes the next of `answers` (an input
 * box the text, a quick pick the label of the item or its index; undefined cancels), and `asked` / `told` keep what
 * was asked and said.
 */
export class TestPrompts implements Pick<WindowApi, 'showInputBox' | 'showQuickPick' | 'showErrorMessage'> {
  readonly answers: (string | number | undefined)[] = [];
  readonly asked: { options?: InputBoxOptions | QuickPickOptions; items?: readonly (string | QuickPickItem)[] }[] = [];
  readonly told: string[] = [];

  /** Adds answers to the questions to come. */
  answer(...answers: (string | number | undefined)[]): this {
    this.answers.push(...answers);
    return this;
  }

  showInputBox = async (options?: InputBoxOptions): Promise<string | undefined> => {
    this.asked.push({ options });
    const answer = this.answers.shift();
    return answer === undefined ? undefined : String(answer);
  };

  showQuickPick = (async (items: readonly (string | QuickPickItem)[] | Promise<readonly (string | QuickPickItem)[]>, options?: QuickPickOptions) => {
    const list = await items;
    this.asked.push({ options, items: list });
    const answer = this.answers.shift();
    if (typeof answer === 'number') return list[answer];
    return list.find((item) => (typeof item === 'string' ? item : item.label) === answer);
  }) as WindowApi['showQuickPick'];

  showErrorMessage = async <T extends string | MessageItem>(message: string): Promise<T | undefined> => {
    this.told.push(message);
    return undefined;
  };
}

// after TestPrompts: making the schema activates the built-ins, which get prompts
/** The schema of a Visual editor with the built-ins. */
export const schema: Schema = schemaWith();

/** `source` parsed with `withSchema` (default: the built-ins' `schema`). */
export const parseTypst = (source: string, withSchema: Schema = schema): Node => parseTypstWith(source, withSchema);

/** A Visual editor of `document` with the built-ins configured from `options`. */
export function createVisualEditor(parent: HTMLElement, document: TypstDocument, options: TestEditorOptions = {}): VisualEditor {
  return new VisualEditor(parent, document, contributions(options));
}

/**
 * A Tiptap editor of `source` with the built-ins configured from `options` (their schema and commands, without the
 * Visual editor's node views and toolbar): for tests of a construct's commands. Needs a DOM (jsdom).
 */
export function createEditor(source: string, options: TestEditorOptions = {}): Editor {
  const { nodes, marks } = contributions(options).contributed();
  const editor = new Editor({ extensions: documentExtensions(nodes, marks), injectCSS: false });
  attachGrammar(editor.schema, nodes, marks);
  editor.view.updateState(EditorState.create({ schema: editor.schema, doc: parseTypstWith(source, editor.schema), plugins: editor.state.plugins }));
  return editor;
}

/** The built-ins and `options.contributions`, activated. */
function contributions(options: TestEditorOptions): VisualEditorHost {
  return activate([...builtins(), ...(options.contributions ?? [])], options);
}

/**
 * `contributions` activated in order, for their Visual-editor contributions, with an extension context made from
 * `options`: a project of `TEST_DOCUMENT_PATH` and `options.files`, a preview with `options.preview`'s snippets,
 * the window's `options.prompts` (default: every question cancelled) and `options.applyEdit`.
 * The languages are a real registry (the clipboard's paste edits take part in a paste); other registrations than the
 * Visual editor's (style sheets, commands, custom editors, search providers, Source editor extensions) are accepted
 * and ignored.
 */
function activate(contributions: readonly VisualEditorContribution[], options: TestEditorOptions = {}): VisualEditorHost {
  const visualEditor = new VisualEditorHost();
  const context = { visualEditor, subscriptions: [], ...testContext(options) };
  for (const contribution of contributions) contribution.activate(context as unknown as ContributionContext);
  return visualEditor;
}

/** The parts of an extension context the built-ins use, made from `options`. */
function testContext(options: TestEditorOptions) {
  const project = testProject(options);
  const prompts = options.prompts ?? new TestPrompts();
  const added = async (change: FileChange) => (change.kind === 'create' && project.add(change.path, change.content), null);
  return {
    project,
    workbench: { registerStyleSheet: ignored, open: () => {} } satisfies Partial<Workbench>,
    commands: { registerCommand: ignored } satisfies Partial<Commands>,
    window: {
      registerCustomEditorProvider: ignored,
      registerSearchProvider: ignored,
      showInputBox: prompts.showInputBox,
      showQuickPick: prompts.showQuickPick,
      showErrorMessage: prompts.showErrorMessage,
    } satisfies Partial<WindowApi>,
    workspace: { applyEdit: options.applyEdit ?? added } satisfies Partial<Workspace>,
    // real: the clipboard's paste edit provider takes part in pastes
    languages: new LanguagesHost(),
    sourceEditor: { registerCodeMirrorExtension: ignored } satisfies Partial<SourceEditorContributions>,
    preview: testPreview(options),
  };
}

/** A project holding the editor's document (whatever document it is) and `options.files`. */
function testProject(options: TestEditorOptions): Pick<Project, 'pathOf' | 'paths' | 'has' | 'content'> & { add(path: ProjectPath, content: FileContent): void } {
  const files = new Map(Object.entries(options.files ?? {}).map(([path, content]) => [ProjectPath.of(path), content]));
  return {
    pathOf: () => TEST_DOCUMENT_PATH,
    paths: () => [TEST_DOCUMENT_PATH, ...files.keys()],
    has: (path) => path === TEST_DOCUMENT_PATH || files.has(path),
    content: (path) => files.get(path),
    add: (path, content) => void files.set(path, content),
  };
}

/** A registration the test context accepts and ignores. */
function ignored(): Disposable {
  return new Disposable(() => {});
}

function testPreview(options: TestEditorOptions): Pick<PreviewContributions, 'snippet' | 'onDidRender'> {
  return { snippet: options.preview?.snippet ?? (async () => null), onDidRender: options.preview?.onDidRender ?? new EventEmitter<void>().event };
}

// jsdom has no object URLs: the images' renderer shows the files a test gives as `blob:test/<n>`
if (typeof URL.createObjectURL !== 'function') {
  let next = 0;
  Object.assign(URL, { createObjectURL: () => `blob:test/${next++}`, revokeObjectURL: () => {} });
}

/** The built-ins' Visual-editor contributions, in the order the widget's built-in extensions activate them. */
export function builtins(): VisualEditorContribution[] {
  return [markup(), math(), headings(), tables(), images(), figures(), renderedBoxes(), outline(), pageLayout(), lists(), alignment(), blockHandleExtension(), tabKeys(), undoRedo(), clipboard()];
}

/** Types `text` character by character at the selection, as the browser would (text input handlers and input rules run). */
export function type(editor: Editor, text: string): void {
  const { view } = editor;
  for (const char of text) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(char, from, to);
    if (!view.someProp('handleTextInput', (f) => f(view, from, to, char, insert))) view.dispatch(insert());
  }
}

/**
 * `button` as the user reaches it: the toolbar menu holding it (Insert ▾, Align ▾) opened first. A menu's items show
 * their state (pressed, disabled) only while it is open.
 */
export function opened(button: HTMLButtonElement): HTMLButtonElement {
  const trigger = button.closest('.zwf-toolbar__menu')?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  if (trigger?.getAttribute('aria-expanded') === 'false') trigger.click();
  return button;
}

/**
 * The grip the Visual editor shows beside the block at document position `pos` of `view` (the built-in
 * `block-handle`), as the pointer moving beside the block shows it. jsdom has no layout: for that move, each node's
 * DOM is laid out by its positions (its top 10px per position, as tall as its size), the pointer at the block's top.
 */
export function blockHandle(view: EditorView, pos: number): HTMLElement {
  const laidOut = new Map<unknown, DOMRect>();
  view.state.doc.descendants((node, at) => {
    laidOut.set(view.nodeDOM(at), new DOMRect(0, at * 10, 100, node.nodeSize * 10));
  });
  const measure = Element.prototype.getBoundingClientRect;
  const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return laidOut.get(this) ?? measure.call(this);
  });
  try {
    view.dom.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: pos * 10 }));
  } finally {
    rects.mockRestore();
  }
  return view.dom.parentElement!.querySelector<HTMLElement>('.zwf-block-handle')!;
}

/**
 * The browser starting a drag of `source` (the element it drags: a `draggable` one, like a block's grip). jsdom has
 * no drag events and no layout: a plain event with a stand-in `dataTransfer`, at (0, 0).
 */
export function dragStart(source: Element): void {
  source.dispatchEvent(dragEvent('dragstart'));
}

/** What was dragged dropped on `target`, at the document position `pos` of `view` (jsdom cannot tell it from coordinates). */
export function drop(view: EditorView, target: Element, pos: number): void {
  const posAtCoords = vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos, inside: -1 });
  try {
    target.dispatchEvent(dragEvent('drop'));
  } finally {
    posAtCoords.mockRestore();
  }
}

function dragEvent(type: string): Event {
  const data = new Map<string, string>();
  const dataTransfer = {
    files: [],
    effectAllowed: 'all',
    clearData: () => data.clear(),
    setData: (f: string, v: string) => data.set(f, v),
    getData: (f: string) => data.get(f) ?? '',
    setDragImage: () => {},
  };
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer, clientX: 0, clientY: 0 });
}

/** `doc` after the transaction `change` builds on a fresh state of it. */
export function edit(doc: Node, change: (state: EditorState) => EditorState['tr']): Node {
  const state = EditorState.create({ doc });
  return state.apply(change(state)).doc;
}

/** Position just after the first occurrence of `text` in the visual doc. */
export function after(doc: Node, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text) + text.length;
  });
  if (found < 0) throw new Error(`"${text}" not found`);
  return found;
}

/** The position of the first node of type `name`, and the node. */
export function find(doc: Node, name: string): { node: Node; pos: number } {
  let found: { node: Node; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (!found && node.type.name === name) found = { node, pos };
    return !found;
  });
  if (!found) throw new Error(`no ${name}`);
  return found;
}

/** Every position in `doc` whose next character is plain, visible text (not an atom or a decoded escape). */
function visibleChars(doc: Node): { pos: number; char: string }[] {
  const chars: { pos: number; char: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && !node.marks.some((m) => m.type.name === 'typstSource')) {
      for (let i = 0; i < node.text!.length; i++) chars.push({ pos: pos + i, char: node.text![i] });
    }
  });
  return chars;
}

/** Checks the position map of `doc` exhaustively against its printed source (see editor/editor.typst-conversion.test.ts). */
export function expectPreciseMap(doc: Node): void {
  const source = serializeToTypst(doc);
  for (const { pos, char } of visibleChars(doc)) {
    const offset = posToSource(doc, pos);
    expect(source[offset], `char at position ${pos}`).toBe(char);
    expect(sourceToPos(doc, offset)).toBe(pos);
  }
  let previous = -1;
  for (let offset = 0; offset <= source.length; offset++) {
    const pos = sourceToPos(doc, SourceOffset.of(offset));
    expect(pos, `monotonic at offset ${offset}`).toBeGreaterThanOrEqual(previous);
    expect(pos).toBeLessThanOrEqual(doc.content.size);
    expect(sourceToPos(doc, posToSource(doc, pos)), `round trip of offset ${offset}`).toBe(pos);
    previous = pos;
  }
  previous = -1;
  for (let pos = 0; pos <= doc.content.size; pos++) {
    const offset = posToSource(doc, pos);
    expect(offset, `monotonic at position ${pos}`).toBeGreaterThanOrEqual(previous);
    expect(offset).toBeLessThanOrEqual(source.length);
    previous = offset;
  }
}
