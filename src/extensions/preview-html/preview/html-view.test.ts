// @vitest-environment jsdom
// Tests for html-view.ts, with the frame's document as jsdom loads it (about:blank: jsdom has no srcdoc).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlFile } from '../../../core/typst-engine/typst-engine';
import { HtmlView } from './html-view';

const encode = (text: string) => new TextEncoder().encode(text);
const html = (body: string) => `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;
/** A bundle's files: `.html` ones are documents; a file's hash is its content. */
const bundle = (files: Record<string, string>): HtmlFile[] =>
  Object.entries(files).map(([path, text]) => ({ path, hash: text, document: path.endsWith('.html'), data: encode(text) }));

describe('HtmlView', () => {
  let view: HtmlView;
  let frame: HTMLIFrameElement;
  let made: string[];
  const doc = () => frame.contentDocument!;
  const scrolls = () => vi.mocked(frame.contentWindow!.scrollTo).mock.calls.map(([options]) => options);

  /** A view whose frame has loaded; the frame's scrolling is recorded, blob URLs are `blob:<n>`. */
  async function setup(projectFile: (path: string) => Uint8Array | null = () => null) {
    const container = document.createElement('div');
    document.body.append(container);
    view = new HtmlView(container, projectFile);
    frame = container.querySelector('iframe')!;
    await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    frame.contentWindow!.scrollTo = vi.fn() as typeof window.scrollTo;
  }

  beforeEach(() => {
    made = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${made.push('url')}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(() => {
    view.dispose();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('shows the first page in a sandbox where scripts do not run', async () => {
    await setup();
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    view.update({ files: bundle({ 'style.css': 'p {}', 'index.html': html('<p>Home</p>'), 'two.html': html('<p>Two</p>') }) });
    expect(doc().body.textContent).toBe('Home');
  });

  it('shows what a compile made before the frame loaded, once it has', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    view = new HtmlView(container, () => null);
    view.update({ files: bundle({ 'index.html': html('<p>Early</p>') }) });
    frame = container.querySelector('iframe')!;
    await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    expect(doc().body.textContent).toBe('Early');
  });

  it('changes the page in place on a compile, so what stays keeps its place (and the scroll position)', async () => {
    await setup();
    view.update({ files: bundle({ 'index.html': html('<p data-typst-element="a">One</p><p data-typst-element="b">Two</p>') }) });
    const [one, two] = [...doc().body.children];
    view.update({ files: bundle({ 'index.html': html('<p data-typst-element="a">One!</p><p data-typst-element="b">Two</p>') }) });
    expect([...doc().body.children]).toEqual([one, two]);
    expect(one.textContent).toBe('One!');
    expect(scrolls()).toEqual([]);
  });

  it('follows the cursor to the page holding its element, scrolled to it unless visible', async () => {
    await setup();
    const files = bundle({
      'index.html': html('<nav data-typst-element="n">Site</nav><p>Home</p>'),
      'two.html': html('<nav data-typst-element="n">Site</nav><h2 data-typst-element="h">Two</h2>'),
    });
    view.update({ files });
    // far below the frame's viewport
    vi.spyOn((frame.contentWindow as unknown as typeof globalThis).Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 2000, bottom: 2020, height: 20 } as DOMRect);
    view.reveal([{ path: 'two.html', element: 'h' }]);
    expect(doc().body.textContent).toBe('SiteTwo');
    expect(scrolls()).toEqual([expect.objectContaining({ behavior: 'smooth' })]);
    // on every page (a template's): the page stays
    view.reveal([
      { path: 'index.html', element: 'n' },
      { path: 'two.html', element: 'n' },
    ]);
    expect(doc().body.textContent).toBe('SiteTwo');
    // nothing (a #let): the page stays, nothing scrolls
    view.reveal([]);
    expect(doc().body.textContent).toBe('SiteTwo');
    expect(scrolls()).toHaveLength(2);
    // a new compile keeps the page
    view.update({ files });
    expect(doc().body.textContent).toBe('SiteTwo');
  });

  it('switches pages on links within the bundle, scrolled to their target, and opens URLs in a new tab', async () => {
    await setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    view.update({
      files: bundle({
        'index.html': html('<a href="chapters/two.html#intro">Two</a> <a href="https://typst.app">Typst</a>'),
        'chapters/two.html': html('<a href="../index.html">Back</a><h2 id="intro">Intro</h2>'),
      }),
    });
    const click = (text: string) => {
      const link = [...doc().querySelectorAll('a')].find((a) => a.textContent === text)!;
      const event = new (frame.contentWindow! as typeof window).MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(click('Typst')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://typst.app', '_blank', 'noopener,noreferrer');
    expect(click('Two')).toBe(true);
    expect(doc().body.textContent).toBe('BackIntro');
    expect(scrolls()).toHaveLength(1);
    click('Back');
    expect(doc().body.textContent).toBe('Two Typst');
    expect(scrolls().at(-1)).toBe(0);
  });

  it('serves the images and style sheets a page loads from memory, made once while they stay the same', async () => {
    const font = encode('font');
    await setup((path) => (path === 'fonts/a.ttf' ? font : null));
    const page = html('<link rel="stylesheet" href="style.css"><img src="img/logo.svg"><a href="style.css">css</a>');
    view.update({ files: bundle({ 'index.html': page, 'style.css': '@font-face { src: url("fonts/a.ttf") }', 'img/logo.svg': '<svg/>' }) });
    const link = doc().querySelector('link')!;
    expect(link.getAttribute('href')).toMatch(/^blob:/);
    expect(doc().querySelector('img')!.getAttribute('src')).toMatch(/^blob:/);
    expect(doc().querySelector('a')!.getAttribute('href')).toBe('style.css');
    // the style sheet, its font (a project file), the picture
    expect(made).toHaveLength(3);
    view.update({ files: bundle({ 'index.html': page.replace('<a', '<p>new</p><a'), 'style.css': '@font-face { src: url("fonts/a.ttf") }', 'img/logo.svg': '<svg/>' }) });
    expect(made).toHaveLength(3);
    expect(doc().querySelector('link')).toBe(link);
  });
});
