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
  alignment, boxLinks, customStyles, headingNumbers, headings, horizontalRule, images, lists, marginNotes, markup, notesGutter, outline,
  pageBreak, references, renderedBoxes, tables, taskLists, type ImageAssets, type Renderings,
} from './builtins/builtins';
import { VisualViewContributions } from './contributions/contributions';
import { createSchema } from './nodes/nodes';
import { posToSource, print, project as projectWith, sourceToPos } from './projection/projection';
import { VisualView } from './visual-view';

/** The schema of a view with the built-ins (no styles declared). */
export const schema: Schema = schemaWith();

/** The schema of a view with the built-ins configured from `options`. */
export function schemaWith(options: TestViewOptions = {}): Schema {
  const { nodes, marks } = contributions(options).visualView.contributed();
  return createSchema(nodes, marks);
}

export const project = (source: string): Node => projectWith(source, schema);

/** The options tests give a view, as a document's Visual view had them before contributions. */
export interface TestViewOptions {
  renderer?: Renderings;
  assets?: ImageAssets;
  user?: { name: string };
  comment?(): void;
  labels?: ProjectLabels;
  documentLinks?: DocumentLinkProvider;
  /** The project's styles, as one document sees them; `create` is "New style…". */
  styles?: DocumentStyles;
}

/** A Visual view of `document` with the built-ins configured from `options`, and the way to its notes' cards. */
export function createVisualView(parent: HTMLElement, document: TypstDocument, options: TestViewOptions = {}): VisualView & { editNote(offset: number): boolean } {
  const { visualView, editNote } = contributions(options);
  return Object.assign(new VisualView(parent, document, visualView), { editNote: (offset: number) => editNote(document, offset) });
}

/** The built-ins configured from `options`, in the order the widget's built-in extensions activate them. */
function contributions(options: TestViewOptions) {
  const { styles } = options;
  const notes = notesGutter({ user: options.user });
  const visualView = VisualViewContributions.from([
    boxLinks({ documentLinks: options.documentLinks && (() => options.documentLinks) }),
    markup,
    headings,
    tables,
    images({
      assets: options.assets && (() => options.assets),
      imageUrls: options.renderer && (() => options.renderer),
      documentLinks: options.documentLinks && (() => options.documentLinks),
    }),
    // after images, whose renderer draws image boxes
    renderedBoxes({ snippets: options.renderer && (() => options.renderer) }),
    outline,
    pageBreak,
    horizontalRule,
    // before lists: its projector gets bullet items (`- [ ] ..`) first
    taskLists,
    lists,
    headingNumbers,
    alignment,
    marginNotes({ comment: options.comment }),
    notes,
    references({ labels: options.labels }),
    customStyles({
      styles: styles && { styles: () => styles.styles(), onChange: (listener) => styles.onChange(listener), forDocument: () => styles },
      create: styles?.create,
    }),
  ]);
  return { visualView, editNote: (document: TypstDocument, offset: number) => notes.editNote(document, offset) };
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
