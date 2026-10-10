// Tests for upload.ts.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { uploadTarget } from './upload';

const path = ProjectPath.of;

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
