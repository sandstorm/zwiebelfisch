// Test helpers that compose the widget's built-in extensions: the Visual view's schema with the built-ins, project
// with it, a view with the built-ins configured from options; and the helpers such tests use on a projected document
// (apply an edit, find text, check the position map exhaustively). Entry of testing/: test-only, so it may import any
// module (an extension's tests compose it with the others here, never by importing another extension); only
// `*.test.ts` files may import it (eslint.config.js). Hosts' own tests use the host minimum and their own specs.
import type { Node, Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { expect } from 'vitest';
import { Disposable } from '../core/disposable/disposable';
import type { TypstDocument } from '../core/typst-document/typst-document';
import { alignment } from '../extensions/alignment/alignment';
import { headings } from '../extensions/headings/headings';
import { lists } from '../extensions/lists/lists';
import { markup } from '../extensions/markup/markup';
import { outline } from '../extensions/outline/outline';
import { pageLayout } from '../extensions/page-layout/page-layout';
import { tables } from '../extensions/tables/tables';
import { imagesVisualView, type ImageAssets, type ImageLinks, type ImageUrls } from '../extensions/images/images';
import { renderedBoxesVisualView, type SnippetSource } from '../extensions/rendered-boxes/rendered-boxes';
import { createSchema, VisualView, VisualViewContributions, type ContributionContext, type VisualViewContribution } from '../hosts/visual-view/visual-view';
import type { InputBoxOptions, MessageItem, QuickPickItem, QuickPickOptions, Workbench } from '../hosts/workbench/workbench';
import { posToSource, print, project as projectWith, sourceToPos } from '../hosts/projection/projection';

/** The schema of a view with the built-ins configured from `options`. */
export function schemaWith(options: TestViewOptions = {}): Schema {
  return schemaFrom(contributions(options));
}

/** The schema of a view with only `list` (built-in constructs or features), activated in that order. */
export function schemaOf(list: readonly VisualViewContribution[]): Schema {
  return schemaFrom(activate(list));
}

function schemaFrom(registry: VisualViewContributions): Schema {
  const { nodes, marks } = registry.contributed();
  return createSchema(nodes, marks);
}

/** What a document's raw boxes show while not edited, in tests: compiled snippets and image files. */
export type Renderings = SnippetSource & ImageUrls;

/** What a test gives a view: what the built-ins would get from the workbench, and the contributions under test. */
export interface TestViewOptions {
  renderer?: Renderings;
  assets?: ImageAssets;
  imageLinks?: ImageLinks;
  /** What the user answers when the view asks (link URL, image, alt text, …); default: every question cancelled. */
  prompts?: TestPrompts;
  /** The contributions of the extension under test, activated after the built-ins (as the widget's features are). */
  contributions?: readonly VisualViewContribution[];
}

/**
 * The workbench's input box, quick pick and messages in a test: each question takes the next of `answers` (an input
 * box the text, a quick pick the label of the item or its index; undefined cancels), and `asked` / `told` keep what
 * was asked and said.
 */
export class TestPrompts implements Pick<Workbench, 'showInputBox' | 'showQuickPick' | 'showErrorMessage'> {
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
  }) as Workbench['showQuickPick'];

  showErrorMessage = async <T extends string | MessageItem>(message: string): Promise<T | undefined> => {
    this.told.push(message);
    return undefined;
  };
}

// after TestPrompts: making the schema activates the built-ins, which get prompts
/** The schema of a view with the built-ins. */
export const schema: Schema = schemaWith();

/** `source` projected with `withSchema` (default: the built-ins' `schema`). */
export const project = (source: string, withSchema: Schema = schema): Node => projectWith(source, withSchema);

/** A Visual view of `document` with the built-ins configured from `options`. */
export function createVisualView(parent: HTMLElement, document: TypstDocument, options: TestViewOptions = {}): VisualView {
  return new VisualView(parent, document, contributions(options));
}

/** The built-ins and `options.contributions`, activated. */
function contributions(options: TestViewOptions): VisualViewContributions {
  return activate([...builtins(options), ...(options.contributions ?? [])], options.prompts);
}

/**
 * `contributions` activated in order, for their Visual-view contributions. The built-in constructs are extensions:
 * of the rest of the extension context they use only the workbench's stylesheets and its prompts (`prompts`; default:
 * every question cancelled).
 */
function activate(contributions: readonly VisualViewContribution[], prompts: TestPrompts = new TestPrompts()): VisualViewContributions {
  const visualView = new VisualViewContributions();
  const subscriptions: { dispose(): unknown }[] = [];
  const workbench = {
    registerStyleSheet: () => new Disposable(() => {}),
    showInputBox: prompts.showInputBox,
    showQuickPick: prompts.showQuickPick,
    showErrorMessage: prompts.showErrorMessage,
  };
  for (const contribution of contributions) contribution.activate({ visualView, subscriptions, workbench } as ContributionContext);
  return visualView;
}

/**
 * The built-ins' Visual-view contributions configured from `options`, in the order the widget's built-in
 * extensions activate them (without `options.contributions`).
 */
export function builtins(options: Omit<TestViewOptions, 'contributions'> = {}): VisualViewContribution[] {
  return [
    markup(),
    headings(),
    tables(),
    imagesVisualView({
      assets: options.assets && (() => options.assets),
      imageUrls: options.renderer && (() => options.renderer),
      imageLinks: options.imageLinks && (() => options.imageLinks),
      prompts: options.prompts ?? new TestPrompts(),
    }),
    renderedBoxesVisualView({ snippets: options.renderer && (() => options.renderer) }),
    outline(),
    pageLayout(),
    lists(),
    alignment(),
  ];
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
  const source = print(doc);
  for (const { pos, char } of visibleChars(doc)) {
    const offset = posToSource(doc, pos);
    expect(source[offset], `char at position ${pos}`).toBe(char);
    expect(sourceToPos(doc, offset)).toBe(pos);
  }
  let previous = -1;
  for (let offset = 0; offset <= source.length; offset++) {
    const pos = sourceToPos(doc, offset);
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
