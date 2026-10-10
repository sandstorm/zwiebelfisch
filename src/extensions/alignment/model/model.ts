// The alignment extension's model: Typst's alignment syntax as far as the Visual view edits it — the argument of
// `#align(..)` and the set rules that change the default alignment. Pure: no DOM, no editor. See alignment.ts.
export { alignArgs, setRules, withHorizontal, type Horizontal, type TextAlignment } from './alignment-syntax';
