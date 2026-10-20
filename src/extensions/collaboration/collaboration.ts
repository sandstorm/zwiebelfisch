import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { ProgressLocation } from '../../hosts/window/window';
import type { ExtensionContext, Extension } from '../../hosts/extension-host/extension-host';
import css from './collaboration.css?inline';
import { Account, SignInRequired } from './account';
import { CollaborationLink } from './collaboration-link';
import { Presences } from './presence/presence';
import { perUserUndo, sourcePresence } from './source-editor/source-editor';
import { registerVisualPresence } from './visual-editor/visual-editor';
import { boxPresence } from './visual-editor/box-carets';
import { AccountStatus } from './workbench/account';
import { leaveWarning, presenceDecorations } from './workbench/workbench';

/**
 * Real-time editing of the project with others, over Yjs. Not a built-in: the host adds it with its connection
 * (`extensions: (builtinExtensions) => [...builtinExtensions, collaboration({ url, room })]`).
 *
 * Shows the other users, each in their color:
 * - carets and selections in the Source and Visual editors
 * - file decorations in the window
 *
 * Until the room's text is in the project, the editing area takes no input. Other users' edits never enter the local
 * undo history. With a server, only signed-in users connect: the status bar shows the account and offers signing in,
 * also when the session ends. A room backed by a GitLab branch is a source control, and the browser warns before
 * leaving changes nobody commits.
 */
export function collaboration(options: CollaborationOptions): Extension {
  const server = 'url' in options;
  return {
    id: 'collaboration',
    contributes: server
      ? {
          commands: [
            { command: 'collaboration.signIn', title: 'Sign in', category: 'Collaboration' },
            { command: 'collaboration.signOut', title: 'Sign out', category: 'Collaboration' },
          ],
        }
      : undefined,
    activate(context) {
      const { project, window, scm, sourceEditor, visualEditor, subscriptions } = context;
      subscriptions.push(window.registerStyleSheet(css));
      const presences = new Presences((document) => project.pathOf(document));
      const user = window.user;
      const account = 'url' in options ? signInOut(new Account(options.url), context) : null;
      // whoever signed in at the server is the one working here: comments are signed with the name the others see
      if (account) subscriptions.push(account.onDidChange(() => account.identity && window.setUser({ ...user, name: account.identity.name })));
      const link = new CollaborationLink(options, { project, user }, {
        current: () => {
          const editor = window.activeTextEditor;
          const path = editor && project.pathOf(editor.document);
          return path ? { path, selection: editor.selection } : null;
        },
        focused: () => window.isEditorFocused(),
        onSourceControl: (sourceControl) => subscriptions.push(scm.registerSourceControl(sourceControl)),
        tell: (message, severity) => void { info: window.showInformationMessage, warning: window.showWarningMessage, error: window.showErrorMessage }[severity].call(window, message),
        onPresence: (all) => presences.set(all),
        signInRequired: () =>
          void window.showErrorMessage(SignInRequired.reason, 'Sign in').then((choice) => choice && context.commands.executeCommand('collaboration.signIn')),
      }, account);
      const documents = () => project.paths().flatMap((path) => project.document(path) ?? []);
      subscriptions.push(
        presences,
        registerVisualPresence(visualEditor, presences, documents),
        sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, sourcePresence(presences)),
        sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, perUserUndo),
        sourceEditor.registerCodeMirrorExtension({ editor: 'rawBox' }, boxPresence),
        window.registerFileDecorationProvider(presenceDecorations(presences)),
        link,
        // fired from the editors' own updates, after their state has the new selection
        window.onDidChangeTextEditorSelection(() => link.selectionChanged()),
      );
      // what is typed before the room's text is there would be replaced by it
      void window.withProgress({ location: ProgressLocation.EditingArea, title: 'Connecting to the room…' }, () => link.ready);
      const view = window.ownerDocument.defaultView;
      if (view) subscriptions.push(leaveWarning(view, () => link.leavesChangesUncommitted()));
    },
  };
}

/**
 * The account's status bar entry and the commands `collaboration.signIn` (to the server's sign-in, back to this page)
 * and `collaboration.signOut` (then the page reloads: the room's connection was the signed-in user's).
 */
function signInOut(account: Account, { commands, window, subscriptions }: ExtensionContext): Account {
  const view = window.ownerDocument.defaultView;
  const status = new AccountStatus(window.ownerDocument, account, {
    signIn: () => void commands.executeCommand('collaboration.signIn'),
    showMenu: (anchor) => window.showContextMenu(ACCOUNT_MENU, { anchor, title: account.identity?.name ?? 'Account' }),
  });
  subscriptions.push(
    account,
    account.onDidChange(() => status.show()),
    window.registerStatusBarItem(status.element, { alignment: 'right', priority: 10 }),
    window.registerMenuItem(ACCOUNT_MENU, { command: 'collaboration.signOut' }),
    commands.registerCommand('collaboration.signIn', () => view?.location.assign(account.signInUrl(view.location.href))),
    commands.registerCommand('collaboration.signOut', async () => {
      await account.signOut();
      view?.location.reload();
    }),
  );
  return account;
}

/** The account entry's menu (`window.showContextMenu`). */
const ACCOUNT_MENU = 'collaboration/account';

/**
 * Where the shared state lives: a Y.Doc the host connects itself (any
 * provider; pass it synced, and its awareness for remote cursors), or a
 * Hocuspocus server the widget connects to: the collaboration server of
 * this repository, on the page's host (the session cookie is sent to it).
 * `url` is that server's URL (`wss://editor.example.org`, maybe with a
 * path prefix); the widget opens its WebSocket at `<url>/api/collaboration`.
 */
export type CollaborationOptions =
  | { doc: Y.Doc; awareness?: Awareness }
  | { url: string; room: string };
