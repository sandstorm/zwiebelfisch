import { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';
import { keyLabel } from '../../hosts/commands/commands';
import type { ExtensionContext, SidePanel, TypstExtension } from '../../hosts/workbench/workbench';
import { SearchResults } from './model/search-results';
import css from './search.css?inline';
import { type FindOptions, SearchPanel } from './workbench/search-panel';

/**
 * "Find in files": the left side panel (the magnifier on the rail, after Files) that finds every occurrence of a text
 * or regular expression in the Typst source of the project's files and in its text files (those with a declared
 * language), listed by file and line. A match picked in a Typst file opens in the editor shown now (Visual or Source:
 * the one the user chose last), selected; one in a text file opens that file. The panel lying over a narrow widget's
 * editing area closes then.
 *
 * The command `workbench.action.findInFiles` (⌘⇧F) shows the panel and searches. It takes VS Code's arguments
 * (`query`, `isRegex`, `isCaseSensitive`, `matchWholeWord`); without a query it starts from the selection of the shown
 * Typst editor (its source text, one line), else from the query the panel has.
 *
 * The matching (model/text-query.ts) and the results that follow the files' changes (model/search-results.ts) are
 * pure; the view (workbench/search-panel.ts) gets them through its options, so it is tested without a workbench.
 */
export function search(): TypstExtension {
  return {
    id: 'search',
    contributes: { commands: [{ command: FIND_IN_FILES, title: 'Find in files' }], keybindings: [{ command: FIND_IN_FILES, key: FIND_KEY }] },
    activate(context) {
      const { project, languages, workbench, commands, subscriptions } = context;
      const side = workbench.registerSidePanel('search', { label: 'Find in files', icon: magnifier(workbench.ownerDocument), order: 12 });
      const panel = new SearchPanel(side.body, {
        search: (query) => new SearchResults({ project, query, scope: { kind: 'project' }, isTextFile: (path) => languages.getLanguageId(path) !== undefined }),
        open: (path, match) => {
          workbench.open(path, ProjectPath.isTypst(path) ? { selection: SourceRange.of(match) } : {});
          side.dismiss();
        },
        keys: [
          { label: 'Find in files', key: keyLabel(FIND_KEY) },
          { label: 'Search everywhere', key: 'Shift Shift' },
        ],
      });
      subscriptions.push(
        workbench.registerStyleSheet(css),
        side,
        panel,
        commands.registerCommand(FIND_IN_FILES, (options?: FindOptions) => findInFiles(context, side, panel, options)),
      );
    },
  };
}

const FIND_IN_FILES = 'workbench.action.findInFiles';
const FIND_KEY = 'Mod+Shift+KeyF';

/** Shows the panel and searches for `options`, or (with no query given) for the selection of the shown Typst editor. */
function findInFiles({ window }: ExtensionContext, side: SidePanel, panel: SearchPanel, options: FindOptions = {}): void {
  const editor = window.activeTextEditor;
  const selected = editor ? editor.document.text.slice(editor.selection.from, editor.selection.to) : '';
  const seed = selected && !selected.includes('\n') ? { query: selected } : {};
  side.show(true);
  panel.find({ ...seed, ...options });
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
