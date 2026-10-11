// The commands in search everywhere: those the extensions declare (`contributes.commands`), by their titles. See
// WorkbenchHost in ../workbench.ts.
import type { SearchProvider } from '../../window/window';
import type { CommandContribution } from '../workbench';

/**
 * "Commands" (prefix `>`): every declared command that is registered, as "Category: Title"; picking one runs it
 * without arguments.
 */
export function commandSearch(options: CommandSearchOptions): SearchProvider {
  return {
    id: 'workbench.commands',
    label: 'Commands',
    prefix: '>',
    order: 40,
    provideItems: () =>
      options
        .declared()
        .filter(({ command }) => options.isRegistered(command))
        .map(({ command, title, category }) => ({
          label: category ? `${category}: ${title}` : title,
          accept: () => options.executeCommand(command),
        })),
  };
}

/** What the command search needs: the declared commands, which are registered now, and how one runs. */
export interface CommandSearchOptions {
  declared(): readonly CommandContribution[];
  isRegistered(command: string): boolean;
  executeCommand(command: string): Promise<unknown>;
}
