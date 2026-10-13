// The package's public API, and the only file that re-exports.
//
// A page uses createTypstEditor or <typst-editor> (registered on import). An outside extension needs only the types it
// implements or declares: everything else it reaches through its ExtensionContext, typed without importing. So this
// file exports, beside the two entries:
// - the types of each host's contribution points (workbench, commands, window, scm, languages, workspace, preview, the
//   Source and Visual editors). The Visual editor's node and mark specs come with the plain functions that read Typst
//   calls, so an outside extension can add a Typst construct as the built-ins do (experimental).
// - Disposable, EventEmitter and the value types (ProjectPath, FileContent, SourceOffset, SourceRange, PageIndex, Pt),
//   made where values come in, e.g. to `open` a file at a range; what a preview renderer gets (HtmlFile, ElementLocation,
//   HTML_ELEMENT_ATTRIBUTE).
// - VISUAL_EDITOR and SOURCE_EDITOR, to open a file in one of the Typst editors or tell which one is shown.
// - The optional extension collaboration, which a host adds with its connection.
// See docs/30_configuration/02_embedding.typ and docs/40_architecture/08_extensions.typ.
import { defineTypstEditorElement } from './typst-editor-element/typst-editor-element';

export { createTypstEditor, type TypstEditor, type TypstEditorOptions } from './typst-editor/typst-editor';
export { TypstEditorElement, defineTypstEditorElement, type TypstEditorChangeDetail } from './typst-editor-element/typst-editor-element';
export { type FileChange, FileContent, type ProjectFiles } from './core/project/project';
export { ProjectPath } from './core/paths/paths';
export { SourceOffset, SourceRange } from './core/typst-document/typst-document';
export type { User } from './core/user/user';
export { type ElementLocation, HTML_ELEMENT_ATTRIBUTE, type HtmlFile, PageIndex, type PdfEntry, Pt } from './core/typst-engine/typst-engine';
export { Disposable } from './core/disposable/disposable';
export { EventEmitter, type Event } from './core/event-emitter/event-emitter';
export type { ExtensionContext, ExtensionContributions, Memento, MenuContext, MenuItem, OpenOptions, SidePanel, SidePanelOptions, TypstExtension, Workbench } from './hosts/workbench/workbench';
export type { Command, Commands } from './hosts/commands/commands';
export type {
  CustomDocument,
  CustomEditorOptions,
  CustomEditorPanel,
  CustomEditorProvider,
  FileDecoration,
  FileDecorationProvider,
  InputBoxOptions,
  MessageItem,
  MessageSeverity,
  Progress,
  ProgressOptions,
  ProgressReport,
  QuickPickItem,
  QuickPickOptions,
  SaveDialogOptions,
  StatusBarPlacement,
  TextEditor,
  TextEditorSelectionChangeEvent,
  WindowApi,
} from './hosts/window/window';
export { ProgressLocation } from './hosts/window/window';
export type { Scm, SourceControl, SourceControlState } from './hosts/scm/scm';
export type {
  DocumentFilter,
  DocumentLink,
  DocumentLinkProvider,
  DocumentSelector,
  HelpLink,
  HelpProvider,
  HelpRow,
  HelpSection,
  HelpSheet,
  LanguageContribution,
  Languages,
  TextDocument,
} from './hosts/languages/languages';
export type { ConfigurationChangeEvent, ConfigurationProperty, Settings, Workspace, WorkspaceConfiguration } from './hosts/workspace/workspace';
export type {
  HtmlBundle,
  PdfExportOption,
  PreviewContributions,
  PreviewEntry,
  PreviewRenderer,
  PreviewRendererInfo,
  PreviewRendererView,
  PreviewToolbarItem,
  PreviewViewOption,
  ToolbarPlacement,
} from './hosts/preview/preview';
export { SOURCE_EDITOR, codeColors, type SourceEditorContext, type SourceEditorContributions } from './hosts/source-editor/source-editor';
export type {
  ToolbarAction,
  Anchor,
  CompletionContext,
  CompletionItem,
  CompletionItemProvider,
  CompletionTrigger,
  RawBoxPicture,
  RawBoxRenderer,
  RawBoxRendererProvider,
  RawBoxTools,
  RawBoxToolsHost,
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
  VisualEditorContext,
  VisualEditorContributions,
} from './hosts/visual-editor/visual-editor';
export { VISUAL_EDITOR, insertTypst, setRawBoxDecorations } from './hosts/visual-editor/visual-editor';
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
