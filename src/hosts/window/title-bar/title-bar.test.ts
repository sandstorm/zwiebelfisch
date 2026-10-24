// @vitest-environment jsdom
// Tests for title-bar.ts.
import { describe, expect, it } from 'vitest';
import { TitleBar } from './title-bar';

function setup() {
  const bar = document.createElement('div');
  const titleBar = new TitleBar(bar);
  const item = (text: string) => Object.assign(document.createElement('span'), { textContent: text });
  const side = (alignment: string) => [...bar.querySelector(`.zwf-editor__title-bar-${alignment}`)!.children].map((child) => child.textContent);
  return { bar, titleBar, item, side };
}

describe('TitleBar', () => {
  it('has a left, a center and a right side, each by priority (higher further left), then registration order', () => {
    const { bar, titleBar, item, side } = setup();
    titleBar.add(item('account'), { alignment: 'right' });
    titleBar.add(item('people'), { alignment: 'center' });
    titleBar.add(item('save'), { alignment: 'center', priority: 100 });
    titleBar.add(item('view'), { alignment: 'right', priority: 100 });
    titleBar.add(item('project'), { alignment: 'left' });
    expect([...bar.children].map((child) => child.className)).toEqual(['zwf-editor__title-bar-left', 'zwf-editor__title-bar-center', 'zwf-editor__title-bar-right']);
    expect([side('left'), side('center'), side('right')]).toEqual([['project'], ['save', 'people'], ['view', 'account']]);
  });

  it('takes a disposed item out and keeps the others in order', () => {
    const { titleBar, item, side } = setup();
    titleBar.add(item('a'), { alignment: 'right', priority: 3 });
    const b = titleBar.add(item('b'), { alignment: 'right', priority: 2 });
    titleBar.add(item('c'), { alignment: 'right', priority: 1 });
    b.dispose();
    b.dispose();
    expect(side('right')).toEqual(['a', 'c']);
  });

  it('is hidden while it has no item', () => {
    const { bar, titleBar, item } = setup();
    expect(bar.hidden).toBe(true);
    const left = titleBar.add(item('a'), { alignment: 'left' });
    const center = titleBar.add(item('b'), { alignment: 'center' });
    left.dispose();
    expect(bar.hidden).toBe(false);
    center.dispose();
    expect(bar.hidden).toBe(true);
  });
});
