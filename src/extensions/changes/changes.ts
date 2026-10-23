import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../core/paths/paths';
import type { FileContent } from '../../core/project/project';
import type { Extension, ExtensionContext, Memento } from '../../hosts/extension-host/extension-host';
import type { Scm, SourceControl, SourceControlHistoryItem, SourceControlHistoryItemChange } from '../../hosts/scm/scm';
import { svg, type VisualEditorMenuContext } from '../../hosts/visual-editor/visual-editor';
import type { EditorProvider } from '../../hosts/window/window';
import css from './changes.css?inline';
import { Baseline } from './baseline';
import { changeDecorations } from './visual-editor/change-decorations';
import { ChangesEditor } from './window/changes-editor';
import { HistoryPanel } from './window/history-panel';

/**
 * What changed, against the source controls' originals and history:
 * - "Show changes since last commit" in the Visual editor's toolbar (group `7_changes`, the command `changes.toggle`)
 *   marks new text green and shows deleted text struck through in red, in every Visual editor, against the baseline:
 *   the last commit (the `quickDiffProvider`'s original), or a commit chosen in History ("Since last commit" in the
 *   toolbar, `changes.sinceLastCommit`, goes back). The button shows only for files a source control has an original
 *   of. Off at first; the viewer's last choice is kept (`globalState`).
 * - The side panel "History" (`workbench.view.history`) lists the commits of the first source control with a
 *   `historyProvider`: of the project, or of a file or folder ("Show history" on the file panel's rows,
 *   `changes.showHistory`), with what is not committed yet on top. A commit's files open in the editor "Changes".
 * - The editor "Changes" (`changes.diff`, an option on every text file) shows a file's changes read-only: those of the
 *   commit it was opened for from History, else those since the baseline, following the file.
 */
export function changes(): Extension {
  return {
    id: 'changes',
    contributes,
    activate(context) {
      const { window, scm, globalState, subscriptions } = context;
      const changed = new EventEmitter<void>();
      const shown = new Shown(globalState, changed);
      const baseline = new Baseline(scm);
      /** The commit each file's next Changes editor shows (History asked for it). */
      const asked = new Map<ProjectPath, Commit>();
      const history = historyPanel(context, baseline, shown, asked);
      subscriptions.push(
        window.registerStyleSheet(css),
        baseline,
        baseline.onDidChange(() => {
          changed.fire();
          history.panel.render();
        }),
        history,
        visualEditorChanges(context, baseline, shown, changed),
        window.registerEditorProvider(CHANGES_EDITOR, changesEditor(context, baseline, asked, changed), {
          displayName: 'Changes',
          filenamePattern: TEXT_FILES,
          priority: 'option',
        }),
        followSourceControls(scm, {
          changed: () => {
            changed.fire();
            history.panel.render();
          },
          moved: () => history.panel.refresh(),
        }),
        changed,
      );
    },
  };
}

/** Shows or hides the changes since the baseline in every Visual editor (the viewer's choice, kept for later visits). */
export const TOGGLE = 'changes.toggle';
/** Shows the changes since the last commit again, after a commit was chosen in History. */
export const SINCE_LAST_COMMIT = 'changes.sinceLastCommit';
/** Shows the History panel, of the file or folder given (default: the whole project). */
export const SHOW_HISTORY = 'changes.showHistory';
/** The view type of the editor "Changes". */
export const CHANGES_EDITOR = 'changes.diff';

const TITLE = 'Show changes since last commit';

const contributes: Extension['contributes'] = {
  commands: [
    { command: TOGGLE, title: TITLE },
    { command: SINCE_LAST_COMMIT, title: 'Since last commit' },
    { command: SHOW_HISTORY, title: 'Show history' },
  ],
};

/** A commit's change of a file, as History asks the Changes editor to show it. */
interface Commit {
  readonly item: SourceControlHistoryItem;
  readonly change: SourceControlHistoryItemChange;
}

/** Whether the Visual editors show the changes: the viewer's choice, kept for later visits (`globalState`). */
class Shown {
  #value: boolean;

  constructor(
    private readonly state: Memento,
    private readonly changed: EventEmitter<void>,
  ) {
    this.#value = state.get<unknown>(SHOWN_KEY) === true;
  }

  get value(): boolean {
    return this.#value;
  }

  set(value: boolean): void {
    this.#value = value;
    void this.state.update(SHOWN_KEY, value);
    this.changed.fire();
  }
}

/**
 * The Visual editors' changes: the toolbar's toggle (for a file with an original) and "Since last commit" (while a
 * commit is the baseline), and the decorations against the baseline while shown.
 */
function visualEditorChanges({ commands, window, project, scm, visualEditor }: ExtensionContext, baseline: Baseline, shown: Shown, changed: EventEmitter<void>): Disposable {
  const original = (path: ProjectPath | undefined) => (shown.value && path ? baseline.original(path) : undefined);
  return Disposable.from(
    commands.registerCommand(TOGGLE, () => shown.set(!shown.value)),
    commands.registerCommand(SINCE_LAST_COMMIT, () => {
      const control = historyControl(scm);
      if (control) baseline.setCommit(control, undefined);
    }),
    window.registerMenuItem<VisualEditorMenuContext>('visualEditor/toolbar', {
      command: TOGGLE,
      title: TITLE,
      icon: ICON,
      group: '7_changes',
      toggled: () => shown.value,
      when: ({ document }) => {
        const path = project.pathOf(document);
        return path !== undefined && baseline.lastCommitted(path) !== undefined;
      },
    }),
    window.registerMenuItem<VisualEditorMenuContext>('visualEditor/toolbar', {
      command: SINCE_LAST_COMMIT,
      icon: BACK_ICON,
      group: '7_changes',
      when: () => shown.value && baseline.commit !== undefined,
    }),
    visualEditor.registerTiptapExtension((editor) => changeDecorations({ original: () => original(project.pathOf(editor.document)), onDidChange: changed.event })),
  );
}

/**
 * The side panel "History", its command (`changes.showHistory`, of a file or folder) and the file panel's "Show
 * history"; choosing a commit as baseline shows the changes.
 */
function historyPanel({ commands, window, project, scm }: ExtensionContext, baseline: Baseline, shown: Shown, asked: Map<ProjectPath, Commit>): Disposable & { panel: HistoryPanel } {
  const side = window.registerSidePanel('history', { label: 'History', icon: CLOCK, order: 14 });
  const panel = new HistoryPanel(side.body, {
    sourceControl: () => historyControl(scm),
    visible: () => side.visible,
    baseline: () => baseline.commit,
    showChangesSince: (control, item) => {
      baseline.setCommit(control, item);
      if (item && !shown.value) shown.set(true);
    },
    openChanges: (path, commit) => {
      if (commit) asked.set(path, commit);
      else asked.delete(path);
      window.showDocument(path, { viewType: CHANGES_EDITOR });
      side.dismiss();
    },
    isOpenable: (path) => project.has(path),
  });
  const disposable = Disposable.from(
    side,
    panel,
    side.onDidChangeVisibility(() => panel.shown()),
    commands.registerCommand(SHOW_HISTORY, (path?: ProjectPath) => {
      panel.setScope(path ? { kind: project.has(path) ? 'file' : 'folder', path } : undefined);
      side.show();
    }),
    window.registerMenuItem('files/row', { command: SHOW_HISTORY, group: 'history', when: () => historyControl(scm) !== undefined }),
  );
  return Object.assign(disposable, { panel });
}

/**
 * Follows the registered source controls until disposed: `changed` when one changed (and when they come or go),
 * `moved` when the current commit of one moved (and when they come or go).
 */
function followSourceControls(scm: Scm, on: { changed(): void; moved(): void }): Disposable {
  let followed = Disposable.from();
  const follow = () => {
    followed.dispose();
    followed = Disposable.from(
      ...scm.sourceControls.flatMap((control) => [
        control.onDidChange(() => on.changed()),
        ...(control.historyProvider ? [control.historyProvider.onDidChangeCurrentHistoryItem(() => on.moved())] : []),
      ]),
    );
    on.changed();
    on.moved();
  };
  const subscription = scm.onDidChangeSourceControls(follow);
  follow();
  return new Disposable(() => {
    subscription.dispose();
    followed.dispose();
  });
}

/** The source control whose history is shown: the first with a `historyProvider`. */
function historyControl(scm: Scm): SourceControl | undefined {
  return scm.sourceControls.find((control) => control.historyProvider);
}

/**
 * The editor "Changes": the change of the commit History asked for (`asked`, taken once), else the changes since
 * `baseline`, following the file and the baseline (`changed`).
 */
function changesEditor({ project, scm, languages, sourceEditor }: ExtensionContext, baseline: Baseline, asked: Map<ProjectPath, Commit>, changed: EventEmitter<void>): EditorProvider {
  return {
    resolveEditor({ path }, panel) {
      const extensions = sourceEditor.codeMirrorExtensionsFor({ editor: 'other', languageId: languages.getLanguageId(path) ?? 'plaintext', path: () => path });
      const editor = new ChangesEditor(panel.element, ProjectPath.displayName(path), extensions);
      const commit = asked.get(path);
      asked.delete(path);
      const subscriptions: Disposable[] = [];
      if (commit) {
        editor.showNote('Loading…');
        const control = historyControl(scm);
        if (control) void showCommit(editor, control, commit);
      } else {
        const update = () => {
          const before = baseline.original(path);
          const since = baseline.commit ? `Since ${baseline.commit.displayId ?? baseline.commit.id}` : 'Since last commit';
          if (before === undefined) editor.showNote(baseline.lastCommitted(path) === undefined ? 'No source control has this file.' : 'Loading…');
          else editor.show(before, text(project.content(path)), `${since} · not committed yet`);
        };
        const document = project.document(path);
        subscriptions.push(
          changed.event(update),
          project.onDidChangeFile((change) => change.path === path && update()),
          ...(document ? [document.onDidChange(update)] : []),
        );
        update();
      }
      panel.onDidDispose(() => {
        for (const subscription of subscriptions) subscription.dispose();
        editor.dispose();
      });
    },
  };
}

/** Shows what `commit` changed in its file: the file at its first parent (where it was, if renamed) against it there. */
async function showCommit(editor: ChangesEditor, control: SourceControl, { item, change }: Commit): Promise<void> {
  const history = control.historyProvider!;
  const parent = item.parentIds[0];
  try {
    const [before, after] = await Promise.all([
      parent && change.kind !== 'added' ? history.provideFileContent(parent, change.originalPath ?? change.path) : undefined,
      change.kind === 'deleted' ? undefined : history.provideFileContent(item.id, change.path),
    ]);
    const short = (id: string) => id.slice(0, 7);
    const who = [item.author, ...(item.coAuthors ?? [])].filter(Boolean).join(', ');
    const detail = [`${parent ? `${short(parent)} → ` : ''}${item.displayId ?? short(item.id)}`, who, item.subject].filter(Boolean).join(' · ');
    editor.show(decode(before), decode(after), detail);
  } catch (error) {
    editor.showNote(`The changes could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function decode(bytes: Uint8Array | undefined): string {
  return bytes ? new TextDecoder().decode(bytes) : '';
}

function text(content: FileContent | undefined): string {
  return content === undefined ? '' : typeof content === 'string' ? content : new TextDecoder().decode(content);
}

/** The files the editor "Changes" is offered for: Typst and the text files Typst reads. */
const TEXT_FILES = '*.{typ,bib,txt,csv,json,yaml,yml,toml,xml,md,mmd}';

/** Where the viewer's last choice is kept (`globalState`). */
const SHOWN_KEY = 'show';

/** A file with a plus and a minus (lucide's `file-diff`). */
const ICON = svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M9 10h6"/><path d="M12 13V7"/><path d="M9 17h6"/>');

/** An arrow turning back (lucide's `undo-2`). */
const BACK_ICON = svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>');

/** The History panel's rail button: a clock. */
const CLOCK =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/></svg>';
