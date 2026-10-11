import { Disposable } from '../../core/disposable/disposable';
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
 * Links around the shown file that lead to other files. "← previous file" / "next file →" sit above and below a file
 * the main file includes, in its reading order. "← Back to …" / "Forward to … →" sit above a supplementary file (a
 * diagram, a spreadsheet, …) and lead through the files the user came from (VS Code's Go Back / Go Forward); their
 * keys work in every file.
 *
 * Both are one extension because they share the editor frame (one per widget) and the bar's look. Neither needs the
 * file panel, so a host may keep them without it.
 *
 * The history listens to the shown file, not to the ways of opening one (links, the preview, the file panel, …).
 * Every way ends in `workbench.open`, so every change of the shown file counts, as in VS Code, and no feature needs to
 * know about the history. See docs/20_features/24_multi-file-projects.typ.
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
      let typing: ReturnType<typeof setTimeout> | undefined;
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
          // typing rarely changes the reading order (an #include written): shown again once it pauses
          clearTimeout(typing);
          if (change.kind === 'update') typing = setTimeout(show, READING_ORDER_DELAY_MS);
          else show();
        }),
        new Disposable(() => clearTimeout(typing)),
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

/** How long typing pauses before the reading order is looked up again. */
const READING_ORDER_DELAY_MS = 300;

/** Goes back to the file shown before (with its editor and selection), if any. */
const BACK = 'fileNavigation.back';
/** Goes forward again, after going back. */
const FORWARD = 'fileNavigation.forward';
