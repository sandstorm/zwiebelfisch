// Tests for images.ts (ProjectImages).
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { Project, type FileChange } from '../../core/project/project';
import { ProjectImages } from './images';
import { PathReference, ProjectPath } from '../../core/paths/paths';

const path = ProjectPath.of;
const ref = PathReference.of;

const LOGO = new Uint8Array([1, 2, 3]);

function setup(files: Record<string, string | Uint8Array> = {}) {
  let next = 0;
  const createObjectURL = vi.fn(() => `blob:${next++}`);
  const revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  const project = new Project(path('/main.typ'), { '/main.typ': '= Hi\n', '/chapters/one.typ': 'One\n', '/img/logo.png': LOGO, ...files });
  const applyEdit = vi.fn(async (change: FileChange) => (project.apply(change), null as string | null));
  const images = new ProjectImages({ project, onDidChange: () => new Disposable(() => {}), applyEdit });
  const chapter = images.forDocument(project.document(path('/chapters/one.typ'))!);
  return { project, applyEdit, images, chapter, createObjectURL, revokeObjectURL };
}

describe('ProjectImages', () => {
  it('gives image files as object URLs, resolved like Typst, made once per content', () => {
    const { chapter, project, createObjectURL, revokeObjectURL } = setup();
    const url = chapter.urls.imageUrl(ref('../img/logo.png'));
    expect(url).toBe('blob:0');
    expect(chapter.urls.imageUrl(ref('/img/logo.png'))).toBe(url);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    project.replace({ '/chapters/one.typ': 'One\n', '/img/logo.png': new Uint8Array([4]) });
    expect(chapter.urls.imageUrl(ref('/img/logo.png'))).toBe('blob:1');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:0');
    expect(chapter.urls.imageUrl(ref('missing.png'))).toBeNull();
    expect(chapter.urls.imageUrl(ref('/main.typ'))).toBeNull();
  });

  it('revokes its object URLs when disposed', () => {
    const { chapter, images, revokeObjectURL } = setup();
    chapter.urls.imageUrl(ref('/img/logo.png'));
    images.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:0');
  });

  it('lists the project images and uploads new ones where most images are, with paths as written in the document', async () => {
    const { chapter, project, applyEdit } = setup({ '/chapters/fig.svg': '<svg/>' });
    expect(chapter.assets.list()).toEqual(['fig.svg', path('/img/logo.png')]);
    // to the first of the folders holding most images
    const result = await chapter.assets.upload(new File([new Uint8Array([9])], 'cat.png'));
    expect(applyEdit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create', path: path('/chapters/cat.png') }));
    expect(result).toEqual({ path: 'cat.png' });
    expect(project.has(path('/chapters/cat.png'))).toBe(true);
  });

  it('says why an upload was refused or is no image it can show', async () => {
    const { chapter, applyEdit } = setup();
    applyEdit.mockResolvedValueOnce('This change is not allowed here.');
    expect(await chapter.assets.upload(new File(['x'], 'cat.png'))).toEqual({ error: 'This change is not allowed here.' });
    expect(await chapter.assets.upload(new File(['x'], 'photo.heic'))).toEqual({
      error: 'photo.heic is not an image the document can show (PNG, JPEG, GIF, SVG or WebP).',
    });
  });

  it('reuses an image already in the project with the same content; a different one gets a free name', async () => {
    const { chapter, project, applyEdit } = setup({ '/image.png': new Uint8Array([9]), '/image-2.png': new Uint8Array([7]) });
    expect(await chapter.assets.upload(new File([new Uint8Array([9])], 'image.png'))).toEqual({ path: path('/image.png') });
    expect(applyEdit).not.toHaveBeenCalled();
    // e.g. a second pasted screenshot: browsers name them all image.png
    expect(await chapter.assets.upload(new File([new Uint8Array([8])], 'image.png'))).toEqual({ path: path('/image-3.png') });
    expect(project.content(path('/image-3.png'))).toEqual(new Uint8Array([8]));
    expect(await chapter.assets.upload(new File([new Uint8Array([7])], 'image.png'))).toEqual({ path: path('/image-2.png') });
  });
});
