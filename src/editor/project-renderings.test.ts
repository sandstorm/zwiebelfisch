import { describe, expect, it, vi } from 'vitest';
import { Project, type FileChange } from './project';
import { ProjectRenderings } from './project-renderings';

const LOGO = new Uint8Array([1, 2, 3]);

function setup(files: Record<string, string | Uint8Array> = {}) {
  let next = 0;
  const createObjectURL = vi.fn(() => `blob:${next++}`);
  const revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  const project = new Project('/main.typ', { '/main.typ': '= Hi\n', '/chapters/one.typ': 'One\n', '/img/logo.png': LOGO, ...files });
  const preview = { snippet: vi.fn(async () => ({ svg: '<svg/>', width: 1, height: 1 })), onRender: vi.fn(() => () => {}) };
  const request = vi.fn(async (change: FileChange) => (project.apply(change), null as string | null));
  const renderings = new ProjectRenderings({ project, preview, request });
  const chapter = renderings.forDocument(project.document('/chapters/one.typ')!);
  return { project, preview, request, renderings, chapter, createObjectURL, revokeObjectURL };
}

describe('ProjectRenderings', () => {
  it('asks the preview for snippets of the document under its current path', async () => {
    const { chapter, preview, project } = setup();
    await chapter.renderer!.snippet(0, 3, 'One');
    expect(preview.snippet).toHaveBeenCalledWith('/chapters/one.typ', 0, 3, 'One');
    project.apply({ kind: 'rename', from: '/chapters/one.typ', path: '/chapters/first.typ' });
    await chapter.renderer!.snippet(0, 3, 'One');
    expect(preview.snippet).toHaveBeenLastCalledWith('/chapters/first.typ', 0, 3, 'One');
  });

  it('gives image files as object URLs, resolved like Typst, made once per content', () => {
    const { chapter, project, createObjectURL, revokeObjectURL } = setup();
    const url = chapter.renderer!.imageUrl('../img/logo.png');
    expect(url).toBe('blob:0');
    expect(chapter.renderer!.imageUrl('/img/logo.png')).toBe(url);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    project.replace({ '/chapters/one.typ': 'One\n', '/img/logo.png': new Uint8Array([4]) });
    expect(chapter.renderer!.imageUrl('/img/logo.png')).toBe('blob:1');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:0');
    expect(chapter.renderer!.imageUrl('missing.png')).toBeNull();
    expect(chapter.renderer!.imageUrl('/main.typ')).toBeNull();
  });

  it('revokes its object URLs when destroyed', () => {
    const { chapter, renderings, revokeObjectURL } = setup();
    chapter.renderer!.imageUrl('/img/logo.png');
    renderings.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:0');
  });

  it('lists the project images and uploads new ones, with paths as written in the document', async () => {
    const { chapter, project, request } = setup({ '/chapters/fig.svg': '<svg/>' });
    expect(chapter.assets!.list()).toEqual(['fig.svg', '/img/logo.png']);
    const path = await chapter.assets!.upload(new File([new Uint8Array([9])], 'cat.png'));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create', path: '/cat.png' }));
    expect(path).toBe('/cat.png');
    expect(project.has('/cat.png')).toBe(true);
  });

  it('does not insert an upload that was refused or is no image', async () => {
    const { chapter, request } = setup();
    request.mockResolvedValueOnce('This change is not allowed here.');
    expect(await chapter.assets!.upload(new File(['x'], 'cat.png'))).toBeNull();
    expect(await chapter.assets!.upload(new File(['x'], 'notes.txt'))).toBeNull();
  });
});
