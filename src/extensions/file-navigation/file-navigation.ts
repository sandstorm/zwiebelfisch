// The file-navigation extension: "← previous file" / "next file →" above and below a file the main file includes, in
// its reading order. Entry of extensions/file-navigation/. See docs/guide/features.typ.
// Why an extension of its own: it shares nothing with the file panel but the project; a host may keep one without
// the other.
import { neighbours } from '../../core/typst-syntax/typst-syntax';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './file-navigation.css?inline';
import { FileNavigation } from './workbench/file-navigation';

/** "← previous file" / "next file →" above and below a file the main file includes, in its reading order. */
export function fileNavigation(): TypstExtension {
  return {
    id: 'file-navigation',
    activate({ project, workbench, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      const navigation = new FileNavigation(workbench.ownerDocument, (path) => workbench.open(path));
      // recomputed on every open and every change: an #include may have been added, moved or removed
      const show = () => navigation.show(neighbours((path) => project.document(path)?.text, project.main, workbench.activeFile));
      subscriptions.push(workbench.registerEditorFrame(navigation), workbench.onDidShowFile(show), project.onDidChangeFile(show));
    },
  };
}
