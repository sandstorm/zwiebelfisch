// The styles extension's model: the custom styles a project declares (StyleIndex, a read model; `/// @style …`
// declarations) and the stub "New style…" adds. Entry of extensions/styles/model/.
// Why a folder of its own: no DOM and no editor library here, so the views and the tests share one source of truth
// that runs anywhere. See ARCHITECTURE.md, "Custom styles".
export { StyleIndex, type ProjectStyles } from './style-index';
export type { Style, StyleKind } from './discover';
export { newStyle } from './new-style';
