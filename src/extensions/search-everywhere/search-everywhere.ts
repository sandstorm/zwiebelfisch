import type { Extension } from '../../hosts/workbench/workbench';
import { commandSearch } from './workbench/command-search';
import { SearchPick } from './workbench/search-pick';
import { settingSearch } from './workbench/setting-search';

/**
 * Search everywhere: one quick pick over everything the search providers find (`window.registerSearchProvider`:
 * files, headings, labels, text, …), plus its own groups, the declared commands (`>`) and the settings (`:`). It
 * opens with:
 * - the command `workbench.action.searchEverywhere` (its argument: the text to start with, e.g. a prefix)
 * - double Shift anywhere in the widget (not in a text field), ⌘P; ⌘⇧O for files, ⌘⇧A for commands (as IntelliJ's)
 * - its button on the left rail, after Files (10), before Help (20)
 * Without it the providers' results are not shown anywhere.
 */
export function searchEverywhere(): Extension {
  return {
    id: 'search-everywhere',
    contributes: {
      keybindings: [
        // first: the key the rail button names
        { command: SEARCH_EVERYWHERE, key: 'Shift Shift' },
        { command: SEARCH_EVERYWHERE, key: 'Mod+KeyP' },
        { command: SEARCH_EVERYWHERE, key: 'Mod+Shift+KeyO', args: '/' },
        { command: SEARCH_EVERYWHERE, key: 'Mod+Shift+KeyA', args: '>' },
      ],
    },
    activate({ commands, window, workspace, subscriptions }) {
      const search = new SearchPick(window);
      subscriptions.push(
        search,
        commands.registerCommand(SEARCH_EVERYWHERE, (value?: unknown) => search.show(typeof value === 'string' ? value : '')),
        window.registerMenuItem('workbench/rail/left', { command: SEARCH_EVERYWHERE, title: 'Search everywhere', icon: SEARCH_ICON, order: 15 }),
        window.registerSearchProvider(commandSearch(commands)),
        window.registerSearchProvider(settingSearch({ workspace, window })),
      );
    },
  };
}

const SEARCH_EVERYWHERE = 'workbench.action.searchEverywhere';

/** The rail button: a field over a list. */
const SEARCH_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="5" rx="1.5"/><path d="M4 4h4M3 9.5h10M3 12h7M3 14.5h8.5"/></svg>';
