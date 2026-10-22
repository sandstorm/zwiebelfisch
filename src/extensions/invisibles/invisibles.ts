import { highlightWhitespace } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { Memento, Extension } from '../../hosts/extension-host/extension-host';
import type { Workspace } from '../../hosts/extension-host/workspace/workspace';
import css from './invisibles.css?inline';
import { invisibleMarks } from './visual-editor/invisible-marks';

/**
 * Invisible characters, shown on demand ("Show formatting marks", VS Code's "Render Whitespace").
 * - in the Visual editor: · for a space, ° for a non-breaking space (`~`), → for a tab, ↵ for a line break (`\`), ¶ at
 *   the end of each paragraph
 * - in every CodeMirror (Source editors, raw boxes, text files): CodeMirror's `highlightWhitespace`
 *
 * The marks are never part of the text: not selectable, not copied. They start as the setting `invisibles.show` says,
 * else as this viewer chose last, else off. The command `invisibles.toggle` (also "Invisible characters" in the View
 * menu) turns them on or off.
 */
export function invisibles(): Extension {
  return {
    id: 'invisibles',
    contributes,
    activate({ commands, window, workspace, globalState, visualEditor, sourceEditor, subscriptions }) {
      let shown = configuredShown(workspace, globalState);
      const changed = new EventEmitter<boolean>();
      let codeMirror: Disposable | null = null;
      const show = (on: boolean) => {
        shown = on;
        codeMirror?.dispose();
        codeMirror = on ? sourceEditor.registerCodeMirrorExtension({}, highlightWhitespace()) : null;
        changed.fire(on);
      };
      show(shown);
      subscriptions.push(
        window.registerStyleSheet(css),
        window.registerMenuItem('window/view', { command: TOGGLE, title: 'Invisible characters', group: 'editor', toggled: () => shown }),
        visualEditor.registerTiptapExtension(invisibleMarks({ shown: () => shown, onDidChange: changed.event })),
        commands.registerCommand(TOGGLE, () => {
          void globalState.update(SHOWN_KEY, !shown);
          show(!shown);
        }),
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('invisibles.show')) show(configuredShown(workspace, globalState));
        }),
        new Disposable(() => {
          codeMirror?.dispose();
          changed.dispose();
        }),
      );
    },
  };
}

/** Shows or hides the invisible characters in every editor (the viewer's choice, kept for later visits). */
export const TOGGLE = 'invisibles.toggle';

/** Its setting `invisibles.show` and its command. */
const contributes: Extension['contributes'] = {
  configuration: {
    properties: {
      'invisibles.show': {
        type: 'boolean',
        default: false,
        description:
          'Whether the editors show invisible characters (spaces, non-breaking spaces, tabs, line breaks, paragraph ends). Unset: what this viewer chose last (kept across visits), else `false`.',
      },
    },
  },
  commands: [{ command: TOGGLE, title: 'Show invisible characters on / off' }],
};

/** The host's value of `invisibles.show`, else the viewer's last choice, else the default (off). */
function configuredShown(workspace: Workspace, globalState: Memento): boolean {
  const setting = workspace.getConfiguration('invisibles').inspect<boolean>('show');
  const chosen = globalState.get<unknown>(SHOWN_KEY);
  return setting?.globalValue ?? (typeof chosen === 'boolean' ? chosen : undefined) ?? setting?.defaultValue ?? false;
}

/** Where the viewer's last choice is kept (`globalState`). */
const SHOWN_KEY = 'show';
