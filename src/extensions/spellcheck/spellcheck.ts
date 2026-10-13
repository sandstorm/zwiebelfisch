import { Disposable } from '../../core/disposable/disposable';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { textLanguage } from './model/text-language';
import { editableAttributes } from './visual-editor/editable-attributes';

/**
 * Spell checking in the Visual editor, by the browser's own checker: `spellcheck` on its editable element, as the
 * setting `spellcheck.enabled` says (default on), and `lang` from the document's language, so the browser checks
 * against the right dictionary. The language is that of the first `set text(lang: ..)` rule (with its `region`) in
 * the shown file, else in the main file; without one, the browser's default. It is read again a moment after edits.
 *
 * What is code is left out where it is made: the raw boxes' CodeMirror (math, labels, any Typst nothing models) and
 * the markup extension's inline code and code blocks set `spellcheck="false"`; reference chips and label tags are not
 * editable text. The Source editor is not checked (it would underline Typst syntax). The browser's checker knows no
 * project words: a checker with a project dictionary would replace this extension.
 * See docs/20_features/03_writing.typ.
 */
export function spellcheck(): TypstExtension {
  return {
    id: 'spellcheck',
    contributes,
    activate({ project, workspace, visualEditor, subscriptions }) {
      const attributes = (document: TypstDocument): SpellcheckAttributes => ({
        spellcheck: workspace.getConfiguration('spellcheck').get<boolean>('enabled', true),
        lang: textLanguage(document.text) ?? textLanguage(project.document(project.main)?.text ?? ''),
      });
      /** Each shown Visual editor's refresh: reads its attributes again and shows them if they changed. */
      const refreshes = new Set<() => void>();
      const refresh = () => refreshes.forEach((each) => each());
      let timer: ReturnType<typeof setTimeout> | undefined;
      subscriptions.push(
        visualEditor.registerTiptapExtension(({ document }) => editableAttributes(() => attributes(document), refreshes)),
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('spellcheck.enabled')) refresh();
        }),
        // a file's language can come from the main file: every edit counts, read once typing pauses
        project.onDidChangeFile(() => {
          clearTimeout(timer);
          timer = setTimeout(refresh, LANGUAGE_DELAY_MS);
        }),
        new Disposable(() => clearTimeout(timer)),
      );
    },
  };
}

/** What the Visual editor's editable element gets: `spellcheck`, and `lang` unless null (the browser's default). */
export interface SpellcheckAttributes {
  readonly spellcheck: boolean;
  readonly lang: string | null;
}

/** Its setting: `spellcheck.enabled`. */
const contributes: TypstExtension['contributes'] = {
  configuration: {
    properties: {
      'spellcheck.enabled': {
        type: 'boolean',
        default: true,
        description: "Whether the browser checks the spelling in the Visual editor, in the language of the document's `set text(lang: ..)`.",
      },
    },
  },
};

/** How long edits pause before the language is read again. */
const LANGUAGE_DELAY_MS = 300;
