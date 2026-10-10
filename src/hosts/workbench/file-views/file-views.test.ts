// @vitest-environment jsdom
// Tests for file-views.ts.
import { describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import type { FileView, FileViewProvider } from '../workbench';
import { FileViews } from './file-views';

const path = ProjectPath.of;

function provider() {
  const view = { show: vi.fn<FileView['show']>(), hide: vi.fn<FileView['hide']>(), dispose: vi.fn<FileView['dispose']>() };
  const created: FileViewProvider = { createFileView: vi.fn(() => view) };
  return { view, provider: created };
}

describe('FileViews', () => {
  it('shows a file in the view for its kind, created on first use, and hides the others', () => {
    const views = new FileViews(document.createElement('div'));
    const images = provider();
    const sheets = provider();
    views.register('image', images.provider);
    views.register('spreadsheet', sheets.provider);
    views.show({ path: path('/logo.png'), content: new Uint8Array([1]) });
    expect(images.view.show).toHaveBeenCalledWith(path('/logo.png'), new Uint8Array([1]));
    expect(sheets.provider.createFileView).not.toHaveBeenCalled();
    views.show({ path: path('/data.ic'), content: new Uint8Array([2]) });
    expect(images.view.hide).toHaveBeenCalledTimes(1);
    expect(sheets.view.show).toHaveBeenCalledTimes(1);
    views.show(null);
    expect(sheets.view.hide).toHaveBeenCalledTimes(1);
  });

  it('shows a file again on every open (new content), with one view for a provider of several kinds', () => {
    const views = new FileViews(document.createElement('div'));
    const assets = provider();
    views.register('image', assets.provider);
    views.register('data', assets.provider);
    views.show({ path: path('/logo.png'), content: new Uint8Array([1]) });
    views.show({ path: path('/logo.png'), content: new Uint8Array([2]) });
    views.show({ path: path('/table.csv'), content: 'a,b' });
    expect(assets.provider.createFileView).toHaveBeenCalledTimes(1);
    expect(assets.view.show).toHaveBeenCalledTimes(3);
    expect(assets.view.hide).not.toHaveBeenCalled();
  });

  it('shows nothing for a kind without a view; one provider per kind; disposing the last registration disposes the view', () => {
    const views = new FileViews(document.createElement('div'));
    const assets = provider();
    const image = views.register('image', assets.provider);
    const data = views.register('data', assets.provider);
    expect(() => views.register('image', provider().provider)).toThrow(/registered already/);
    views.show({ path: path('/x.ic'), content: new Uint8Array() });
    expect(assets.provider.createFileView).not.toHaveBeenCalled();
    views.show({ path: path('/logo.png'), content: new Uint8Array([1]) });
    image.dispose();
    expect(assets.view.dispose).not.toHaveBeenCalled();
    data.dispose();
    expect(assets.view.dispose).toHaveBeenCalledTimes(1);
  });
});
