// @vitest-environment jsdom
// Tests for item-bar.ts.
import { describe, expect, it } from 'vitest';
import { ItemBar } from './item-bar';

function setup<A extends string>(className: string, alignments: readonly A[]) {
  const bar = Object.assign(document.createElement('div'), { className });
  const items = new ItemBar(bar, alignments);
  const item = (text: string) => Object.assign(document.createElement('span'), { textContent: text });
  const side = (alignment: string) => [...bar.querySelector(`.${className}-${alignment}`)!.children].map((child) => child.textContent);
  return { bar, items, item, side };
}

describe('ItemBar', () => {
  it('puts left items before the right ones, each side by priority (higher further left), then registration order', () => {
    const { bar, items, item, side } = setup('zwf-editor__status-bar', ['left', 'right']);
    items.add(item('words'), { alignment: 'right' });
    items.add(item('diagnostics'), { alignment: 'left', priority: 100 });
    items.add(item('room'), { alignment: 'left', priority: 200 });
    items.add(item('zoom'), { alignment: 'right', priority: 10 });
    items.add(item('mode'), { alignment: 'left', priority: 100 });
    items.add(item('cursor'), { alignment: 'right' });
    expect(side('left')).toEqual(['room', 'diagnostics', 'mode']);
    expect(side('right')).toEqual(['zoom', 'words', 'cursor']);
    expect([...bar.children].map((child) => child.className)).toEqual(['zwf-editor__status-bar-left', 'zwf-editor__status-bar-right']);
  });

  it('has a box per alignment named after the bar, in order (the title bar: left, center, right)', () => {
    const { bar, items, item, side } = setup('zwf-editor__title-bar', ['left', 'center', 'right']);
    items.add(item('account'), { alignment: 'right' });
    items.add(item('people'), { alignment: 'center' });
    items.add(item('save'), { alignment: 'center', priority: 100 });
    items.add(item('project'), { alignment: 'left' });
    expect([...bar.children].map((child) => child.className)).toEqual(['zwf-editor__title-bar-left', 'zwf-editor__title-bar-center', 'zwf-editor__title-bar-right']);
    expect([side('left'), side('center'), side('right')]).toEqual([['project'], ['save', 'people'], ['account']]);
  });

  it('takes a disposed item out and keeps the others in order', () => {
    const { items, item, side } = setup('bar', ['left', 'right']);
    items.add(item('a'), { alignment: 'left', priority: 3 });
    const b = items.add(item('b'), { alignment: 'left', priority: 2 });
    items.add(item('c'), { alignment: 'left', priority: 1 });
    b.dispose();
    b.dispose();
    expect(side('left')).toEqual(['a', 'c']);
    items.add(item('b again'), { alignment: 'left', priority: 2 });
    expect(side('left')).toEqual(['a', 'b again', 'c']);
  });

  it('is hidden while it has no item', () => {
    const { bar, items, item } = setup('bar', ['left', 'center', 'right']);
    expect(bar.hidden).toBe(true);
    const left = items.add(item('a'), { alignment: 'left' });
    const center = items.add(item('b'), { alignment: 'center' });
    left.dispose();
    expect(bar.hidden).toBe(false);
    center.dispose();
    expect(bar.hidden).toBe(true);
  });
});
