// Tests for bundle.ts.
import { describe, expect, it } from 'vitest';
import { linkTarget, pageForCursor, resolvePath } from './bundle';

describe('resolvePath', () => {
  it('resolves relative to the file, or to the root with a leading slash', () => {
    expect(resolvePath('index.html', 'style.css')).toBe('style.css');
    expect(resolvePath('chapters/one.html', '../style.css')).toBe('style.css');
    expect(resolvePath('chapters/one.html', './two.html?x=1#top')).toBe('chapters/two.html');
    expect(resolvePath('chapters/one.html', '/assets/logo%20big.svg')).toBe('assets/logo big.svg');
  });

  it('is null for URLs and paths above the root', () => {
    expect(resolvePath('index.html', 'https://typst.app')).toBeNull();
    expect(resolvePath('index.html', '//cdn.example/x.css')).toBeNull();
    expect(resolvePath('index.html', '../up.html')).toBeNull();
  });
});

describe('linkTarget', () => {
  const files = new Map([
    ['index.html', true],
    ['chapters/one.html', true],
    ['chapters/index.html', true],
    ['report.pdf', false],
  ]);

  it('leads to a page of the bundle, with its fragment', () => {
    expect(linkTarget('index.html', 'chapters/one.html#intro', files)).toEqual({ kind: 'page', path: 'chapters/one.html', fragment: 'intro' });
    expect(linkTarget('chapters/one.html', '../index.html', files)).toEqual({ kind: 'page', path: 'index.html', fragment: null });
    expect(linkTarget('index.html', 'chapters/', files)).toEqual({ kind: 'page', path: 'chapters/index.html', fragment: null });
    expect(linkTarget('chapters/one.html', '#a%20b', files)).toEqual({ kind: 'page', path: 'chapters/one.html', fragment: 'a b' });
  });

  it('tells other files of the bundle, URLs and dead ends apart', () => {
    expect(linkTarget('index.html', 'report.pdf', files)).toEqual({ kind: 'file', path: 'report.pdf' });
    expect(linkTarget('index.html', 'https://sandstorm.de', files)).toEqual({ kind: 'external', url: 'https://sandstorm.de' });
    expect(linkTarget('index.html', 'mailto:a@b.c', files)).toEqual({ kind: 'external', url: 'mailto:a@b.c' });
    expect(linkTarget('index.html', 'missing.html', files)).toEqual({ kind: 'none' });
    expect(linkTarget('index.html', 'javascript:alert(1)', files)).toEqual({ kind: 'none' });
  });
});

describe('pageForCursor', () => {
  const on = (path: string) => ({ path, element: `${path}-el` });

  it('stays on the page shown when the cursor produced something there, else goes to the first', () => {
    expect(pageForCursor('b.html', [on('a.html'), on('b.html')])).toEqual(on('b.html'));
    expect(pageForCursor('c.html', [on('a.html'), on('b.html')])).toEqual(on('a.html'));
    expect(pageForCursor(null, [on('a.html')])).toEqual(on('a.html'));
  });

  it('is null when the cursor produced nothing', () => {
    expect(pageForCursor('a.html', [])).toBeNull();
  });
});
