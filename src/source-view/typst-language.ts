import { LanguageSupport } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { typst_lezer, typstLezerLinter } from 'codemirror-lang-typst/lezer';

/**
 * Typst language support for CodeMirror without the Lezer syntax linter: the
 * compiler's diagnostics are the single source of errors, so nothing is
 * reported twice.
 */
export function typstLanguage(): LanguageSupport {
  const lezer = typst_lezer();
  const support = (lezer.support as readonly Extension[]).filter((extension) => extension !== typstLezerLinter);
  return new LanguageSupport(lezer.language, support);
}
