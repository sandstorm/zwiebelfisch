// The preview's view options in the View menu. See previewControls in ../preview-controls.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { Commands } from '../../../hosts/commands/commands';
import type { PreviewContributions, PreviewViewOption } from '../../../hosts/preview/preview';
import type { WindowApi } from '../../../hosts/window/window';
import type { Memento } from '../../../hosts/extension-host/extension-host';

/**
 * An entry per registered view option (page guides, box outlines, comments) in the View menu (menu `view`, group
 * `preview`), checked while the option is on. Choosing one turns the option over at once. Each option starts as this
 * viewer left it last time (kept in `state`), else at its default, also an option registered later.
 */
export function registerViewOptionsMenu({ preview, window, commands, state }: ViewOptionsMenuContext): Disposable {
  preview.setViewOptionValues(remembered(state));
  const entry = (option: PreviewViewOption, order: number): Disposable => {
    const command = `${TOGGLE}.${option.id}`;
    const on = () => remembered(state)[option.id] ?? option.default;
    return Disposable.from(
      commands.registerCommand(command, () => {
        const values = { ...remembered(state), [option.id]: !on() };
        void state.update(VALUES_KEY, values);
        preview.setViewOptionValues(values);
      }),
      window.registerMenuItem('view', { command, title: option.label, group: 'preview', order, toggled: on }),
    );
  };
  let entries = Disposable.from();
  const show = () => {
    entries.dispose();
    entries = Disposable.from(...preview.viewOptions().map(entry));
  };
  show();
  const subscription = preview.onDidChangeViewOptions(show);
  return new Disposable(() => {
    subscription.dispose();
    entries.dispose();
  });
}

export interface ViewOptionsMenuContext {
  readonly preview: Pick<PreviewContributions, 'viewOptions' | 'setViewOptionValues' | 'onDidChangeViewOptions'>;
  readonly window: Pick<WindowApi, 'registerMenuItem'>;
  readonly commands: Pick<Commands, 'registerCommand'>;
  /** Where this viewer's choices are kept (the extension's `globalState`). */
  readonly state: Memento;
}

/** The prefix of the entries' commands; the option's id follows. */
const TOGGLE = 'previewControls.toggleViewOption';

/** Where the viewer's choices are kept. */
const VALUES_KEY = 'viewOptions';

/** The values this viewer chose, read from storage: only booleans count. */
function remembered(state: Memento): Record<string, boolean> {
  const saved = state.get<unknown>(VALUES_KEY);
  if (typeof saved !== 'object' || saved === null) return {};
  return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
}
