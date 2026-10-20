// The settings in search everywhere: switch a boolean, pick one of an enum's values. See searchEverywhere in
// ../search-everywhere.ts.
import type { QuickPickItem, SearchItem, SearchProvider, WindowApi } from '../../../hosts/window/window';
import type { ConfigurationProperty, Workspace } from '../../../hosts/extension-host/workspace/workspace';

/**
 * "Settings" (prefix `:`): every boolean setting (picking switches it) and every setting with an `enum` (picking
 * offers its values in a second quick pick), as "Section: Key" with the value now and the description.
 */
export function settingSearch(options: SettingSearchOptions): SearchProvider {
  return {
    id: 'search-everywhere.settings',
    label: 'Settings',
    prefix: ':',
    order: 70,
    provideItems: () => [...options.workspace.getConfigurationProperties()].flatMap(([id, property]) => settingItem(id, property, options) ?? []),
  };
}

/** What the setting search needs: the declared settings and their values (to change one, too), and a quick pick. */
export interface SettingSearchOptions {
  readonly workspace: Pick<Workspace, 'getConfiguration' | 'getConfigurationProperties'>;
  readonly window: Pick<WindowApi, 'showQuickPick'>;
}

function settingItem(id: string, property: ConfigurationProperty, options: SettingSearchOptions): SearchItem | null {
  const value = options.workspace.getConfiguration().get(id);
  const item = { label: title(id), description: describe(value), detail: property.description };
  if (property.type === 'boolean') return { ...item, accept: () => options.workspace.getConfiguration().update(id, !value) };
  if (!property.enum) return null;
  return { ...item, accept: () => pickValue(id, property.enum!, options) };
}

/** `workbench.rightSidePanel` → "Workbench: Right Side Panel" (as VS Code titles settings). */
function title(id: string): string {
  const words = (part: string) => part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ ([a-z])/g, (_, c: string) => ` ${c.toUpperCase()}`);
  const dot = id.lastIndexOf('.');
  return dot < 0 ? words(id) : `${words(id.slice(0, dot))}: ${words(id.slice(dot + 1))}`;
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Offers `values` (the one now marked), and sets the one picked. */
async function pickValue(id: string, values: readonly unknown[], { workspace, window }: SettingSearchOptions): Promise<void> {
  const now = workspace.getConfiguration().get(id);
  const items: (QuickPickItem & { value: unknown })[] = values.map((choice) => ({ label: describe(choice), description: choice === now ? 'current' : undefined, value: choice }));
  const picked = await window.showQuickPick(items, { title: title(id), placeHolder: 'Pick a value' });
  if (picked && picked.value !== now) await workspace.getConfiguration().update(id, picked.value);
}
