// Tests for hashed.ts.
import { describe, expect, it } from 'vitest';
import { Pt, type HtmlFile, type Page } from '../../../core/typst-engine/typst-engine';
import { HashedReceiver, HashedSender } from './hashed';

const page = (hash: string): Page => ({ hash, width: Pt.of(100), height: Pt.of(100), svg: `<svg id="${hash}"/>` });
const file = (path: string, hash: string): HtmlFile => ({ path, hash, document: path.endsWith('.html'), data: new TextEncoder().encode(hash) });

describe('HashedSender and HashedReceiver with pages', () => {
  it('send the SVG of a page only when the preview does not have it, and put it back on arrival', () => {
    const sender = new HashedSender<Page, 'svg'>('svg');
    const receiver = new HashedReceiver<Page, 'svg'>('svg');
    const first = sender.encode([page('a'), page('b')]);
    expect(first.map((p) => p.svg)).toEqual(['<svg id="a"/>', '<svg id="b"/>']);
    expect(receiver.decode(first)).toEqual([page('a'), page('b')]);
    const second = sender.encode([page('a'), page('c'), page('b')]);
    expect(second.map((p) => p.svg)).toEqual([null, '<svg id="c"/>', null]);
    expect(receiver.decode(second)).toEqual([page('a'), page('c'), page('b')]);
  });

  it('keep the pages through a failed compile (no pages), and send a page again that was gone in between', () => {
    const sender = new HashedSender<Page, 'svg'>('svg');
    const receiver = new HashedReceiver<Page, 'svg'>('svg');
    receiver.decode(sender.encode([page('a'), page('b')]));
    expect(receiver.decode(sender.encode([]))).toEqual([]);
    expect(receiver.decode(sender.encode([page('a')]))).toEqual([page('a')]);
    const back = sender.encode([page('a'), page('b')]);
    expect(back.map((p) => p.svg)).toEqual([null, '<svg id="b"/>']);
    expect(receiver.decode(back)).toEqual([page('a'), page('b')]);
  });
});

describe('HashedSender and HashedReceiver with HTML files', () => {
  it('send the data of a file only when the preview does not have it, and put it back on arrival', () => {
    const sender = new HashedSender<HtmlFile, 'data'>('data');
    const receiver = new HashedReceiver<HtmlFile, 'data'>('data');
    const first = sender.encode([file('index.html', 'a'), file('style.css', 'b')]);
    expect(first.map((f) => f.data !== null)).toEqual([true, true]);
    expect(receiver.decode(first)).toEqual([file('index.html', 'a'), file('style.css', 'b')]);
    const second = sender.encode([file('index.html', 'c'), file('style.css', 'b')]);
    expect(second.map((f) => f.data !== null)).toEqual([true, false]);
    expect(receiver.decode(second)).toEqual([file('index.html', 'c'), file('style.css', 'b')]);
  });

  it('keep the files through a failed compile (no files)', () => {
    const sender = new HashedSender<HtmlFile, 'data'>('data');
    const receiver = new HashedReceiver<HtmlFile, 'data'>('data');
    receiver.decode(sender.encode([file('index.html', 'a')]));
    expect(receiver.decode(sender.encode([]))).toEqual([]);
    const again = sender.encode([file('index.html', 'a')]);
    expect(again[0].data).toBeNull();
    expect(receiver.decode(again)).toEqual([file('index.html', 'a')]);
  });
});
