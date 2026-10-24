import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../core/paths/paths';
import type { Extension, ExtensionContext } from '../../hosts/extension-host/extension-host';
import type { Scm, SourceControlHistoryItem, SourceControlHistoryItemChange } from '../../hosts/scm/scm';
import css from './changes.css?inline';
import { describe, fromOf, ShownChanges, toOf, type Comparison } from './comparison';
import { Snapshots } from './snapshots';
import { inlineChanges } from './source-editor/inline-changes';
import { changeDecorations } from './visual-editor/change-decorations';
import { shortId } from './window/history-list';
import { HistoryPanel } from './window/history-panel';

/**
 * What changed, in the editors themselves, as IntelliJ's "Show changes": one comparison at a time (`ShownChanges`),
 * which every part below shows alike.
 * - The changes since the last commit, or since a commit, to the current state: in every Visual editor new text green
 *   and deleted text struck through in red, where it was; in every Source editor (and text file's editor) changed
 *   lines green and deleted lines read-only in red above them. The files stay editable.
 * - The changes of a commit (from its first parent), or from one commit to another: the files as they were at the
 *   later commit, read-only (`Snapshots`, files outside the project at `/@84c6e2f/…`), in the same editors with the
 *   same marks; the editor's title bar names them ("84c6e2f · read-only · changes since ebd0bc4", a click opens the
 *   current file). A file deleted there shows its earlier text all deleted. Ending or changing the comparison takes a
 *   file shown so to the current file, or to that file at the new commit.
 * - "Show changes since last commit" (the command `changes.toggle`, in the View menu) turns them on (since the last
 *   commit) and off. While on, the status bar says which ("Changes in 84c6e2f ✕"); a click turns them off. The
 *   viewer's last choice is kept (`globalState`).
 * - The side panel "History" (`workbench.view.history`) lists the commits of the first source control with a
 *   `historyProvider`: of the project, or of a file or folder ("Show history" on the file panel's rows,
 *   `changes.showHistory`), with what is not committed yet on top. A click on a commit shows its changes, a
 *   Cmd/Ctrl-click on another compares the two; a right click offers "Show changes of this commit", "Compare with
 *   current state" and "Compare with…" (the menu `changes/historyItem`, its commands taking the commit).
 * The Typst preview always shows the project as it is now.
 */
export function changes(): Extension {
  return {
    id: 'changes',
    contributes,
    activate(context) {
      const { commands, window, scm, globalState, workspace, visualEditor, sourceEditor, subscriptions } = context;
      const changed = new EventEmitter<void>();
      const shown = new ShownChanges(scm, globalState);
      const snapshots = new Snapshots();
      const files = shownFiles(context, shown, snapshots);
      const history = historyPanel(context, shown, files.open);
      const status = statusItem(context, shown);
      const title = snapshotTitle(context, shown, snapshots);
      const original = (path: ProjectPath | null | undefined) => originalOf(shown, snapshots, path);
      let comparison = shown.comparison;
      subscriptions.push(
        window.registerStyleSheet(css),
        workspace.registerFileSystemProvider(snapshots),
        shown,
        shown.onDidChange(() => {
          if (shown.comparison !== comparison) files.follow();
          comparison = shown.comparison;
          changed.fire();
        }),
        changed.event(() => {
          history.panel.render();
          status.update();
          title.update();
        }),
        window.onDidChangeActiveFile(() => title.update()),
        history,
        status,
        title,
        commands.registerCommand(TOGGLE, () => (shown.comparison ? shown.hide() : shown.show())),
        commands.registerCommand(SHOW_COMMIT, (item?: SourceControlHistoryItem) => item && shown.show({ kind: 'commit', item })),
        commands.registerCommand(COMPARE_WITH_CURRENT, (item?: SourceControlHistoryItem) => item && shown.show({ kind: 'since', item })),
        commands.registerCommand(COMPARE_WITH, (item?: SourceControlHistoryItem) => item && history.panel.compareWith(item)),
        window.registerMenuItem('window/view', { command: TOGGLE, group: 'editor', toggled: () => shown.comparison !== undefined, when: () => shown.hasOriginals }),
        ...ITEM_ENTRIES.map(({ command, title }, order) => window.registerMenuItem(HISTORY_ITEM_MENU, { command, title, order })),
        visualEditor.registerTiptapExtension((editor) => changeDecorations({ original: () => original(editor.path()), onDidChange: changed.event })),
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

/** Shows or hides the changes (since the last commit) in every editor (the viewer's choice, kept for later visits). */
export const TOGGLE = 'changes.toggle';
/** Shows the History panel, of the file or folder given (default: the whole project). */
export const SHOW_HISTORY = 'changes.showHistory';
/** Shows the changes of the commit given (a `SourceControlHistoryItem`). */
export const SHOW_COMMIT = 'changes.showCommit';
/** Shows the changes from the commit given to the current state. */
export const COMPARE_WITH_CURRENT = 'changes.compareWithCurrent';
/** The next commit clicked in History is compared with the commit given. */
export const COMPARE_WITH = 'changes.compareWith';
/** Opens the file shown as it was at a commit as it is now. */
const OPEN_CURRENT = 'changes.openCurrent';
/** The menu of a commit in History (a right click); its commands get the commit. */
export const HISTORY_ITEM_MENU = 'changes/historyItem';

/** The entries of a commit's menu (their commands need the commit: not declared for search everywhere). */
const ITEM_ENTRIES = [
  { command: SHOW_COMMIT, title: 'Show changes of this commit' },
  { command: COMPARE_WITH_CURRENT, title: 'Compare with current state' },
  { command: COMPARE_WITH, title: 'Compare with…' },
];

const contributes: Extension['contributes'] = {
  commands: [
    { command: TOGGLE, title: 'Show changes since last commit' },
    { command: SHOW_HISTORY, title: 'Show history' },
  ],
};

/**
 * The original the changes of the file at `path` are drawn against: for a file as it was at the commit the
 * comparison goes to, its text at the commit the comparison starts at; for a project file while the comparison goes to
 * the current state, likewise; else (no comparison, a file of another commit) none.
 */
function originalOf(shown: ShownChanges, snapshots: Snapshots, path: ProjectPath | null | undefined): string | undefined {
  const comparison = shown.comparison;
  if (!comparison || !path) return undefined;
  const snapshot = snapshots.get(path);
  if (snapshot) return snapshot.item.id === toOf(comparison)?.id ? shown.text(fromOf(comparison), snapshot.originalPath ?? snapshot.path) : undefined;
  return toOf(comparison) ? undefined : shown.text(fromOf(comparison), path);
}

/**
 * Opens the files of the comparison shown (`open`: to a commit, as they were there; else the project's), and keeps
 * a file shown as it was at a commit with the comparison (`follow`, after it changed): the same file at the new
 * commit, or the current file (the main file once it is gone) when the comparison no longer goes to a commit.
 */
function shownFiles({ window, project }: ExtensionContext, shown: ShownChanges, snapshots: Snapshots): { open(change: SourceControlHistoryItemChange): void; follow(): void } {
  const at = async (item: SourceControlHistoryItem, path: ProjectPath, originalPath?: ProjectPath) => {
    try {
      const text = await shown.load(item.id, path);
      const to = shown.comparison && toOf(shown.comparison);
      // the comparison moved on meanwhile
      if (to?.id !== item.id) return;
      window.showDocument(snapshots.add(item, path, text, originalPath));
      snapshots.retain((snapshot) => snapshot.item.id === item.id);
    } catch (error) {
      void window.showErrorMessage(`${ProjectPath.displayName(path)} at ${shortId(item)} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return {
    open(change) {
      const to = shown.comparison && toOf(shown.comparison);
      if (to) void at(to, change.path, change.originalPath);
      else window.showDocument(change.path);
    },
    follow() {
      const active = snapshots.get(window.activeFile);
      const to = shown.comparison && toOf(shown.comparison);
      if (active && to) {
        if (to.id !== active.item.id) void at(to, active.path);
        return;
      }
      if (active) window.showDocument(project.has(active.path) ? active.path : project.main);
      snapshots.retain(() => false);
    },
  };
}

/** While a file as it was at a commit is shown: the tab bar names it ("84c6e2f · read-only · changes since ebd0bc4"); a click opens the current file. */
function snapshotTitle({ window, commands, project }: ExtensionContext, shown: ShownChanges, snapshots: Snapshots): Disposable & { update(): void } {
  let registered: Disposable | undefined;
  let shownTitle: string | undefined;
  const update = () => {
    const snapshot = snapshots.get(window.activeFile);
    const comparison = shown.comparison;
    const title = snapshot && [shortId(snapshot.item), 'read-only', comparison && toOf(comparison)?.id === snapshot.item.id ? describe(comparison, Date.now()).from : undefined].filter(Boolean).join(' · ');
    if (title === shownTitle) return;
    shownTitle = title;
    registered?.dispose();
    registered = title ? window.registerMenuItem('window/editorTitle', { command: OPEN_CURRENT, title, when: () => snapshots.get(window.activeFile) !== undefined }) : undefined;
  };
  const command = commands.registerCommand(OPEN_CURRENT, () => {
    const snapshot = snapshots.get(window.activeFile);
    if (snapshot && project.has(snapshot.path)) window.showDocument(snapshot.path);
  });
  return Object.assign(
    new Disposable(() => {
      command.dispose();
      registered?.dispose();
    }),
    { update },
  );
}

/** The status bar entry while changes are shown (and there is what they are of): which; a click hides them. */
function statusItem({ window, commands }: ExtensionContext, shown: ShownChanges): Disposable & { update(): void } {
  const element = window.ownerDocument.createElement('button');
  element.type = 'button';
  element.className = 'zwf-changes__status';
  element.dataset.testid = 'zwf-changes-status';
  element.addEventListener('click', () => void commands.executeCommand(TOGGLE));
  let registered: Disposable | undefined;
  const update = () => {
    const comparison = shown.comparison;
    // the changes since the last commit need its texts
    const visible = comparison !== undefined && (comparison.kind !== 'since' || comparison.item !== undefined || shown.hasOriginals);
    if (visible) {
      const { short, long } = describe(comparison, Date.now());
      element.textContent = `${short} ✕`;
      element.title = `Shown in the editors: ${long}. Click to stop showing them.`;
      registered ??= window.registerStatusBarItem(element, { alignment: 'left', priority: 150 });
    } else {
      registered?.dispose();
      registered = undefined;
    }
  };
  update();
  return Object.assign(new Disposable(() => registered?.dispose()), { update });
}

/**
 * The side panel "History", its command (`changes.showHistory`, of a file or folder), the file panel's "Show
 * history" and a commit's menu; it shows and ends comparisons through the same state as the toggle.
 */
function historyPanel({ commands, window, project }: ExtensionContext, shown: ShownChanges, openFile: (change: SourceControlHistoryItemChange) => void): Disposable & { panel: HistoryPanel } {
  const side = window.registerSidePanel('history', { label: 'History', icon: CLOCK, order: 14 });
  const panel = new HistoryPanel(side.body, {
    sourceControl: () => shown.control,
    visible: () => side.visible,
    comparison: () => shown.comparison,
    compare: (comparison?: Comparison) => (comparison ? shown.show(comparison) : shown.hide()),
    openFile,
    isOpenable: (path) => project.has(path),
    showItemMenu: (item, anchor) => window.showContextMenu(HISTORY_ITEM_MENU, { anchor, title: item.subject, args: [item] }),
  });
  const disposable = Disposable.from(
    side,
    panel,
    side.onDidChangeVisibility(() => panel.shown()),
    commands.registerCommand(SHOW_HISTORY, (path?: ProjectPath) => {
      panel.setScope(path ? { kind: project.has(path) ? 'file' : 'folder', path } : undefined);
      side.show();
    }),
    window.registerMenuItem('files/row', { command: SHOW_HISTORY, group: 'history', when: () => shown.control !== undefined }),
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

/** The History panel's rail button: a clock. */
const CLOCK =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/></svg>';
