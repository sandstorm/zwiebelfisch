// Tests for image-files.ts.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { IMAGE_ACCEPT, IMAGE_FILES, imageBlob, isImage, uploadFolder } from './image-files';

const path = ProjectPath.of;

describe('image files', () => {
  it('are the files Typst shows as images, by extension in any case', () => {
    expect(isImage(path('/img/Logo.PNG'))).toBe(true);
    expect(isImage(path('/logo.svg'))).toBe(true);
    expect(isImage(path('/a.drawio.png'))).toBe(true);
    expect(isImage(path('/data.csv'))).toBe(false);
    expect(isImage(path('/budget.ic'))).toBe(false);
    expect(isImage(path('/png'))).toBe(false);
    expect(IMAGE_FILES).toBe('*.{png,jpg,jpeg,gif,svg,webp}');
    expect(IMAGE_ACCEPT).toBe('.png,.jpg,.jpeg,.gif,.svg,.webp');
  });

  it('come as Blobs of their media type', () => {
    expect(imageBlob(path('/a.SVG'), '<svg/>').type).toBe('image/svg+xml');
    expect(imageBlob(path('/a.jpg'), new Uint8Array([1, 2])).size).toBe(2);
  });

  it('are uploaded to the folder holding most of them, else to /images/', () => {
    expect(uploadFolder([path('/logo.png'), path('/assets/a.png'), path('/assets/b.svg')])).toBe('/assets/');
    expect(uploadFolder([path('/logo.png')])).toBe('/');
    expect(uploadFolder([])).toBe('/images/');
  });
});
