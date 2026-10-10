// Tests for uploads.ts.
import { describe, expect, it } from 'vitest';
import { uploadChanges } from './uploads';

describe('uploadChanges', () => {
  it('creates .typ uploads as text and everything else as bytes, at the top level', async () => {
    const changes = await uploadChanges([
      new File(['= Hi'], 'part.typ'),
      new File([new Uint8Array([1, 2])], 'logo.png'),
    ]);
    expect(changes[0]).toEqual({ kind: 'create', path: '/part.typ', content: '= Hi' });
    expect(changes[1].path).toBe('/logo.png');
    expect([...(changes[1] as { content: Uint8Array }).content]).toEqual([1, 2]);
  });

  it('puts an upload at the top of the project, without folder separators in its name; leaves out a name like ".."', async () => {
    const changes = await uploadChanges([new File(['x'], 'a/b\\c.png'), new File(['y'], '..')]);
    expect(changes.map((change) => change.path)).toEqual(['/a_b_c.png']);
  });
});
