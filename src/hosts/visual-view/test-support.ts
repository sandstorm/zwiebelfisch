/**
 * Shared helpers for Visual view tests: the built-ins' schema, project with
 * it, apply an edit, find text, check the position map exhaustively, and make
 * a view with the built-ins configured from options.
 */
import type { Node, Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { expect } from 'vitest';
import type { DocumentLinkProvider } from '../../core/document-links/document-links';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { ProjectLabels } from '../../features/labels/labels';
import type { DocumentStyles } from '../../features/styles/styles';
import {
  alignment, customStyles, headingNumbers, headings, horizontalRule, lists, markup, outline, pageBreak, references,
  tables, taskLists,
} from './builtins/builtins';
import { boxLinks } from '../../extensions/document-links/document-links';
import { imagesVisualView, type ImageAssets, type ImageUrls } from '../../extensions/images/images';
import { renderedBoxesVisualView, type SnippetSource } from '../../extensions/rendered-boxes/rendered-boxes';
import { VisualViewContributions, type VisualViewContribution } from './contributions/contributions';
import { createSchema } from './nodes/nodes';
import { posToSource, print, project as projectWith, sourceToPos } from './projection/projection';
import { VisualView } from './visual-view';

/** The schema of a view with the built-ins (no styles declared). */
export const schema: Schema = schemaWith();

/** The schema of a view with the built-ins configured from `options`. */
export function schemaWith(options: TestViewOptions = {}): Schema {
  const { nodes, marks } = contributions(options).contributed();
  return createSchema(nodes, marks);
}

/** `source` projected with `withSchema` (default: the built-ins' `schema`). */
export const project = (source: string, withSchema: Schema = schema): Node => projectWith(source, withSchema);

/** What a document's raw boxes show while not edited, in tests: compiled snippets and image files. */
export type Renderings = SnippetSource & ImageUrls;

/** The options tests give a view, as a document's Visual view had them before contributions. */
export interface TestViewOptions {
  renderer?: Renderings;
  assets?: ImageAssets;
  labels?: ProjectLabels;
  documentLinks?: DocumentLinkProvider;
  /** The project's styles, as one document sees them; `create` is "New style…". */
  styles?: DocumentStyles;
  /** Contributions beyond the host's built-ins, activated after them: an extension's own, in its tests. */
  contributions?: readonly VisualViewContribution[];
}

/** A Visual view of `document` with the built-ins configured from `options`. */
export function createVisualView(parent: HTMLElement, document: TypstDocument, options: TestViewOptions = {}): VisualView {
  return new VisualView(parent, document, contributions(options));
}

/** The built-ins configured from `options`, in the order the widget's built-in extensions activate them. */
function contributions(options: TestViewOptions): VisualViewContributions {
  const { styles } = options;
  return VisualViewContributions.from([
    boxLinks({ documentLinks: options.documentLinks && (() => options.documentLinks) }),
    markup,
    headings,
    tables,
    imagesVisualView({
      assets: options.assets && (() => options.assets),
      imageUrls: options.renderer && (() => options.renderer),
      documentLinks: options.documentLinks && (() => options.documentLinks),
    }),
    // after images, whose renderer draws image boxes
    renderedBoxesVisualView({ snippets: options.renderer && (() => options.renderer) }),
    outline,
    pageBreak,
    horizontalRule,
    // before lists: its projector gets bullet items (`- [ ] ..`) first
    taskLists,
    lists,
    headingNumbers,
    alignment,
    references({ labels: options.labels }),
    customStyles({
      styles: styles && { styles: () => styles.styles(), onChange: (listener) => styles.onChange(listener), forDocument: () => styles },
      create: styles?.create,
    }),
    ...(options.contributions ?? []),
  ]);
}

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

/** Checks the position map of `doc` exhaustively against its printed source (see projection.test.ts). */
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
