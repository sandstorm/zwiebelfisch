import { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';
import { keyLabel } from '../../hosts/commands/commands';
import type { ExtensionContext, SidePanel, TypstExtension } from '../../hosts/workbench/workbench';
import { Replacement } from './model/replace';
import { SearchResults } from './model/search-results';
import css from './search.css?inline';
import { MatchHighlights } from './workbench/match-highlights';
import { type FindOptions, type Mode, SearchPanel } from './workbench/search-panel';

/**
 * "Find in files": the left side panel (the magnifier on the rail, after Files) that finds every occurrence of a text
 * or regular expression in the Typst source of the project's files and in its text files (those with a declared
 * language), listed by file and line. A match picked in a Typst file opens in the editor shown now (Visual or Source:
 * the one the user chose last), selected; one in a text file opens that file. The panel lying over a narrow widget's
 * editing area closes then.
 *
 * It searches the whole project, the current file (the one shown, as it changes) or a folder and its subfolders. While
 * shown it follows every change of the files, and the Visual and Source editors highlight every match it lists, the
 * one its list is on emphasised; hidden, it drops its results (and the highlights) and searches again when shown. A
 * match inside a raw box (math, code Visual does not model) opens in the box's code, selected there.
 *
 * In Replace mode it replaces a match, a file's matches or all of them (all confirmed when that is more than one
 * file or many matches): in a Typst file as exact edits, shared with the others as they are, in a text file through
 * `workspace.applyEdit`. A match whose text changed since it was found is left. The panel's Undo takes back the last
 * replace in all its files at once, also in files no editor shows; an editor's own undo stays the user's typing.
 *
 * The commands `workbench.action.findInFiles` (⌘⇧F) and `workbench.action.replaceInFiles` (⌘⇧H; the Visual editor's
 * Highlight mark has no key therefore) show the panel in their mode and search. They take VS Code's arguments
 * (`query`, `replace`, `isRegex`, `isCaseSensitive`, `matchWholeWord`); without a query they start from the selection
 * of the shown Typst editor (its source text, one line) unless the panel has the focus, else from the query the panel
 * has. `search.findInFolder` (the file panel's "Find in folder…" on a folder's row, `explorer/context`) does the same
 * in that folder.
 *
 * The matching (model/text-query.ts), the results that follow the files' changes (model/search-results.ts) and a
 * replace with its undo (model/replace.ts) are pure; the view (workbench/search-panel.ts) gets them through its
 * options, so it is tested without a workbench.
 */
export function search(): TypstExtension {
  return {
    id: 'search',
    // search.findInFolder needs a folder: offered on the file panel's rows only, not in command search
    contributes: {
      commands: [
        { command: FIND_IN_FILES, title: 'Find in files' },
        { command: REPLACE_IN_FILES, title: 'Replace in files' },
      ],
      keybindings: [
        { command: FIND_IN_FILES, key: FIND_KEY },
        { command: REPLACE_IN_FILES, key: REPLACE_KEY },
      ],
    },
    activate(context) {
      const { project, languages, workspace, workbench, commands, visualEditor, sourceEditor, globalState, subscriptions } = context;
      const side = workbench.registerSidePanel('search', { label: 'Find in files', icon: magnifier(workbench.ownerDocument), order: 12 });
      const highlights = new MatchHighlights(project);
      const panel = new SearchPanel(side.body, {
        search: (query, scope) => new SearchResults({ project, query, scope, isTextFile: (path) => languages.getLanguageId(path) !== undefined }),
        open: (path, match) => {
          workbench.open(path, ProjectPath.isTypst(path) ? { selection: SourceRange.of(match) } : {});
          side.dismiss();
        },
        view: side,
        window: context.window,
        highlights,
        replace: (query, files, replace) => Replacement.apply({ project, applyEdit: (change) => workspace.applyEdit(change) }, query, files, replace),
        confirm: async (message, action) => (await context.window.showWarningMessage(message, action)) === action,
        state: globalState,
        keys: [
          { label: 'Find in files', key: keyLabel(FIND_KEY) },
          { label: 'Replace in files', key: keyLabel(REPLACE_KEY) },
          { label: 'Search everywhere', key: 'Shift Shift' },
        ],
      });
      subscriptions.push(
        workbench.registerStyleSheet(css),
        side,
        panel,
        highlights,
        visualEditor.registerHighlights('search', highlights.visualHighlights),
        sourceEditor.registerCodeMirrorExtension(highlights.sourceExtension),
        commands.registerCommand(FIND_IN_FILES, (options?: FindOptions) => findInFiles(context, side, panel, { ...options, mode: 'find' })),
        commands.registerCommand(REPLACE_IN_FILES, (options?: FindOptions) => findInFiles(context, side, panel, { ...options, mode: 'replace' })),
        commands.registerCommand(FIND_IN_FOLDER, (folder: ProjectPath) => {
          side.show(true);
          panel.find({}, { scope: { kind: 'folder', path: folder } });
        }),
        workbench.registerMenuItem('explorer/context', { command: FIND_IN_FOLDER, title: 'Find in folder…', group: 'search', when: (menu) => menu.resourceKind === 'folder' }),
      );
    },
  };
}

const FIND_IN_FILES = 'workbench.action.findInFiles';
const REPLACE_IN_FILES = 'workbench.action.replaceInFiles';
const FIND_IN_FOLDER = 'search.findInFolder';
const FIND_KEY = 'Mod+Shift+KeyF';
const REPLACE_KEY = 'Mod+Shift+KeyH';

/**
 * Shows the panel in `mode` and searches for `options`, or (with no query given) for the selection of the shown Typst
 * editor, unless the panel has the focus: there the key only switches the mode.
 */
function findInFiles({ window }: ExtensionContext, side: SidePanel, panel: SearchPanel, { mode, ...options }: FindOptions & { mode: Mode }): void {
  const editor = side.body.contains(side.body.ownerDocument.activeElement) ? undefined : window.activeTextEditor;
  const selected = editor ? editor.document.text.slice(editor.selection.from, editor.selection.to) : '';
  const seed = selected && !selected.includes('\n') ? { query: selected } : {};
  side.show(true);
  panel.find({ ...seed, ...options }, { mode });
}

/** The rail button's icon: a magnifier. */
function magnifier(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3.5 3.5"/>';
  return svg;
}
