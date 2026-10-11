// The collaboration's part of the workbench. See ../collaboration.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import type { FileDecorationProvider } from '../../../hosts/window/window';
import { initials, type PresenceSource } from '../presence/presence';

/**
 * One decoration per other user in a file: their initials in their color, their name as tooltip; closed folders show them, too.
 *
 * Where the other users are, as file decorations (the file panel shows them as badges with their initials), and the
 * browser's warning when leaving would leave changes uncommitted.
 */
export function presenceDecorations(presences: PresenceSource): FileDecorationProvider {
  const onDidChangeFileDecorations: Event<readonly ProjectPath[] | undefined> = (listener) => presences.onDidChange(() => listener(undefined));
  return {
    provideFileDecoration: (path) =>
      presences.presencesAt(path).map(({ user }) => ({ badge: initials(user.name), tooltip: user.name, color: user.color, propagate: true })),
    onDidChangeFileDecorations,
  };
}

/**
 * Has the browser ask before the page in `view` is left (its own "Leave site?" dialog) while `uncommitted()` says
 * leaving would leave changes behind that nobody commits.
 */
export function leaveWarning(view: Window, uncommitted: () => boolean): Disposable {
  const listener = (event: BeforeUnloadEvent) => {
    if (!uncommitted()) return;
    event.preventDefault();
    // browsers that predate preventDefault() here ask when returnValue is set
    event.returnValue = true;
  };
  view.addEventListener('beforeunload', listener);
  return new Disposable(() => view.removeEventListener('beforeunload', listener));
}
