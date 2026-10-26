// A GitLab room of one folder in the window: its shared files, the files the compiler misses. See collaboration
// in ../collaboration.ts.
import { Disposable } from '../../../core/disposable/disposable';
import { ProjectPath } from '../../../core/paths/paths';
import type { TypstDiagnostic } from '../../../core/typst-engine/typst-engine';
import type { FileSystemProvider } from '../../../hosts/extension-host/workspace/workspace';
import type { FileDecorationProvider } from '../../../hosts/window/window';

/** A warning on every file outside `folder` that the branch has (`onBranch`): other projects may use it. */
export function sharedWarnings(folder: ProjectPath, onBranch: (path: ProjectPath) => boolean): FileSystemProvider {
  return {
    stat: (other) => (other !== null && !inFolder(other, folder) && onBranch(other) ? { warning: `${ProjectPath.displayName(other)} is outside this project's folder: other projects may use it.` } : {}),
  };
}

/** "S" on each file outside `folder` (one the room pulled in): used from outside this project's folder. */
export function sharedDecorations(folder: ProjectPath): FileDecorationProvider {
  return {
    provideFileDecoration: (path) => (inFolder(path, folder) ? undefined : SHARED),
    // a file's place decides: they never change
    onDidChangeFileDecorations: () => new Disposable(() => {}),
  };
}

/** The files outside `folder` that a compile error in a project file says are not there (`file not found (searched at …)`). */
export function missingFiles(diagnostics: readonly TypstDiagnostic[], folder: ProjectPath): ProjectPath[] {
  return diagnostics.flatMap(({ path, message }) => {
    const searched = path === null ? undefined : NOT_FOUND.exec(message)?.[1];
    const missing = searched === undefined ? null : ProjectPath.parse(`/${searched}`);
    return missing && !inFolder(missing, folder) ? [missing] : [];
  });
}

function inFolder(path: ProjectPath, folder: ProjectPath): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

const SHARED = { badge: 'S', tooltip: "Shared: used from outside this project's folder" };

/** Typst's error for a file of the project that is not there, with its path from the project's top level. */
const NOT_FOUND = /^file not found \(searched at (.+)\)$/;
