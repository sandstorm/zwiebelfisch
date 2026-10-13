// Tests for html-files.ts.
import { describe, expect, it } from 'vitest';
import type { HtmlFile } from '../../../core/typst-engine/typst-engine';
import { HtmlFileReceiver, HtmlFileSender } from './html-files';

const file = (path: string, hash: string): HtmlFile => ({ path, hash, document: path.endsWith('.html'), data: new TextEncoder().encode(hash) });

describe('HtmlFileSender and HtmlFileReceiver', () => {
  it('send the data of a file only when the preview does not have it, and put it back on arrival', () => {
    const sender = new HtmlFileSender();
    const receiver = new HtmlFileReceiver();
    const first = sender.encode([file('index.html', 'a'), file('style.css', 'b')]);
    expect(first.map((f) => f.data !== null)).toEqual([true, true]);
    expect(receiver.decode(first)).toEqual([file('index.html', 'a'), file('style.css', 'b')]);
    const second = sender.encode([file('index.html', 'c'), file('style.css', 'b')]);
    expect(second.map((f) => f.data !== null)).toEqual([true, false]);
    expect(receiver.decode(second)).toEqual([file('index.html', 'c'), file('style.css', 'b')]);
  });

  it('keep the files through a failed compile (no files)', () => {
    const sender = new HtmlFileSender();
    const receiver = new HtmlFileReceiver();
    receiver.decode(sender.encode([file('index.html', 'a')]));
    expect(receiver.decode(sender.encode([]))).toEqual([]);
    const again = sender.encode([file('index.html', 'a')]);
    expect(again[0].data).toBeNull();
    expect(receiver.decode(again)).toEqual([file('index.html', 'a')]);
  });
});
