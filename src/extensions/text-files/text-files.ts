// The text-files extension: the project's text files Typst reads (data: CSV, JSON, YAML, TOML, XML; bibliographies;
// plain text and Markdown) open editable in plain CodeMirror, saved as they change. Entry of extensions/text-files/.
// See docs/guide/features.typ.
// Why an extension: the editor is a custom editor (the window's contribution point), its saves file updates through
// `workspace.applyEdit`; what a text file is, is decided here, by name.
import { ProjectPath } from '../../core/paths/paths';
import type { FileContent } from '../../core/project/project';
import type { CustomEditorProvider } from '../../hosts/window/window';
import type { ExtensionContext, TypstExtension } from '../../hosts/workbench/workbench';
import css from './text-files.css?inline';
import { TextFileEditor } from './workbench/text-file-editor';

/** The files it opens: those Typst reads as text (`csv`, `json`, `yaml`, `toml`, `xml`, `read`, `bibliography`). */
const TEXT_FILES = '*.{csv,json,yaml,yml,toml,xml,bib,txt,md}';
/** The icon of text files (where views list files). */
const TEXT_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6 8h5M6 10.5h5M6 13h3"/></svg>';

/**
 * Text files (`*.{csv,json,yaml,yml,toml,xml,bib,txt,md}`) in the editing area: the custom editor `textFiles.editor`,
 * plain CodeMirror (no highlighting). The whole text is saved as an `update` (`workspace.applyEdit`) 800 ms after the
 * last edit, and when the file is closed; a refusal is an error message. Changes made elsewhere (another user, the
 * host) show up in the open editor unless an edit of its own waits to be saved. Collaboration: whole files, the last
 * save wins (no merge of concurrent typing).
 */
export function textFiles(): TypstExtension {
  return {
    id: 'text-files',
    activate(context) {
      const { window, workbench, subscriptions } = context;
      subscriptions.push(
        workbench.registerStyleSheet(css),
        window.registerCustomEditorProvider('textFiles.editor', textFileEditor(context), { filenamePattern: TEXT_FILES, icon: TEXT_ICON }),
      );
    },
  };
}

/** A TextFileEditor per opened file, saving into the project and following the file's changes from elsewhere. */
function textFileEditor({ project, window, workspace }: ExtensionContext): CustomEditorProvider {
  return {
    resolveCustomEditor({ path, content }, panel) {
      const editor = new TextFileEditor(panel.element, {
        path,
        text: text(content),
        save: (saved) =>
          void workspace.applyEdit({ kind: 'update', path, content: saved }).then((problem) => problem && window.showErrorMessage(`${ProjectPath.displayName(path)} not saved: ${problem}`)),
      });
      const changes = project.onDidChangeFile((change) => {
        if (change.kind === 'update' && change.path === path) editor.reload(text(change.content));
      });
      panel.onDidDispose(() => {
        changes.dispose();
        editor.dispose();
      });
    },
  };
}

/** A file's content as text: bytes (uploaded, or from a collaboration room) are UTF-8. */
function text(content: FileContent): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}
