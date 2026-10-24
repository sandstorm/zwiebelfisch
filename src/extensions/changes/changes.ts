import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../core/paths/paths';
import type { Extension, ExtensionContext, Memento } from '../../hosts/extension-host/extension-host';
import type { Scm, SourceControl, SourceControlHistoryItem } from '../../hosts/scm/scm';
import css from './changes.css?inline';
import { Baseline } from './baseline';
import { inlineChanges } from './source-editor/inline-changes';
import { changeDecorations } from './visual-editor/change-decorations';
import { relativeTime } from './window/history-list';
import { HistoryPanel } from './window/history-panel';

/**
 * What changed since a commit, in the editors themselves:
 * - "Show changes since last commit" (the command `changes.toggle`, in the View menu) shows in every Visual editor
 *   new text green and deleted text struck through in red, where it was, and in every Source editor (and text file's
 *   editor) changed lines green and deleted lines read-only in red above them. All against one baseline: the last
 *   commit (the `quickDiffProvider`'s original), or the commit chosen in History. While shown, the status bar says
 *   since when ("Changes since last commit ✕"); clicking it, or the toggle, turns them off and the baseline back to the
 *   last commit. Off at first; the viewer's last choice is kept (`globalState`).
 * - The side panel "History" (`workbench.view.history`) lists the commits of the first source control with a
 *   `historyProvider`: of the project, or of a file or folder ("Show history" on the file panel's rows,
 *   `changes.showHistory`), with what is not committed yet on top. Choosing a commit shows the changes since it.
 */
export function changes(): Extension {
  return {
    id: 'changes',
    contributes,
    activate(context) {
      const { commands, window, scm, project, globalState, visualEditor, sourceEditor, subscriptions } = context;
      const changed = new EventEmitter<void>();
      const baseline = new Baseline(scm);
      const shown = new Shown(globalState, baseline, changed);
      const history = historyPanel(context, shown);
      const original = (path: ProjectPath | null | undefined) => (shown.value && path ? baseline.original(path) : undefined);
      const status = statusItem(context, shown);
      subscriptions.push(
        window.registerStyleSheet(css),
        baseline,
        baseline.onDidChange(() => changed.fire()),
        changed.event(() => {
          history.panel.render();
          status.update();
        }),
        history,
        status,
        commands.registerCommand(TOGGLE, () => (shown.value ? shown.hide() : shown.show())),
        window.registerMenuItem('window/view', { command: TOGGLE, group: 'editor', toggled: () => shown.value, when: () => scm.sourceControls.some((control) => control.quickDiffProvider) }),
        visualEditor.registerTiptapExtension((editor) => changeDecorations({ original: () => original(project.pathOf(editor.document)), onDidChange: changed.event })),
        sourceEditor.registerCodeMirrorExtension({}, (editor) => (editor.editor === 'rawBox' ? [] : inlineChanges({ original: () => original(editor.path()), onDidChange: changed.event }))),
        followSourceControls(scm, {
          changed: () => changed.fire(),
          moved: () => history.panel.refresh(),
        }),
        changed,
      );
    },
  };
}

/** Shows or hides the changes since the baseline in every editor (the viewer's choice, kept for later visits). */
export const TOGGLE = 'changes.toggle';
/** Shows the History panel, of the file or folder given (default: the whole project). */
export const SHOW_HISTORY = 'changes.showHistory';

const contributes: Extension['contributes'] = {
  commands: [
    { command: TOGGLE, title: 'Show changes since last commit' },
    { command: SHOW_HISTORY, title: 'Show history' },
  ],
};

/**
 * Whether the editors show the changes: the viewer's choice, kept for later visits (`globalState`). Hiding them sets
 * the baseline back to the last commit.
 */
class Shown {
  #value: boolean;

  constructor(
    private readonly state: Memento,
    readonly baseline: Baseline,
    private readonly changed: EventEmitter<void>,
  ) {
    this.#value = state.get<unknown>(SHOWN_KEY) === true;
  }

  get value(): boolean {
    return this.#value;
  }

  /** Shows the changes since `item` of `control` (default: since the last commit). */
  show(control?: SourceControl, item?: SourceControlHistoryItem): void {
    this.baseline.setCommit(control, item);
    this.#set(true);
  }

  hide(): void {
    this.baseline.setCommit();
    this.#set(false);
  }

  #set(value: boolean): void {
    if (this.#value === value) return;
    this.#value = value;
    void this.state.update(SHOWN_KEY, value);
    this.changed.fire();
  }
}

/** The status bar entry while the changes are shown: since when; a click hides them. */
function statusItem({ window, commands }: ExtensionContext, shown: Shown): Disposable & { update(): void } {
  const element = window.ownerDocument.createElement('button');
  element.type = 'button';
  element.className = 'zwf-changes__status';
  element.dataset.testid = 'zwf-changes-status';
  element.addEventListener('click', () => void commands.executeCommand(TOGGLE));
  let registered: Disposable | undefined;
  const update = () => {
    const commit = shown.baseline.commit;
    const since = commit ? [commit.displayId ?? commit.id.slice(0, 7), commit.timestamp === undefined ? '' : `(${relativeTime(commit.timestamp, Date.now())})`].filter(Boolean).join(' ') : 'last commit';
    element.textContent = `Changes since ${since} ✕`;
    element.title = `Shown in the editors: what changed since ${commit ? `“${commit.subject}”` : 'the last commit'}. Click to stop showing them.`;
    if (shown.value && !registered) registered = window.registerStatusBarItem(element, { alignment: 'left', priority: 150 });
    if (!shown.value && registered) {
      registered.dispose();
      registered = undefined;
    }
  };
  update();
  return Object.assign(new Disposable(() => registered?.dispose()), { update });
}

/**
 * The side panel "History", its command (`changes.showHistory`, of a file or folder) and the file panel's "Show
 * history"; choosing a commit shows the changes since it.
 */
function historyPanel({ commands, window, project, scm }: ExtensionContext, shown: Shown): Disposable & { panel: HistoryPanel } {
  const side = window.registerSidePanel('history', { label: 'History', icon: CLOCK, order: 14 });
  const panel = new HistoryPanel(side.body, {
    sourceControl: () => historyControl(scm),
    visible: () => side.visible,
    baseline: () => (shown.value ? shown.baseline.commit : undefined),
    showChangesSince: (control, item) => shown.show(control, item),
    openFile: (path) => window.showDocument(path),
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

/** Where the viewer's last choice is kept (`globalState`). */
const SHOWN_KEY = 'show';

/** The History panel's rail button: a clock. */
const CLOCK =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/></svg>';
