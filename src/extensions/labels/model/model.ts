// The labels extension's model: the project's labels and the references to them (LabelIndex, a read model), and
// the pure rules of Typst's label / reference syntax and of describing a label. Entry of extensions/labels/model/.
// Why a folder of its own: no DOM and no editor library here, so the views and the tests share one source of truth
// that runs anywhere. See ARCHITECTURE.md, "Labels and references".
export { LabelIndex, type LabelInfo, type ProjectLabels } from './label-index';
export { describeLabel, labelChoices } from './label-choices';
export { guardAfterReference, LABEL_CHAR, labelName, referenceSyntax } from './reference-syntax';
