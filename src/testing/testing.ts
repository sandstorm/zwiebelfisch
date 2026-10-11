// Test helpers that compose the widget's built-in extensions: the Visual view's schema with the built-ins, project
// with it, a view with the built-ins activated with a test's extension context (project files, preview snippets,
// document links, prompts); and the helpers such tests use on a projected document (apply an edit, find text, check
// the position map exhaustively). Entry of testing/: test-only, so it may import any
// module (an extension's tests compose it with the others here, never by importing another extension); only
// `*.test.ts` files may import it (eslint.config.js). Hosts' own tests use the host minimum and their own specs.
import { Editor } from '@tiptap/core';
import type { Node, Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { expect } from 'vitest';
import { Disposable } from '../core/disposable/disposable';
import { EventEmitter } from '../core/event-emitter/event-emitter';
import { ProjectPath } from '../core/paths/paths';
import type { FileChange, FileContent, Project } from '../core/project/project';
import { SourceOffset, type TypstDocument } from '../core/typst-document/typst-document';
import { alignment } from '../extensions/alignment/alignment';
import { figures } from '../extensions/figures/figures';
import { headings } from '../extensions/headings/headings';
import { lists } from '../extensions/lists/lists';
import { markup } from '../extensions/markup/markup';
import { outline } from '../extensions/outline/outline';
import { pageLayout } from '../extensions/page-layout/page-layout';
import { tables } from '../extensions/tables/tables';
import { images } from '../extensions/images/images';
import { renderedBoxes } from '../extensions/rendered-boxes/rendered-boxes';
import type { Commands } from '../hosts/commands/commands';
import type { Languages } from '../hosts/languages/languages';
import type { PreviewContributions } from '../hosts/preview/preview';
import { VisualView, VisualViewHost, type ContributionContext, type VisualViewContribution } from '../hosts/visual-view/visual-view';
import type { InputBoxOptions, MessageItem, QuickPickItem, QuickPickOptions, WindowApi } from '../hosts/window/window';
import type { Workbench } from '../hosts/workbench/workbench';
import type { Workspace } from '../hosts/workspace/workspace';
import { attachGrammar, createSchema, documentExtensions, posToSource, serializeToTypst, parseTypst as parseTypstWith, sourceToPos } from '../hosts/projection/projection';

/** The schema of a view with the built-ins configured from `options`. */
export function schemaWith(options: TestViewOptions = {}): Schema {
  return schemaFrom(contributions(options));
}

/** The schema of a view with only `list` (built-in constructs or features), activated in that order. */
export function schemaOf(list: readonly VisualViewContribution[]): Schema {
  return schemaFrom(activate(list));
}

function schemaFrom(registry: VisualViewHost): Schema {
  const { nodes, marks } = registry.contributed();
  return createSchema(nodes, marks);
}

/** The path of the document a test view shows, in the test's project. */
export const TEST_DOCUMENT_PATH = ProjectPath.of('/main.typ');

/**
 * What a test gives a view: the parts of the extension context the built-ins use (the project's files, the preview's
 * snippets, the document links, the window's prompts), and the contributions under test.
 */
export interface TestViewOptions {
  /** The project's other files (images as bytes), by path; the view's document is `TEST_DOCUMENT_PATH`. Default: none. */
  files?: Readonly<Record<string, FileContent>>;
  /** Applies a change (an uploaded image): resolves to why it was refused, or null. Default: the file is added. */
  applyEdit?(change: FileChange): Promise<string | null>;
  /** The preview's compiled snippets of the document (raw boxes show them; default: none) and when they change. */
  preview?: Partial<Pick<PreviewContributions, 'snippet' | 'onDidRender'>>;
  /** The document links (`languages`; an image box's path; default: none) and where following one goes (`workbench.open`). */
  links?: Partial<Pick<Languages, 'provideDocumentLinks' | 'resolveDocumentLink'> & Pick<Workbench, 'open'>>;
  /** What the user answers when the view asks (link URL, image, alt text, …); default: every question cancelled. */
  prompts?: TestPrompts;
  /** The contributions of the extension under test, activated after the built-ins (as the widget's features are). */
  contributions?: readonly VisualViewContribution[];
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
/** The schema of a view with the built-ins. */
export const schema: Schema = schemaWith();

/** `source` projected with `withSchema` (default: the built-ins' `schema`). */
export const parseTypst = (source: string, withSchema: Schema = schema): Node => parseTypstWith(source, withSchema);

/** A Visual view of `document` with the built-ins configured from `options`. */
export function createVisualView(parent: HTMLElement, document: TypstDocument, options: TestViewOptions = {}): VisualView {
  return new VisualView(parent, document, contributions(options));
}

/**
 * A Tiptap editor of `source` with the built-ins configured from `options` (their schema and commands, without the
 * Visual view's node views and toolbar): for tests of a construct's commands. Needs a DOM (jsdom).
 */
export function createEditor(source: string, options: TestViewOptions = {}): Editor {
  const { nodes, marks } = contributions(options).contributed();
  const editor = new Editor({ extensions: documentExtensions(nodes, marks), injectCSS: false });
  attachGrammar(editor.schema, nodes, marks);
  editor.view.updateState(EditorState.create({ schema: editor.schema, doc: parseTypstWith(source, editor.schema), plugins: editor.state.plugins }));
  return editor;
}

/** The built-ins and `options.contributions`, activated. */
function contributions(options: TestViewOptions): VisualViewHost {
  return activate([...builtins(), ...(options.contributions ?? [])], options);
}

/**
 * `contributions` activated in order, for their Visual-view contributions, with an extension context made from
 * `options`: a project of `TEST_DOCUMENT_PATH` and `options.files`, a preview with `options.preview`'s snippets,
 * `options.links`, the window's `options.prompts` (default: every question cancelled) and `options.applyEdit`.
 * Registrations other than the Visual view's (style sheets, commands, custom editors) are accepted and ignored.
 */
function activate(contributions: readonly VisualViewContribution[], options: TestViewOptions = {}): VisualViewHost {
  const visualView = new VisualViewHost();
  const context = { visualView, subscriptions: [], ...testContext(options) };
  for (const contribution of contributions) contribution.activate(context as unknown as ContributionContext);
  return visualView;
}

/** The parts of an extension context the built-ins use, made from `options`. */
function testContext(options: TestViewOptions) {
  const project = testProject(options);
  const prompts = options.prompts ?? new TestPrompts();
  const added = async (change: FileChange) => (change.kind === 'create' && project.add(change.path, change.content), null);
  return {
    project,
    workbench: { registerStyleSheet: ignored, open: options.links?.open ?? (() => {}) } satisfies Partial<Workbench>,
    commands: { registerCommand: ignored } satisfies Partial<Commands>,
    window: {
      registerCustomEditorProvider: ignored,
      showInputBox: prompts.showInputBox,
      showQuickPick: prompts.showQuickPick,
      showErrorMessage: prompts.showErrorMessage,
    } satisfies Partial<WindowApi>,
    workspace: { applyEdit: options.applyEdit ?? added } satisfies Partial<Workspace>,
    languages: testLanguages(options),
    preview: testPreview(options),
  };
}

function testLanguages(options: TestViewOptions): Pick<Languages, 'provideDocumentLinks' | 'resolveDocumentLink'> {
  return {
    provideDocumentLinks: options.links?.provideDocumentLinks ?? (() => []),
    resolveDocumentLink: options.links?.resolveDocumentLink ?? ((link) => link),
  };
}

/** A project holding the view's document (whatever document it is) and `options.files`. */
function testProject(options: TestViewOptions): Pick<Project, 'pathOf' | 'paths' | 'has' | 'content'> & { add(path: ProjectPath, content: FileContent): void } {
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

function testPreview(options: TestViewOptions): Pick<PreviewContributions, 'snippet' | 'onDidRender'> {
  return { snippet: options.preview?.snippet ?? (async () => null), onDidRender: options.preview?.onDidRender ?? new EventEmitter<void>().event };
}

// jsdom has no object URLs: the images' renderer shows the files a test gives as `blob:test/<n>`
if (typeof URL.createObjectURL !== 'function') {
  let next = 0;
  Object.assign(URL, { createObjectURL: () => `blob:test/${next++}`, revokeObjectURL: () => {} });
}

/** The built-ins' Visual-view contributions, in the order the widget's built-in extensions activate them. */
export function builtins(): VisualViewContribution[] {
  return [markup(), headings(), tables(), images(), figures(), renderedBoxes(), outline(), pageLayout(), lists(), alignment()];
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

/** Checks the position map of `doc` exhaustively against its printed source (see typst-editor/typst-editor.projection.test.ts). */
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
