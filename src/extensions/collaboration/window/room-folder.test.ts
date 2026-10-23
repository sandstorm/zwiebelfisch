// Tests for room-folder.ts.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import type { TypstDiagnostic } from '../../../core/typst-engine/typst-engine';
import { SourceOffset } from '../../../core/typst-document/typst-document';
import { FilePermission } from '../../../hosts/extension-host/workspace/workspace';
import { folderPermissions, missingFiles, sharedDecorations } from './room-folder';

const path = ProjectPath.of;
const FOLDER = path('/reports/q1');

describe('folderPermissions', () => {
  it('makes every folder Readonly but the room\'s folder and those in it', () => {
    const { stat } = folderPermissions(FOLDER);
    const readonly = { permissions: FilePermission.Readonly };
    expect([null, '/reports', '/reports/q2', '/reports/q10', '/assets'].map((folder) => stat(folder === null ? null : path(folder)))).toEqual([
      readonly,
      readonly,
      readonly,
      readonly,
      readonly,
    ]);
    expect(stat(FOLDER)).toEqual({});
    expect(stat(path('/reports/q1/img'))).toEqual({});
  });
});

describe('sharedDecorations', () => {
  it('marks the files outside the folder as shared', () => {
    const provider = sharedDecorations(FOLDER);
    expect(provider.provideFileDecoration(path('/template.typ'))).toEqual({ badge: 'S', tooltip: "Shared: used from outside this project's folder" });
    expect(provider.provideFileDecoration(path('/reports/q10/a.typ'))).toBeDefined();
    expect(provider.provideFileDecoration(path('/reports/q1/main.typ'))).toBeUndefined();
  });
});

describe('missingFiles', () => {
  const error = (message: string, path: ProjectPath | null = ProjectPath.of('/reports/q1/main.typ')): TypstDiagnostic => ({
    severity: 'error',
    message,
    hints: [],
    path,
    from: SourceOffset.of(0),
    to: SourceOffset.of(1),
  });

  it('reads the project files outside the folder a compile could not find', () => {
    expect(
      missingFiles(
        [
          error('file not found (searched at template.typ)'),
          error('file not found (searched at assets/logo.svg)'),
          error('file not found (searched at reports/q1/chapter.typ)'),
          error('file not found (searched at lib.typ)', null),
          error('package not found (searched for @preview/x:0.1.0)'),
          error('unknown variable: x'),
        ],
        FOLDER,
      ),
    ).toEqual(['/template.typ', '/assets/logo.svg']);
  });
});
