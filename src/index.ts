// The package's public API: createTypstEditor and <typst-editor> (registered on import). See ARCHITECTURE.md.
import { defineTypstEditorElement } from './typst-editor-element';

export {
  createTypstEditor,
  type CollaborationOptions,
  type EditorMode,
  type FileChange,
  type FileContent,
  type FileListMode,
  type Theme,
  type PdfExportOptions,
  type ProjectFiles,
  type TypstEditor,
  type TypstEditorOptions,
} from './typst-editor';
export type { ProjectPath } from './core/paths/paths';
export {
  TypstEditorElement,
  defineTypstEditorElement,
  type TypstEditorChangeDetail,
} from './typst-editor-element';

// Importing the package makes <typst-editor> available (no-op without a DOM).
defineTypstEditorElement();
