// Tests for page-svgs.ts.
import { describe, expect, it } from 'vitest';
import { Pt, type Page } from '../../../core/typst-engine/typst-engine';
import { PageReceiver, PageSender } from './page-svgs';

const page = (hash: string): Page => ({ hash, width: Pt.of(100), height: Pt.of(100), svg: `<svg id="${hash}"/>` });

describe('PageSender and PageReceiver', () => {
  it('send the SVG of a page only when the preview does not have it, and put it back on arrival', () => {
    const sender = new PageSender();
    const receiver = new PageReceiver();
    const first = sender.encode([page('a'), page('b')]);
    expect(first.map((p) => p.svg)).toEqual(['<svg id="a"/>', '<svg id="b"/>']);
    expect(receiver.decode(first)).toEqual([page('a'), page('b')]);
    const second = sender.encode([page('a'), page('c'), page('b')]);
    expect(second.map((p) => p.svg)).toEqual([null, '<svg id="c"/>', null]);
    expect(receiver.decode(second)).toEqual([page('a'), page('c'), page('b')]);
  });

  it('keep the pages through a failed compile (no pages), and send a page again that was gone in between', () => {
    const sender = new PageSender();
    const receiver = new PageReceiver();
    receiver.decode(sender.encode([page('a'), page('b')]));
    expect(receiver.decode(sender.encode([]))).toEqual([]);
    expect(receiver.decode(sender.encode([page('a')]))).toEqual([page('a')]);
    const back = sender.encode([page('a'), page('b')]);
    expect(back.map((p) => p.svg)).toEqual([null, '<svg id="b"/>']);
    expect(receiver.decode(back)).toEqual([page('a'), page('b')]);
  });
});
