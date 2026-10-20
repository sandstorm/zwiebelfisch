// The read-only editor of a file no other editor opens (the custom editor `files.file`, pattern `*`): its name, size
// and type. See files in ../files.ts.
import type { CustomEditorProvider } from '../../../hosts/window/window';
import { ProjectPath } from '../../../core/paths/paths';
import { FileContent } from '../../../core/project/project';

/** Any other file in the editing area: what it is, without its content (fonts, archives, …). */
export const fileInfoEditor: CustomEditorProvider = {
  resolveCustomEditor({ path, content }, panel) {
    const doc = panel.element.ownerDocument;
    const root = doc.createElement('div');
    root.className = 'zwf-files__info';
    root.dataset.testid = 'zwf-file-info';
    const title = doc.createElement('h2');
    title.className = 'zwf-files__info-title';
    title.textContent = ProjectPath.displayName(path);
    const facts = doc.createElement('dl');
    facts.className = 'zwf-files__info-facts';
    for (const [term, value] of [['Size', formatSize(content)], ['Type', fileType(path)]]) {
      const dt = doc.createElement('dt');
      dt.textContent = term;
      const dd = doc.createElement('dd');
      dd.textContent = value;
      facts.append(dt, dd);
    }
    const note = doc.createElement('p');
    note.className = 'zwf-files__info-note';
    note.textContent = 'This file is used by the document but cannot be shown here.';
    root.append(title, facts, note);
    panel.element.append(root);
  },
};

function formatSize(content: FileContent): string {
  const bytes = FileContent.bytes(content).length;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The type as its ending says (`OTF file`), or just `File` without one. */
function fileType(path: ProjectPath): string {
  const extension = ProjectPath.extension(path);
  return extension ? `${extension.slice(1).toUpperCase()} file` : 'File';
}
