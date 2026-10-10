// @vitest-environment jsdom
// Tests for page-number.ts.
import { expect, it } from 'vitest';
import type { PreviewContext } from '../preview';
import { pageNumber } from './page-number';

it('shows the visible page and the page count, nothing without pages', () => {
  let visible = { index: 0, count: 0 };
  const item = pageNumber({ ownerDocument: document, visiblePage: () => visible } as PreviewContext);
  item.update!();
  expect(item.elements[0].textContent).toBe('');
  visible = { index: 2, count: 12 };
  item.update!();
  expect(item.elements[0].textContent).toBe('3 / 12');
});
