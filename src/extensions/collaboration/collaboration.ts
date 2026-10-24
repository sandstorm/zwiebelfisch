import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { ProgressLocation } from '../../hosts/window/window';
import type { ExtensionContext, Extension } from '../../hosts/extension-host/extension-host';
import css from './collaboration.css?inline';
import { Account, SignInRequired } from './account';
import { CollaborationLink, type LinkedWidget } from './collaboration-link';
import { Presences } from './presence/presence';
import { perUserUndo, sourcePresence } from './source-editor/source-editor';
import { registerVisualPresence } from './visual-editor/visual-editor';
import { boxPresence } from './visual-editor/box-carets';
import { AccountStatus } from './window/account';
import { ParticipantsView, roomTitle } from './window/title-bar';
import { leaveWarning, presenceDecorations } from './window/window';
import { folderPermissions, missingFiles, sharedDecorations } from './window/room-folder';
import { gitlabRoom } from './room-protocol';
import { Guests } from './guests/guests';

/**
 * Real-time editing of the project with others, over Yjs. Not a built-in: the host adds it with its connection
 * (`extensions: (builtinExtensions) => [...builtinExtensions, collaboration({ url, room })]`).
 *
 * Shows the other users, each in their color:
 * - carets and selections in the Source and Visual editors
 * - file decorations in the window
 * - their initials in the middle of the title bar
 *
 * Until the room's text is in the project, the editing area takes no input. Other users' edits never enter the local
 * undo history. With a server, only signed-in users connect: the title bar shows the account (right); signed out, or
 * once the session ended, a card over the whole widget says so and offers signing in. A GitLab room's project, branch
 * and folder are at the left of the title bar. A room backed by a GitLab branch is a source control, and the browser
 * warns before leaving changes nobody commits. In a room of one folder of the branch (`gitlab:<project>@<branch>:/<folder>`):
 * - files are created, renamed and deleted only in that folder (every other folder is Readonly)
 * - a file from outside it that a compile misses is asked for; it comes in, marked "S" (shared)
 *
 * On a server with guest links, members share the room with guests and guests join by a link (Guests in
 * guests/guests.ts); a guest never saves ("Save to GitLab…" is not theirs), and in a GitLab room changes only the
 * files the server lets guests change (the others are Readonly to them).
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
            { command: 'collaboration.shareWithGuests', title: 'Share with guests…', category: 'Collaboration' },
            { command: 'collaboration.manageGuests', title: 'Manage guest links…', category: 'Collaboration' },
          ],
        }
      : undefined,
    activate(context) {
      const { project, window, workspace, preview, sourceEditor, visualEditor, subscriptions } = context;
      subscriptions.push(window.registerStyleSheet(css));
      const presences = new Presences((document) => project.pathOf(document));
      const user = window.user;
      const account = 'url' in options ? signInOut(new Account(options.url), context) : null;
      const guests = account && 'url' in options ? new Guests(context, account, options) : null;
      // whoever signed in at the server is the one working here: comments are signed with the name the others see
      if (account) subscriptions.push(account.onDidChange(() => account.identity && window.setUser({ ...user, name: account.identity.name })));
      const participants = new ParticipantsView(window.ownerDocument);
      const link = new CollaborationLink(options, { project, user }, linkedWidget(context, presences, participants, guests), account);
      const documents = () => project.paths().flatMap((path) => project.document(path) ?? []);
      subscriptions.push(
        presences,
        registerVisualPresence(visualEditor, presences, documents),
        sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, sourcePresence(presences)),
        sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, perUserUndo),
        sourceEditor.registerCodeMirrorExtension({ editor: 'rawBox' }, boxPresence),
        window.registerFileDecorationProvider(presenceDecorations(presences)),
        window.registerTitleBarItem(participants.element, { alignment: 'center' }),
        link,
        // fired from the editors' own updates, after their state has the new selection
        window.onDidChangeTextEditorSelection(() => link.selectionChanged()),
      );
      const room = 'room' in options ? gitlabRoom(options.room) : null;
      if (room) subscriptions.push(window.registerTitleBarItem(roomTitle(window.ownerDocument, room), { alignment: 'left', priority: 100 }));
      const folder = room?.folder;
      if (folder) {
        subscriptions.push(
          workspace.registerFileSystemProvider(folderPermissions(folder, project)),
          window.registerFileDecorationProvider(sharedDecorations(folder)),
          preview.onDidChangeDiagnostics((diagnostics) => link.pull(missingFiles(diagnostics, folder))),
        );
      }
      // what is typed before the room's text is there would be replaced by it
      void window.withProgress({ location: ProgressLocation.EditingArea, title: 'Connecting to the room…' }, () => link.ready);
      const view = window.ownerDocument.defaultView;
      if (view) subscriptions.push(leaveWarning(view, () => link.leavesChangesUncommitted()));
    },
  };
}

/** What the room's link asks of the widget and tells it: the editors, the window, the source controls, guest mode. */
function linkedWidget(context: ExtensionContext, presences: Presences, participants: ParticipantsView, guests: Guests | null): LinkedWidget {
  const { project, window, scm, subscriptions } = context;
  return {
    current: () => {
      const editor = window.activeTextEditor;
      const path = editor && project.pathOf(editor.document);
      return path ? { path, selection: editor.selection } : null;
    },
    focused: () => window.isEditorFocused(),
    onSourceControl: (sourceControl) => subscriptions.push(scm.registerSourceControl(sourceControl)),
    onGuestEditable: (endings) => guests?.restrictFiles(endings),
    tell: (message, severity) =>
      void (severity === 'info' ? window.showInformationMessage(message) : severity === 'warning' ? window.showWarningMessage(message) : window.showErrorMessage(message)),
    onPresence: (all) => presences.set(all),
    onParticipants: (all) => participants.show(all),
    signInRequired: (reason) => guests?.ended() || askToSignIn(context, reason),
    beforeConnect: async () => guests?.beforeConnect(),
    onMessage: (payload) => guests?.receive(payload),
    onRefused: (reason) => guests?.ended(reason),
  };
}

/**
 * "You are not signed in" with "Sign in" on a card over the whole widget (a modal message), and `reason` (why the
 * session ended) when there is one; it cannot be closed: after "Sign in" it is shown again until the page has left for
 * the sign-in (or a leave warning kept it).
 */
function askToSignIn(context: Pick<ExtensionContext, 'window' | 'commands'>, reason: string | undefined): void {
  const { window, commands } = context;
  const detail = reason ? `${reason} Sign in again to go on editing.` : SignInRequired.reason;
  void window.showErrorMessage('You are not signed in', { modal: true, detail }, 'Sign in').then(async (choice) => {
    if (choice) await commands.executeCommand('collaboration.signIn');
    askToSignIn(context, reason);
  });
}

/**
 * The account's title bar entry and the commands `collaboration.signIn` (to the server's sign-in, back to this page)
 * and `collaboration.signOut` (then the page reloads: the room's connection was the signed-in user's; a guest's menu
 * calls it "Leave guest access").
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
    window.registerTitleBarItem(status.element, { alignment: 'right' }),
    window.registerMenuItem(ACCOUNT_MENU, { command: 'collaboration.signOut', when: () => !account.isGuest }),
    window.registerMenuItem(ACCOUNT_MENU, { command: 'collaboration.signOut', title: 'Leave guest access', when: () => account.isGuest }),
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
