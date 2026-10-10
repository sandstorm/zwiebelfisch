// The rendered-boxes extension: a raw box in the Visual view (Typst the view does not model) shows how it looks
// compiled — its snippet cut from the preview's pages — until someone edits its code. Entry of
// extensions/rendered-boxes/. See ARCHITECTURE.md, "createTypstEditor".
// Why an extension: the Visual view only knows that a box may be drawn by a renderer; where pictures come from
// (the preview, under the document's current path) is this extension's knowledge.
import type { Event } from '../../core/event-emitter/event-emitter';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { VisualViewContribution } from '../../hosts/visual-view/visual-view';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import type { Snippet } from './model/model';
import { snippetRenderer } from './visual-view/visual-view';

/**
 * Raw boxes drawn as compiled snippets from the preview (`Preview.snippet` under the document's current path,
 * refreshed on `onDidRender`). In the built-in list after `images`, whose renderer draws image boxes.
 */
export function renderedBoxes(): TypstExtension {
  return {
    id: 'rendered-boxes',
    activate(context) {
      const { project, preview } = context;
      renderedBoxesVisualView({
        snippets: (document) => ({
          snippet: async (from, to, text) => {
            const file = project.pathOf(document);
            return file ? preview.snippet(file, from, to, text) : null;
          },
          onDidChange: preview.onDidRender,
        }),
      }).activate(context);
    },
  };
}

/** Where a document's snippets come from: the compiled pages. */
export interface SnippetSource {
  /**
   * How source `from`..`to` of the document, which holds `text`, looks
   * compiled; null when it draws nothing or cannot be shown right now.
   */
  snippet(from: number, to: number, text: string): Promise<Snippet | null>;
  /** Fires whenever snippets may have changed. */
  readonly onDidChange: Event<void>;
}

export interface RenderedBoxesOptions {
  /** The snippets of `document` (default: none, boxes show their code). */
  snippets?(document: TypstDocument): SnippetSource | undefined;
}

/**
 * While not focused, a raw box shows the compiled snippet of its source range
 * as an SVG picture, refreshed whenever the source reports a change. Block
 * boxes size it in pt; inline boxes in em of the text around them (see
 * `inlinePictureSize`). Boxes that draw nothing in place (`#set`, `#let`,
 * comments: see `rendersInPlace`) and boxes whose snippet is null keep
 * showing code. Registered after `images`, whose renderer draws image boxes.
 */
export function renderedBoxesVisualView(options: RenderedBoxesOptions = {}): VisualViewContribution {
  return {
    id: 'rendered-boxes',
    activate({ visualView, subscriptions }) {
      subscriptions.push(visualView.registerBoxRenderer((view) => snippetRenderer(options.snippets?.(view.document))));
    },
  };
}
