// The Visual-view parts of the widget's features that have not moved into extensions/ yet. Entry of
// visual-view/builtins/. See ARCHITECTURE.md, "VisualView". A feature's extension activates the contributions it
// configures (`references` with its LabelIndex, …). They use only the contribution API, and move into
// extensions/<name>/visual-view/ with their feature. (The Typst constructs are in extensions/ already.)
export { references, type ReferencesOptions } from './references/references';
export { customStyles, type StyleSource, type StylesOptions } from './styles/styles';
