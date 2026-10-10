// What contributions add to raw boxes (Typst kept verbatim, edited as code): pictures instead of the code, tools
// around it, extensions of the code editor. See contributions.ts and nodes/raw-box.ts.
import type { Extension as CodeExtension } from '@codemirror/state';
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import type { Disposable } from '../../../core/disposable/disposable';
import type { VisualViewContext } from './view-context';

/** A picture a box shows instead of its code: a URL and CSS lengths ('' or absent: automatic). */
export interface BoxPicture {
  url: string;
  width?: string;
  height?: string;
  margin?: string;
}

/**
 * What raw boxes show instead of their code while they are not being edited.
 * The first renderer that `renders` a box draws it; without one, it shows code.
 */
export interface BoxRenderer {
  /** Whether it draws boxes of `node`'s kind. */
  renders(node: Node): boolean;
  /** The picture of the box `node` whose source starts at offset `from`; null: show the code. */
  render(node: Node, from: number): Promise<BoxPicture | null>;
  /** Draws a box again as soon as its node changes (an image follows its path), not only on `onDidChange`. */
  readonly followsEdits?: boolean;
  /** Fires whenever pictures may have changed (a new compile). */
  onDidChange(listener: () => void): Disposable;
}

/** The renderer of one view's boxes (null: none for this view). */
export type BoxRendererProvider = (view: VisualViewContext) => BoxRenderer | null;

/** CodeMirror extensions of every raw box's code in one view (e.g. links on file paths). */
export type BoxCodeExtensionProvider = (view: VisualViewContext) => CodeExtension;

/** The box tools of a code box belong to. */
export interface BoxToolsHost {
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
}

/** Tools on a code box (an image's resize handles and toolbar); a click on the picture then selects the box. */
export interface BoxTools {
  /** The box's node changed. */
  update(node: Node): void;
  /** The box was selected. */
  select(): void;
  destroy(): void;
}

/** What a code box of a node type shows besides its code (see `TypstNodeSpec.codeBox`). */
export interface CodeBoxSpec {
  /** A heading above the code saying what the box shows (an outline: "Table of contents"); `className` goes on the box. */
  readonly label?: { readonly className: string; text(src: string): string };
  /** Tools for every box of this type. */
  tools?(host: BoxToolsHost, node: Node): BoxTools;
}
