import type { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';
import type { Commands } from '../../hosts/commands/commands';
import type { SearchProvider } from '../../hosts/window/window';
import type { ExtensionContext, SidePanel, Extension } from '../../hosts/workbench/workbench';
import { Replacement } from './model/replace';
import { SearchResults } from './model/search-results';
import css from './search.css?inline';
import { MatchHighlights } from './workbench/match-highlights';
import { type FindOptions, type Mode, SearchPanel } from './workbench/search-panel';

/**
 * "Find in files": a side panel that finds and replaces a text or regular expression in the project's Typst files and
 * text files, in the whole project, the current file or a folder. It is opened by:
 * - `workbench.action.findInFiles` (⌘⇧F) and `workbench.action.replaceInFiles` (⌘⇧H), with VS Code's arguments; without
 *   a query they search for the selection of the shown editor
 * - `search.findInFolder`, the file panel's "Find in folder…"
 * - search everywhere's row "Find in files: ‹query›"
 * - Alt+3 (⌃3 on the Mac), as it is
 *
 * While shown, its matches follow every change of the files and are highlighted in the Visual and Source editors. A
 * picked match opens selected. A match whose text changed since it was found is not replaced; the panel's Undo takes
 * back the last replace in all its files at once.
 */
export function search(): Extension {
  return {
    id: 'search',
    // search.findInFolder needs a folder: offered on the file panel's rows only, not in command search
    contributes: {
      commands: [
        { command: FIND_IN_FILES, title: 'Find in files' },
        { command: REPLACE_IN_FILES, title: 'Replace in files' },
      ],
      keybindings: [
        { command: FIND_IN_FILES, key: 'Mod+Shift+KeyF' },
        { command: REPLACE_IN_FILES, key: 'Mod+Shift+KeyH' },
        // as the file panel's Alt+1 / ⌃1 (IntelliJ's 3 for its Find window)
        { command: 'workbench.view.search', key: 'Alt+Digit3', mac: 'Ctrl+Digit3', linux: '' },
      ],
    },
    activate(context) {
      const { project, languages, workspace, workbench, commands, visualEditor, sourceEditor, globalState, subscriptions } = context;
      const side = workbench.registerSidePanel('search', { label: 'Find in files', icon: magnifier(workbench.ownerDocument), order: 12 });
      const highlights = new MatchHighlights(project);
      const panel = new SearchPanel(side.body, {
        search: (query, scope) => new SearchResults({ project, query, scope, isTextFile: (path) => languages.getLanguageId(path) !== undefined }),
        open: (path, match) => {
          workbench.open(path, { selection: SourceRange.of(match) });
          side.dismiss();
        },
        view: side,
        window: context.window,
        highlights,
        replace: (query, files, replace) => Replacement.apply({ project, applyEdit: (change) => workspace.applyEdit(change) }, query, files, replace),
        confirm: async (message, action) => (await context.window.showWarningMessage(message, action)) === action,
        state: globalState,
        keys: [
          { label: 'Find in files', key: commands.keybindingLabel(FIND_IN_FILES) ?? '' },
          { label: 'Replace in files', key: commands.keybindingLabel(REPLACE_IN_FILES) ?? '' },
          { label: 'Search everywhere', key: 'Shift Shift' },
        ],
      });
      subscriptions.push(
        workbench.registerStyleSheet(css),
        side,
        panel,
        highlights,
        visualEditor.registerHighlightProvider(highlights.visualHighlights),
        sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, highlights.sourceExtension),
        commands.registerCommand(FIND_IN_FILES, (options?: FindOptions) => findInFiles(context, side, panel, { ...options, mode: 'find' })),
        commands.registerCommand(REPLACE_IN_FILES, (options?: FindOptions) => findInFiles(context, side, panel, { ...options, mode: 'replace' })),
        commands.registerCommand(FIND_IN_FOLDER, (folder: ProjectPath) => {
          side.show(true);
          panel.find({}, { scope: { kind: 'folder', path: folder } });
        }),
        workbench.registerMenuItem('explorer/context', { command: FIND_IN_FOLDER, title: 'Find in folder…', group: 'search', when: (menu) => menu.resourceKind === 'folder' }),
        context.window.registerSearchProvider(findInFilesRow(commands)),
      );
    },
  };
}

const FIND_IN_FILES = 'workbench.action.findInFiles';
const REPLACE_IN_FILES = 'workbench.action.replaceInFiles';
const FIND_IN_FOLDER = 'search.findInFolder';

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

/**
 * Search everywhere's way into the panel: a row "Find in files: ‹query›" after the group "Text" (prefix `%`, a
 * glance at the lines holding the query), which shows the panel with the query.
 */
function findInFilesRow(commands: Commands): SearchProvider {
  return {
    id: 'search.findInFiles',
    label: 'Find in files',
    prefix: '%',
    // right after "Text" (90)
    order: 91,
    provideItems: (query) =>
      query
        ? [{ label: `Find in files: ${query}`, highlights: {}, keybinding: commands.keybindingLabel(FIND_IN_FILES), accept: () => commands.executeCommand(FIND_IN_FILES, { query }) }]
        : [],
  };
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
