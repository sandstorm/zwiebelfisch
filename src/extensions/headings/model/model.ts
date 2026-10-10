// The headings extension's model: heading numbers as Typst computes them from `#set heading(numbering: ..)` rules
// (Typst's numbering patterns included) and the code that switches numbering off. Pure: no DOM, no editor; the Visual
// view walks its document and asks a HeadingCounter. See headings.ts.
export { HEADING_NUMBERING_RULE, HeadingCounter, numbersHeadings, withoutHeadingNumbering } from './heading-numbering';
