// versionStatus: what the status line says about a message of the server on versions. Pure. See model.ts.
import type { ServerMessage } from '../../../features/collaboration/gitlab-protocol';

/** The status line for `message`: the saved version, nothing to save, merged upstream changes, a conflict, a failure. */
export function versionStatus(message: ServerMessage): string {
  switch (message.type) {
    case 'gitlab:saved':
      return `Saved version ${message.sha.slice(0, 8)} (${message.author})`;
    case 'gitlab:unchanged':
      return 'No changes to save';
    case 'gitlab:merged':
      return 'Merged new changes from GitLab';
    case 'gitlab:conflict':
      return `Changes on GitLab conflict with edits in ${message.files.map((file) => file.path).join(', ')}; not saved`;
    case 'gitlab:error':
      return `Saving failed: ${message.message}`;
  }
}
