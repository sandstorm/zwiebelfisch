// The package's public API: createTypstEditor, <typst-editor> (registered on import), and what writing an extension
// takes: the types an extension implements or declares (everything else it reaches through its ExtensionContext is
// typed without importing), Disposable and EventEmitter, and the collaboration extension, which a host adds with its
// connection. The only file that re-exports. See ARCHITECTURE.md and docs/embedding.md.
import { defineTypstEditorElement } from './typst-editor-element/typst-editor-element';

export { createTypstEditor, type PdfExportOptions, type TypstEditor, type TypstEditorOptions } from './typst-editor/typst-editor';
export { TypstEditorElement, defineTypstEditorElement, type TypstEditorChangeDetail } from './typst-editor-element/typst-editor-element';
export type { FileChange, FileContent, ProjectFiles } from './core/project/project';
export type { ProjectPath } from './core/paths/paths';
export type { PdfEntry } from './core/typst-engine/typst-engine';
export { Disposable } from './core/disposable/disposable';
export { EventEmitter, type Event } from './core/event-emitter/event-emitter';
export type {
  Command,
  ConfigurationChangeEvent,
  ConfigurationProperty,
  CustomDocument,
  CustomEditorOptions,
  CustomEditorPanel,
  CustomEditorProvider,
  DocumentLink,
  DocumentLinkProvider,
  EditorMode,
  ExtensionContext,
  ExtensionContributions,
  FileDecoration,
  FileDecorationProvider,
  InputBoxOptions,
  MenuContext,
  MenuItem,
  MessageItem,
  MessageSeverity,
  OpenOptions,
  QuickPickItem,
  QuickPickOptions,
  Settings,
  SourceControl,
  SourceControlState,
  SourceControlStatus,
  StatusBarPlacement,
  TextDocument,
  TypstExtension,
  User,
  Workbench,
  Workspace,
  WorkspaceConfiguration,
} from './hosts/workbench/workbench';
export type { PdfExportOption, PreviewContributions, PreviewToolbarItem, ToolbarPlacement } from './hosts/preview/preview';
export type { SourceViewContributions } from './hosts/source-view/source-view';
export type { VisualViewContributions } from './hosts/visual-view/visual-view';
export { collaboration, type CollaborationOptions } from './extensions/collaboration/collaboration';

// Importing the package makes <typst-editor> available (no-op without a DOM).
defineTypstEditorElement();
