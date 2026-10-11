import { ProjectPath } from '../../core/paths/paths';
import type { FileContent } from '../../core/project/project';
import type { LanguageContribution } from '../../hosts/languages/languages';
import type { CustomEditorProvider } from '../../hosts/window/window';
import type { ExtensionContext, TypstExtension } from '../../hosts/workbench/workbench';
import css from './text-files.css?inline';
import { BIBTEX_HELP } from './workbench/bibtex-help';
import { TextFileEditor } from './workbench/text-file-editor';
import { textSearch } from './workbench/text-search';

/**
 * The text files a Typst project reads, editable: data (CSV, JSON, YAML, TOML, XML), bibliographies, plain text,
 * Markdown and Mermaid.
 *
 * The custom editor `textFiles.editor` (TextFileEditor) shows them in plain CodeMirror, with the document links of
 * each file's language and what is shared with every CodeMirror of the widget (`createSharedCodeMirrorExtension`:
 * shown whitespace), and saves the whole file a moment after the last edit. Where others edit it too (a GitLab room),
 * the last save wins: unlike Typst files, text files are not merged as they are typed. The extension also
 * declares their languages (`contributes.languages`: `.bib` is `bibtex`, `.mmd` is `mermaid`, …), adds the help
 * sheet "BibTeX", and gives search everywhere the group "Text": lines in these files and in the Typst files.
 *
 * Which files are text files is decided here, by their ending; the window and the workbench only offer the custom
 * editor and the saving (`workspace.applyEdit`). See docs/20_features/13_files.typ.
 */
export function textFiles(): TypstExtension {
  return {
    id: 'text-files',
    contributes: { languages: TEXT_LANGUAGES },
    activate(context) {
      const { project, window, workbench, languages, subscriptions } = context;
      const editors = new Map<ProjectPath, TextFileEditor>();
      subscriptions.push(
        workbench.registerStyleSheet(css),
        window.registerCustomEditorProvider('textFiles.editor', textFileEditor(context, editors), { filenamePattern: TEXT_FILES, displayName: 'Text', icon: TEXT_ICON }),
        languages.registerHelpProvider({ language: 'bibtex' }, { provideHelp: () => BIBTEX_HELP }),
        window.registerSearchProvider(
          textSearch({
            project,
            workbench,
            isTextFile: (path) => isTextFile(path),
            reveal: (path, from, to) => editors.get(path)?.reveal(from, to),
          }),
        ),
      );
    },
  };
}

/** A TextFileEditor per opened file (kept in `editors` while open), saving into the project and following the file's changes from elsewhere. */
function textFileEditor({ project, window, workspace, languages, sourceEditor }: ExtensionContext, editors: Map<ProjectPath, TextFileEditor>): CustomEditorProvider {
  return {
    resolveCustomEditor({ path, content }, panel) {
      const editor = new TextFileEditor(panel.element, {
        path,
        text: text(content),
        extensions: [
          languages.createDocumentLinksCodeMirrorExtension(languages.getLanguageId(path) ?? 'plaintext', () => path),
          sourceEditor.createSharedCodeMirrorExtension(),
        ],
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

/** Whether `path` is a file it opens (by ending). */
function isTextFile(path: ProjectPath): boolean {
  const ending = ProjectPath.extension(path).toLowerCase();
  return TEXT_LANGUAGES.some((language) => language.extensions.includes(ending));
}

/**
 * The files it opens, by language (VS Code's language ids) and ending, declared for `languages.getLanguageId`: those
 * Typst reads as text (`csv`, `json`, `yaml`, `toml`, `xml`, `read`, `bibliography`; `.mmd` Mermaid).
 */
const TEXT_LANGUAGES: readonly LanguageContribution[] = [
  { id: 'csv', extensions: ['.csv'] },
  { id: 'json', extensions: ['.json'] },
  { id: 'yaml', extensions: ['.yaml', '.yml'] },
  { id: 'toml', extensions: ['.toml'] },
  { id: 'xml', extensions: ['.xml'] },
  { id: 'bibtex', extensions: ['.bib'] },
  { id: 'plaintext', extensions: ['.txt'] },
  { id: 'markdown', extensions: ['.md'] },
  { id: 'mermaid', extensions: ['.mmd'] },
];
const TEXT_FILES = `*.{${TEXT_LANGUAGES.flatMap((language) => language.extensions.map((ending) => ending.slice(1))).join(',')}}`;
/** The icon of text files (where side panels list files). */
const TEXT_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6 8h5M6 10.5h5M6 13h3"/></svg>';
