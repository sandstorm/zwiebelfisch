// The package's public API, and the only file that re-exports. Used by:
// - pages, through createEditor or <zwiebelfisch-editor> (registered on import)
// - outside extensions, which import only the types they implement or declare; everything else they reach through
//   their ExtensionContext
import { defineEditorElement } from './editor-element/editor-element';

export { createEditor, type Editor, type EditorOptions } from './editor/editor';
export { EditorElement, defineEditorElement, type EditorChangeDetail } from './editor-element/editor-element';
export { type FileChange, FileContent, type ProjectFiles } from './core/project/project';
export { ProjectPath } from './core/paths/paths';
export { SourceOffset, SourceRange } from './core/typst-document/typst-document';
export type { User } from './core/user/user';
export { type ElementLocation, HTML_ELEMENT_ATTRIBUTE, type HtmlFile, PageIndex, type PdfEntry, Pt } from './core/typst-engine/typst-engine';
export { Disposable } from './core/disposable/disposable';
export { EventEmitter, type Event } from './core/event-emitter/event-emitter';
export type { ExtensionContext, ExtensionContributions, Memento, MenuContext, MenuItem, OpenOptions, SidePanel, SidePanelOptions, Extension, Workbench } from './hosts/workbench/workbench';
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
  PreviewOutput,
  PreviewRenderer,
  PreviewRendererInfo,
  PreviewRendererView,
  PreviewToolbarItem,
  PreviewViewOption,
  ToolbarPlacement,
} from './hosts/preview/preview';
export { SOURCE_EDITOR, type CodeMirrorContext, type CodeMirrorSelector, type SourceEditorContributions } from './hosts/source-editor/source-editor';
export type {
  ToolbarAction,
  Anchor,
  CompletionContext,
  CompletionItem,
  CompletionItemProvider,
  CompletionTrigger,
  RawBoxPicture,
  RawBoxPictureHost,
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
} from './hosts/visual-editor/typst-conversion/typst-conversion';
export { VISUAL_EDITOR, insertTypst, setRawBoxDecorations } from './hosts/visual-editor/visual-editor';
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

// Importing the package makes <zwiebelfisch-editor> available (no-op without a DOM).
defineEditorElement();
