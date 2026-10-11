// The file-navigation extension. Entry of extensions/file-navigation/. See docs/10_guide/02_features.typ.
import { neighbours } from '../../core/typst-syntax/typst-syntax';
import { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';
import type { TextEditor } from '../../hosts/window/window';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './file-navigation.css?inline';
import { type NavigationLocation, NavigationHistory } from './model/navigation-history';
import { FileNavigation } from './workbench/file-navigation';
import { HistoryLinks, KEYBINDINGS } from './workbench/history-links';

/**
 * The links around the shown file: previous / next file in reading order, back / forward in the files the user was in.
 *
 * The links around the shown file that lead to other files. "← previous file" / "next file →" above and below a file
 * the main file includes, in its reading order; "← Back to …" / "Forward to … →" above any file, the files the user
 * came from (VS Code's Go Back / Go Forward, also by key).
 *
 * Why one extension for both: they share the editor frame (one per widget) and the bar's look; neither needs the file
 * panel, so a host may keep them without it.
 *
 * Why the history listens to the shown file rather than to the ways of opening one (links, "Edit diagram", the preview,
 * the file panel, …): every way ends in `workbench.open`, so every change of the shown file counts, as in VS Code,
 * without any feature knowing about the history.
 */
export function fileNavigation(): TypstExtension {
  return {
    id: 'file-navigation',
    activate({ project, window, workbench, commands, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      const doc = workbench.ownerDocument;
      const readingOrder = new FileNavigation(doc, (path) => workbench.open(path));
      const history = new NavigationHistory(window.activeFile);
      // the file shown, and its Typst editor (read when the user leaves it: the editor keeps its selection while hidden)
      let shown: { path: ProjectPath; editor: TextEditor | null } = { path: window.activeFile, editor: window.activeTextEditor };
      let going = false;
      const here = (): NavigationLocation => {
        const { path, editor } = shown;
        if (!editor || !project.has(path)) return { path };
        return { path, viewType: editor.viewType, selection: editor.selection };
      };
      const go = (direction: 'back' | 'forward') => {
        const target = direction === 'back' ? history.goBack(here()) : history.goForward(here());
        if (!target) return;
        const selection = target.selection && within(target.selection, project.document(target.path)?.text);
        going = true;
        try {
          workbench.open(target.path, { viewType: target.viewType, selection });
        } finally {
          going = false;
        }
      };
      const links = new HistoryLinks(doc, go);
      const top = doc.createElement('div');
      top.className = 'typst-file-navigation__top';
      top.append(links.element, readingOrder.top);
      // recomputed on every open and every change: an #include may have been added, moved or removed
      const show = () => {
        readingOrder.show(neighbours((path) => project.document(path)?.text, project.main, window.activeFile));
        // the links only above supplementary files (a diagram, a spreadsheet, …): Typst files have the reading order;
        // the keys go back and forward everywhere
        const typst = ProjectPath.isTypst(window.activeFile);
        links.show(typst ? null : (history.back?.path ?? null), typst ? null : (history.forward?.path ?? null));
      };
      const opened = (path: ProjectPath) => {
        if (!going) history.open(here(), path);
        shown = { path, editor: window.activeTextEditor };
        show();
      };
      subscriptions.push(
        workbench.registerEditorFrame({ top, bottom: readingOrder.bottom }),
        window.onDidChangeActiveFile(opened),
        project.onDidChangeFile((change) => {
          history.followFileChange(change);
          show();
        }),
        commands.registerCommand(BACK, () => go('back')),
        commands.registerCommand(FORWARD, () => go('forward')),
        commands.registerKeybinding(KEYBINDINGS.forward, FORWARD),
        commands.registerKeybinding(KEYBINDINGS.back, BACK),
      );
      show();
    },
  };
}

/** `range` within a text of now (it may have become shorter since). */
function within(range: SourceRange, text: string | undefined): SourceRange | undefined {
  if (text === undefined) return undefined;
  return SourceRange.of({ from: Math.min(range.from, text.length), to: Math.min(range.to, text.length) });
}

/** Goes back to the file shown before (with its editor and selection), if any. */
const BACK = 'fileNavigation.back';
/** Goes forward again, after going back. */
const FORWARD = 'fileNavigation.forward';
