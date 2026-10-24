// The files a guest may not change, read-only in the guest's widget. See Guests in ../guests.ts.
import { ProjectPath } from '../../../../core/paths/paths';
import type { Project } from '../../../../core/project/project';
import { FilePermission, type FileSystemProvider } from '../../../../hosts/extension-host/workspace/workspace';
import { guestMayChange } from '../../room-protocol';

/**
 * Readonly: every file of `project` whose ending is not one of `endings` (the room's `guestEditable`), and every such
 * file not there yet (a path with an ending that holds no files), so a guest neither changes, renames, deletes nor
 * creates one. Folders stay as they are.
 */
export function guestPermissions(project: Pick<Project, 'has' | 'paths'>, endings: readonly string[]): FileSystemProvider {
  const isFile = (path: ProjectPath) =>
    project.has(path) || (ProjectPath.extension(path) !== '' && !project.paths().some((file) => file.startsWith(`${path}/`)));
  return {
    stat: (path) => (path !== null && !guestMayChange(endings, path) && isFile(path) ? { permissions: FilePermission.Readonly } : {}),
  };
}
