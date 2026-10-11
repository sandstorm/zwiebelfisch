// The preview's view options in the View menu. See previewControls in ../preview-controls.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { Commands } from '../../../hosts/commands/commands';
import type { PreviewContributions, PreviewViewOption } from '../../../hosts/preview/preview';
import type { Memento, Workbench } from '../../../hosts/workbench/workbench';

/**
 * An entry per registered view option (page guides, box outlines, comments) in the View menu (menu `view`, group
 * `preview`, in the order the preview applies them), checked while the option is on: as this viewer left it last time
 * (kept in `state`), else its default. Choosing it turns the option over at once and remembers that. Each entry runs a
 * command of its own (`previewControls.toggleViewOption.<option id>`). The entries follow the options as they are
 * registered and go. The values this viewer chose are handed to the preview at once, also for options registered later.
 */
export function registerViewOptionsMenu({ preview, workbench, commands, state }: ViewOptionsMenuContext): Disposable {
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
      workbench.registerMenuItem('view', { command, title: option.label, group: 'preview', order, toggled: on }),
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
  readonly workbench: Pick<Workbench, 'registerMenuItem'>;
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
