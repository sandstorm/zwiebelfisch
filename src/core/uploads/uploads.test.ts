// Tests for uploads.ts.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../paths/paths';
import { uploadChanges, uploadTarget, type UploadedFile } from './uploads';

const path = ProjectPath.of;

/** An uploaded file with `content` (what a DOM File gives). */
function file(content: string | Uint8Array, name: string): UploadedFile {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return { name, text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.slice().buffer };
}

describe('uploadChanges', () => {
  it('creates .typ uploads as text and everything else as bytes, at the top level', async () => {
    const changes = await uploadChanges([
      file('= Hi', 'part.typ'),
      file(new Uint8Array([1, 2]), 'logo.png'),
    ]);
    expect(changes[0]).toEqual({ kind: 'create', path: '/part.typ', content: '= Hi' });
    expect(changes[1].path).toBe('/logo.png');
    expect([...(changes[1] as { content: Uint8Array }).content]).toEqual([1, 2]);
  });

  it('puts an upload at the top of the project, without folder separators in its name; leaves out a name like ".."', async () => {
    const changes = await uploadChanges([file('x', 'a/b\\c.png'), file('y', '..')]);
    expect(changes.map((change) => change.path)).toEqual(['/a_b_c.png']);
  });
});

describe('uploadTarget', () => {
  const files = new Map<string, Uint8Array>([['/image.png', new Uint8Array([9])], ['/image-2.png', new Uint8Array([7])]]);
  const contentOf = (p: ProjectPath) => files.get(p);

  it('is the file with the same content, or the first free name', () => {
    expect(uploadTarget(path('/image.png'), new Uint8Array([9]), contentOf)).toBe(path('/image.png'));
    expect(uploadTarget(path('/image.png'), new Uint8Array([7]), contentOf)).toBe(path('/image-2.png'));
    expect(uploadTarget(path('/image.png'), new Uint8Array([8]), contentOf)).toBe(path('/image-3.png'));
    expect(uploadTarget(path('/cat.png'), new Uint8Array([8]), contentOf)).toBe(path('/cat.png'));
  });
});
