// The text-files extension. Entry of extensions/text-files/. See docs/10_guide/02_features.typ.
import { ProjectPath } from '../../core/paths/paths';
import type { FileContent } from '../../core/project/project';
import type { CustomEditorProvider } from '../../hosts/window/window';
import type { ExtensionContext, TypstExtension } from '../../hosts/workbench/workbench';
import css from './text-files.css?inline';
import { TextFileEditor } from './workbench/text-file-editor';
import { textSearch } from './workbench/text-search';

/**
 * Text files (`*.{csv,json,yaml,yml,toml,xml,bib,txt,md,mmd}`) in the editing area: the custom editor `textFiles.editor`,
 * plain CodeMirror (no highlighting; the document links of the providers for its language). The whole text is saved
 * as an `update` (`workspace.applyEdit`) 800 ms after the last edit, and when the file is closed; a refusal is an
 * error message. Changes made elsewhere (another user, the
 * host) show up in the open editor unless an edit of its own waits to be saved. Collaboration: whole files, the last
 * save wins (no merge of concurrent typing). Search everywhere's "Text" finds lines in these and the Typst files.
 *
 * The project's text files Typst reads (data: CSV, JSON, YAML, TOML, XML; bibliographies; plain text, Markdown and
 * Mermaid) open editable in plain CodeMirror, saved as they change; and search everywhere's text search over them and
 * the Typst files.
 *
 * Why an extension: the editor is a custom editor (the window's contribution point), its saves file updates through
 * `workspace.applyEdit`; what a text file is, is decided here, by name.
 */
export function textFiles(): TypstExtension {
  return {
    id: 'text-files',
    activate(context) {
      const { project, window, workbench, subscriptions } = context;
      const editors = new Map<ProjectPath, TextFileEditor>();
      subscriptions.push(
        workbench.registerStyleSheet(css),
        window.registerCustomEditorProvider('textFiles.editor', textFileEditor(context, editors), { filenamePattern: TEXT_FILES, displayName: 'Text', icon: TEXT_ICON }),
        window.registerSearchProvider(
          textSearch({
            project,
            workbench,
            isTextFile: (path) => languageOf(path) !== undefined,
            reveal: (path, from, to) => editors.get(path)?.reveal(from, to),
          }),
        ),
      );
    },
  };
}

/** A TextFileEditor per opened file (kept in `editors` while open), saving into the project and following the file's changes from elsewhere. */
function textFileEditor({ project, window, workspace, languages }: ExtensionContext, editors: Map<ProjectPath, TextFileEditor>): CustomEditorProvider {
  return {
    resolveCustomEditor({ path, content }, panel) {
      const editor = new TextFileEditor(panel.element, {
        path,
        text: text(content),
        extensions: languages.createDocumentLinksCodeMirrorExtension(languageOf(path) ?? 'plaintext', () => path),
        save: (saved) =>
          void workspace.applyEdit({ kind: 'update', path, content: saved }).then((problem) => problem && window.showErrorMessage(`${ProjectPath.displayName(path)} not saved: ${problem}`)),
      });
      editors.set(path, editor);
      const changes = project.onDidChangeFile((change) => {
        if (change.kind === 'update' && change.path === path) editor.reload(text(change.content));
      });
      panel.onDidDispose(() => {
        changes.dispose();
        if (editors.get(path) === editor) editors.delete(path);
        editor.dispose();
      });
    },
  };
}

/** A file's content as text: bytes (uploaded, or from a collaboration room) are UTF-8. */
function text(content: FileContent): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

/** The language of a text file by its ending (undefined: not a text file). */
function languageOf(path: ProjectPath): string | undefined {
  return LANGUAGES[ProjectPath.extension(path).slice(1).toLowerCase()];
}

/**
 * The endings of the files it opens, and their language (VS Code's language ids): those Typst reads as text (`csv`,
 * `json`, `yaml`, `toml`, `xml`, `read`, `bibliography`; `.mmd` Mermaid).
 */
const LANGUAGES: Readonly<Record<string, string>> = {
  csv: 'csv',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  bib: 'bibtex',
  txt: 'plaintext',
  md: 'markdown',
  mmd: 'mermaid',
};
const TEXT_FILES = `*.{${Object.keys(LANGUAGES).join(',')}}`;
/** The icon of text files (where views list files). */
const TEXT_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6 8h5M6 10.5h5M6 13h3"/></svg>';
