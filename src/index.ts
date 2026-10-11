// The package's public API: createTypstEditor, <typst-editor> (registered on import), and what writing an extension
// takes: the types an extension implements or declares (everything else it reaches through its ExtensionContext is
// typed without importing) — the Visual view's contribution types (node and mark specs, their projection grammar,
// toolbar items, box renderers and actions, gutters, highlights, text styles; experimental) included, so an outside
// extension can add a Typst construct as the built-ins do —, Disposable and EventEmitter, ProjectPath (paths are
// parsed, e.g. to `open` one), and the collaboration extension, which a host adds with its connection. The only file
// that re-exports. See ARCHITECTURE.md and docs/embedding.md.
import { defineTypstEditorElement } from './typst-editor-element/typst-editor-element';

export { createTypstEditor, type TypstEditor, type TypstEditorOptions } from './typst-editor/typst-editor';
export { TypstEditorElement, defineTypstEditorElement, type TypstEditorChangeDetail } from './typst-editor-element/typst-editor-element';
export type { FileChange, FileContent, ProjectFiles } from './core/project/project';
export { ProjectPath } from './core/paths/paths';
export type { User } from './core/user/user';
export type { PdfEntry } from './core/typst-engine/typst-engine';
export { Disposable } from './core/disposable/disposable';
export { EventEmitter, type Event } from './core/event-emitter/event-emitter';
export type { ExtensionContext, ExtensionContributions, Memento, MenuContext, MenuItem, OpenOptions, SidePanel, SidePanelOptions, TypstExtension, Workbench } from './hosts/workbench/workbench';
export type { Command, Commands } from './hosts/commands/commands';
export type {
  CustomDocument,
  CustomEditorOptions,
  CustomEditorPanel,
  CustomEditorProvider,
  EditorMode,
  FileDecoration,
  FileDecorationProvider,
  InputBoxOptions,
  MessageItem,
  MessageSeverity,
  QuickPickItem,
  QuickPickOptions,
  SaveDialogOptions,
  StatusBarPlacement,
  TextEditor,
  TextEditorSelectionChangeEvent,
  Window,
} from './hosts/window/window';
export type { Scm, SourceControl, SourceControlState } from './hosts/scm/scm';
export type { DocumentLink, DocumentLinkProvider, Languages, TextDocument } from './hosts/languages/languages';
export type { ConfigurationChangeEvent, ConfigurationProperty, Settings, Workspace, WorkspaceConfiguration } from './hosts/workspace/workspace';
export type { PdfExportOption, PreviewContributions, PreviewToolbarItem, ToolbarPlacement } from './hosts/preview/preview';
export type { SourceViewContext, SourceViewContributions, SourceViewExtension } from './hosts/source-view/source-view';
export type {
  Action,
  Anchor,
  BoxAction,
  BoxCodeExtensionProvider,
  BoxPicture,
  BoxRenderer,
  BoxRendererProvider,
  BoxTools,
  BoxToolsHost,
  EditorExtensionProvider,
  Gutter,
  GutterProvider,
  Highlight,
  HighlightProvider,
  PriorityOptions,
  TextStyle,
  TextStyleProvider,
  ToolbarContext,
  ToolbarControl,
  ToolbarGroup,
  ToolbarItem,
  TypstNodeSpec,
  VisualViewContext,
  VisualViewContributions,
} from './hosts/visual-view/visual-view';
export { setBoxDecorations } from './hosts/visual-view/visual-view';
export type {
  Around,
  BlockLabel,
  DocumentNodeSpec,
  Placed,
  TypstMarkConversion,
  TypstMarkSpec,
  TypstNodeConversion,
  TypstParseContext,
  TypstParseRules,
  TypstSerializeState,
} from './hosts/projection/projection';
// Reading Typst syntax (Lezer nodes of codemirror-lang-typst's grammar) in parse functions: plain functions.
export {
  callArguments,
  calleeName,
  children,
  decodeString,
  hasOnlyArguments,
  isClosedContent,
  namedArgument,
  quote,
  trailingContent,
  withHash,
} from './core/typst-syntax/typst-syntax';
export { collaboration, type CollaborationOptions } from './extensions/collaboration/collaboration';

// Importing the package makes <typst-editor> available (no-op without a DOM).
defineTypstEditorElement();
