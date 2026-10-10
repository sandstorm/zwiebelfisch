// The markup extension's model: Typst raw text (`code`, ```lang …```) as the Visual view reads and writes it — the
// parts of a parsed `Raw` node and the delimiters around edited code. Pure: no DOM, no editor. See markup.ts.
export { codeBlockDelimiters, codeLanguage, inlineCodeDelimiters, rawCode, type RawCode } from './raw-code';
