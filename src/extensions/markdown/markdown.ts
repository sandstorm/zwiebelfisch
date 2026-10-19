import type { Extension } from '../../hosts/workbench/workbench';
import { markdownLikelihood } from './model/markdown-signals';
import { markdownToTypst } from './model/markdown-to-typst';

/**
 * Markdown pasted into Typst text goes in as Typst: `## Setup` as `== Setup`, `**bold**` as `*bold*` (lossy).
 *
 * A paste edit provider of the kind `typst.markdown` ("Markdown"). It is offered for text without HTML, or text that
 * says it is Markdown (VS Code's language mode, a `language-markdown` code block); never for Typst a Visual editor
 * copied. Where the text is surely Markdown it is the paste; where it only may be (`*x*`, `- item`) it comes after
 * the Typst paste, in the "Paste as" chip.
 */
export function markdown(): Extension {
  return {
    id: 'markdown',
    activate({ languages, subscriptions }) {
      subscriptions.push(
        languages.registerDocumentPasteEditProvider(
          { language: 'typst' },
          {
            provideDocumentPasteEdits(_document, _ranges, data) {
              const text = data.getData('text/plain');
              const declared = saysMarkdown(data);
              if (!text.trim() || data.getData(TYPST) || (data.getData('text/html') && !declared)) return [];
              const likelihood = declared ? 'sure' : markdownLikelihood(text);
              if (likelihood === 'no') return [];
              return [{ kind: 'typst.markdown', title: 'Markdown', insertText: markdownToTypst(text), yieldTo: likelihood === 'sure' ? [] : ['typst'] }];
            },
          },
          { providedPasteEditKinds: ['typst.markdown'], pasteMimeTypes: ['text/plain'] },
        ),
      );
    },
  };
}

/** The type of the Typst a Visual editor copied (see the Visual editor's clipboard). */
const TYPST = 'text/x-typst';

/** Whether the clipboard `data` says its text is Markdown: VS Code's language mode, a code block's language in its HTML. */
function saysMarkdown(data: DataTransfer): boolean {
  let mode: unknown;
  try {
    mode = JSON.parse(data.getData('vscode-editor-data') || '{}')?.mode;
  } catch {
    mode = undefined;
  }
  return mode === 'markdown' || MARKDOWN_HTML.test(data.getData('text/html'));
}

/** HTML of a code block in Markdown: a class `language-markdown` (`lang-`, GitHub's `highlight-text-md`) or `data-lang`. */
const MARKDOWN_HTML = /\b(?:language|lang|highlight-(?:source|text))-(?:md|markdown|gfm)\b|\bdata-lang(?:uage)?=["']?(?:md|markdown|gfm)\b/i;
