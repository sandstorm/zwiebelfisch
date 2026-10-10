// Tests for upload.ts.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { uploadPath, uploadTarget } from './upload';

const path = ProjectPath.of;

describe('uploadPath', () => {
  it('puts an upload at the top of the project, without folder separators in its name', () => {
    expect(uploadPath('cat.png')).toBe(path('/cat.png'));
    expect(uploadPath('a/b\\c.png')).toBe(path('/a_b_c.png'));
    expect(uploadPath('..')).toBeNull();
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
