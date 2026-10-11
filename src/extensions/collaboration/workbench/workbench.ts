// The collaboration's part of the workbench: where the other users are, as file decorations (the file panel shows
// them as badges with their initials). See ../collaboration.ts.
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import type { FileDecorationProvider } from '../../../hosts/window/window';
import { initials, type PresenceSource } from '../presence/presence';

/** One decoration per other user in a file: their initials in their color, their name as tooltip; closed folders show them, too. */
export function presenceDecorations(presences: PresenceSource): FileDecorationProvider {
  const onDidChangeFileDecorations: Event<readonly ProjectPath[] | undefined> = (listener) => presences.onDidChange(() => listener(undefined));
  return {
    provideFileDecoration: (path) =>
      presences.presencesAt(path).map(({ user }) => ({ badge: initials(user.name), tooltip: user.name, color: user.color, propagate: true })),
    onDidChangeFileDecorations,
  };
}
