// The package's public API: createTypstEditor, <typst-editor> (registered on import), and what writing an extension
// takes: the types an extension implements or declares (everything else it reaches through its ExtensionContext is
// typed without importing) — the Visual view's contribution types (node and mark specs with their Typst parse rules
// and toTypst, toolbar items, box renderers and actions, gutters, highlights, text styles; experimental) and the
// plain functions that read Typst calls from Lezer's syntax nodes included, so an outside extension can add a Typst
// construct as the built-ins do —, Disposable and EventEmitter, the value types (ProjectPath, FileContent,
// SourceOffset / SourceRange, PageIndex, Pt: made where values come in, e.g. to `open` a file at a range), and the
// collaboration extension, which a host adds with its connection. The only file that re-exports. See docs/guide/embedding.typ and docs/extensions/overview.typ.
import { defineTypstEditorElement } from './typst-editor-element/typst-editor-element';

export { createTypstEditor, type TypstEditor, type TypstEditorOptions } from './typst-editor/typst-editor';
export { TypstEditorElement, defineTypstEditorElement, type TypstEditorChangeDetail } from './typst-editor-element/typst-editor-element';
export { type FileChange, FileContent, type ProjectFiles } from './core/project/project';
export { ProjectPath } from './core/paths/paths';
export { SourceOffset, SourceRange } from './core/typst-document/typst-document';
export type { User } from './core/user/user';
export { PageIndex, type PdfEntry, Pt } from './core/typst-engine/typst-engine';
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
  WindowApi,
} from './hosts/window/window';
export type { Scm, SourceControl, SourceControlState } from './hosts/scm/scm';
export type { DocumentLink, DocumentLinkProvider, Languages, TypstText } from './hosts/languages/languages';
export type { ConfigurationChangeEvent, ConfigurationProperty, Settings, Workspace, WorkspaceConfiguration } from './hosts/workspace/workspace';
export type { PdfExportOption, PreviewContributions, PreviewToolbarItem, ToolbarPlacement } from './hosts/preview/preview';
export type { SourceViewContext, SourceViewContributions } from './hosts/source-view/source-view';
export type {
  ToolbarAction,
  Anchor,
  CompletionContext,
  CompletionItem,
  CompletionItemProvider,
  CompletionTrigger,
  RawBoxAction,
  BoxPicture,
  RawBoxRenderer,
  RawBoxRendererProvider,
  RawBoxTools,
  RawBoxToolsHost,
  Gutter,
  GutterProvider,
  SourceHighlight,
  SourceHighlightProvider,
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
  PlacedNode,
  TypstMarkConversion,
  TypstMarkSpec,
  TypstNodeConversion,
  TypstParseContext,
  TypstParseRules,
  TypstSerializeState,
} from './hosts/prosemirror-typst/prosemirror-typst';
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
