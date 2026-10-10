// Tests for version-status.ts.
import { describe, expect, it } from 'vitest';
import { versionStatus } from './version-status';

describe('versionStatus', () => {
  it('names the saved version by its short sha and author', () => {
    expect(versionStatus({ type: 'gitlab:saved', sha: '0123456789abcdef', author: 'Ann' })).toBe('Saved version 01234567 (Ann)');
  });

  it('says when there was nothing to save, upstream was merged, or saving failed', () => {
    expect(versionStatus({ type: 'gitlab:unchanged' })).toBe('No changes to save');
    expect(versionStatus({ type: 'gitlab:merged', sha: 's' })).toBe('Merged new changes from GitLab');
    expect(versionStatus({ type: 'gitlab:error', message: 'no token' })).toBe('Saving failed: no token');
  });

  it('lists the conflicting files', () => {
    const files = [{ path: '/main.typ', ranges: [] }, { path: '/a.typ', ranges: [{ from: 0, to: 1 }] }];
    expect(versionStatus({ type: 'gitlab:conflict', sha: 's', files })).toBe('Changes on GitLab conflict with edits in /main.typ, /a.typ; not saved');
  });
});
