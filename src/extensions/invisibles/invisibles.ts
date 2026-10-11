import { highlightWhitespace } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { Memento, TypstExtension } from '../../hosts/workbench/workbench';
import type { Workspace } from '../../hosts/workspace/workspace';
import css from './invisibles.css?inline';
import { invisibleMarks } from './visual-editor/invisible-marks';

/**
 * Invisible characters, shown on demand, as word processors' "Show formatting marks" and VS Code's "Render
 * Whitespace": in the Visual editor · for a space, ° for a non-breaking space (Typst `~`), → for a tab, ↵ for a line
 * break (`\`) and ¶ at the end of each paragraph; in every CodeMirror (Source editors, raw boxes, text files)
 * CodeMirror's own `highlightWhitespace`.
 *
 * The marks are decorations drawn by CSS: never part of the text, not selectable, not copied. The Visual editor's are
 * worked out once when they are turned on, then only for the paragraphs an edit touches (`invisibleMarks`); CodeMirror
 * draws its marks for the lines in view. The CodeMirrors get them through the Source editor host's shared extensions,
 * registered while the marks are on.
 *
 * They start as the setting `invisibles.show` says, else as this viewer chose last (`globalState`), else off. The
 * command `invisibles.toggle` turns them on or off, from search everywhere or the button in the editor's tab bar.
 * See docs/10_guide/02_features.typ, "Invisible characters".
 */
export function invisibles(): TypstExtension {
  return {
    id: 'invisibles',
    contributes,
    activate({ commands, workbench, workspace, globalState, visualEditor, sourceEditor, subscriptions }) {
      let shown = configuredShown(workspace, globalState);
      const changed = new EventEmitter<boolean>();
      let codeMirror: Disposable | null = null;
      let button: Disposable | null = null;
      const show = (on: boolean) => {
        shown = on;
        codeMirror?.dispose();
        codeMirror = on ? sourceEditor.registerSharedCodeMirrorExtension(highlightWhitespace()) : null;
        // made anew to say what it does now; its place stays (group + order)
        button?.dispose();
        button = workbench.registerMenuItem('editor/title', { command: TOGGLE, title: on ? 'Hide invisibles' : 'Show invisibles', icon: PILCROW_ICON, group: 'view' });
        changed.fire(on);
      };
      show(shown);
      subscriptions.push(
        workbench.registerStyleSheet(css),
        visualEditor.registerTiptapExtension(() => invisibleMarks({ shown: () => shown, onDidChange: changed.event })),
        commands.registerCommand(TOGGLE, () => {
          void globalState.update(SHOWN_KEY, !shown);
          show(!shown);
        }),
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('invisibles.show')) show(configuredShown(workspace, globalState));
        }),
        new Disposable(() => {
          codeMirror?.dispose();
          button?.dispose();
          changed.dispose();
        }),
      );
    },
  };
}

/** Shows or hides the invisible characters in every editor (the viewer's choice, kept for later visits). */
export const TOGGLE = 'invisibles.toggle';

/** Its setting `invisibles.show` and its command. */
const contributes: TypstExtension['contributes'] = {
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

/** The tab bar button's icon: a pilcrow. */
const PILCROW_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9.5H6a3 3 0 0 1 0-6h5.5M8.5 3.5v10M11 3.5v10"/></svg>';
