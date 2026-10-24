// Tests for guest-files.ts.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../../core/paths/paths';
import { Project } from '../../../../core/project/project';
import { FilePermission, WorkspaceHost } from '../../../../hosts/extension-host/workspace/workspace';
import { guestPermissions } from './guest-files';

const path = ProjectPath.of;
const ENDINGS = ['.typ', '.png', '.mmd', '.ic'];
const READONLY = { permissions: FilePermission.Readonly };

describe('guestPermissions', () => {
  const project = new Project(path('/main.typ'), { '/main.typ': '', '/.gitlab-ci.yml': 'stages: []', '/data.v2/table.csv': 'a', '/img/Logo.PNG': new Uint8Array([1]) });

  it('makes the files of other types Readonly, there or not yet; folders stay as they are', () => {
    const { stat } = guestPermissions(project, ENDINGS);
    expect(stat(path('/.gitlab-ci.yml'))).toEqual(READONLY);
    expect(stat(path('/data.v2/table.csv'))).toEqual(READONLY);
    expect(stat(path('/refs.bib'))).toEqual(READONLY);
    for (const editable of ['/main.typ', '/img/Logo.PNG', '/flow.mmd', '/sheet.ic', '/chapters/new.typ']) expect(stat(path(editable)), editable).toEqual({});
    for (const folder of [null, '/img', '/data.v2', '/chapters']) expect(stat(folder === null ? null : path(folder)), String(folder)).toEqual({});
  });

  it('has the workspace refuse a guest any change of such a file, and its creation', async () => {
    const workspace = new WorkspaceHost(project);
    workspace.registerFileSystemProvider(guestPermissions(project, ENDINGS));
    expect(await workspace.applyEdit({ kind: 'update', path: path('/.gitlab-ci.yml'), content: '' })).toBe('.gitlab-ci.yml is read-only here.');
    expect(await workspace.applyEdit({ kind: 'create', path: path('/refs.bib'), content: '' })).toBe('refs.bib cannot be created here: it would be read-only.');
    expect(await workspace.applyEdit({ kind: 'create', path: path('/chapters/one.typ'), content: '' })).toBeNull();
  });
});
