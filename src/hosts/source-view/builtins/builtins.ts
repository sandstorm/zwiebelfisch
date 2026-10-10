// The Source view's built-in contributions, each in its own module so that it can move into its extension
// (docs/2026_10_10_extensions-architecture.md) by a file move. Entry of hosts/source-view/builtins/.
// The contributions, for `SourceViewHost.registerExtension` (in brackets: the extension each one goes to):
// typstLanguage() and codeColors (typst-language), lint(diagnostics) (diagnostics), fileLinks (document-links),
// presence (collaboration). The other exports are what the Visual view's raw boxes and the widget need of them.
export { DiagnosticCollection, describeDiagnostic, lint, type SourceDiagnostic } from './lint';
export { presence, remotePresence, showPresence } from './presence';
