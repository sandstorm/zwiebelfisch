import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { Extension, ExtensionContext } from '../../hosts/extension-host/extension-host';
import { svg, type VisualEditorMenuContext } from '../../hosts/visual-editor/visual-editor';
import css from './changes.css?inline';
import { changeDecorations } from './visual-editor/change-decorations';

/**
 * A file's changes since the last commit, against the original its source control's `quickDiffProvider` gives:
 * "Show changes since last commit" in the Visual editor's toolbar (group `7_changes`, the command `changes.toggle`)
 * marks new text green and shows deleted text struck through in red, in every Visual editor. The button shows only
 * for files a source control has an original of. Off at first; the viewer's last choice is kept (`globalState`).
 */
export function changes(): Extension {
  return {
    id: 'changes',
    contributes,
    activate(context) {
      const { commands, window, scm, globalState, visualEditor, subscriptions } = context;
      let shown = globalState.get<unknown>(SHOWN_KEY) === true;
      const changed = new EventEmitter<void>();
      let followed = Disposable.from();
      const follow = () => {
        followed.dispose();
        followed = Disposable.from(...scm.sourceControls.map((control) => control.onDidChange(() => changed.fire())));
        changed.fire();
      };
      const original = originals(context);
      subscriptions.push(
        window.registerStyleSheet(css),
        commands.registerCommand(TOGGLE, () => {
          shown = !shown;
          void globalState.update(SHOWN_KEY, shown);
          changed.fire();
        }),
        window.registerMenuItem<VisualEditorMenuContext>('visualEditor/toolbar', {
          command: TOGGLE,
          title: TITLE,
          icon: ICON,
          group: '7_changes',
          toggled: () => shown,
          when: ({ document }) => original(document) !== undefined,
        }),
        visualEditor.registerTiptapExtension((editor) =>
          changeDecorations({ original: () => (shown ? original(editor.document) : undefined), onDidChange: changed.event }),
        ),
        scm.onDidChangeSourceControls(follow),
        new Disposable(() => followed.dispose()),
        changed,
      );
      follow();
    },
  };
}

/** Shows or hides the changes since the last commit in every Visual editor (the viewer's choice, kept for later visits). */
export const TOGGLE = 'changes.toggle';

const TITLE = 'Show changes since last commit';

const contributes: Extension['contributes'] = { commands: [{ command: TOGGLE, title: TITLE }] };

/** The text of a document at the last commit: from the first source control that has one; undefined: none has. */
function originals({ project, scm }: Pick<ExtensionContext, 'project' | 'scm'>): (document: TypstDocument) => string | undefined {
  return (document) => {
    const path = project.pathOf(document);
    if (!path) return undefined;
    for (const control of scm.sourceControls) {
      const text = control.quickDiffProvider?.provideOriginalText(path);
      if (text !== undefined) return text;
    }
    return undefined;
  };
}

/** Where the viewer's last choice is kept (`globalState`). */
const SHOWN_KEY = 'show';

/** A file with a plus and a minus (lucide's `file-diff`). */
const ICON = svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M9 10h6"/><path d="M12 13V7"/><path d="M9 17h6"/>');
