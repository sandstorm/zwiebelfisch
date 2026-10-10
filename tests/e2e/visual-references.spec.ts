// End-to-end tests (Playwright, against the plain-HTML example): references as chips, labels as tags, the @ list.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { caretAtEnd } from './visual-helpers';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const MAIN = '= Introduction <intro>\n\nThis report: @method describes the setup.\n\n#include "method.typ"\n';
const METHOD = '= Method <method>\n\nAs @intro says, we measure.\n';

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await page.locator('typst-editor').evaluate(
    (el: Editor, { main, method }) => {
      el.files = { '/method.typ': method };
      el.value = main;
    },
    { main: MAIN, method: METHOD },
  );
});

/** The shown file's Visual view (each file has its own). */
const visual = (page: Page) => page.locator('typst-editor [data-testid="typst-visual"]:visible');
const value = (page: Page) => () => page.locator('typst-editor').evaluate((el: Editor) => el.value);
const methodFile = (page: Page) => () => page.locator('typst-editor').evaluate((el: Editor) => el.files['/method.typ'] as string);

test('a heading label is a tag in the heading; a reference is a chip saying what it points to', async ({ page }) => {
  await expect(visual(page).locator('h1').getByTestId('typst-label-tag')).toHaveText('intro');
  const chip = visual(page).locator('.typst-visual__ref[data-target="method"]');
  await expect(chip).toHaveAttribute('data-hint', 'Section · Method');
  // the hint is a hover tooltip only: nothing is drawn after the name
  expect(await chip.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('none');
  await expect(chip).toHaveAttribute('title', 'Section · Method (in method.typ)');
  await expect(visual(page).locator('.typst-visual__raw-block', { hasText: '<intro>' })).toHaveCount(0);
});

test('typing @ lists the labels; Enter inserts the chosen one as a reference', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.type(' See @');
  const list = page.locator('typst-editor').getByTestId('typst-ref-suggestions');
  await expect(list.getByRole('option')).toHaveText([/^intro/, /^method/]);
  await page.keyboard.type('int');
  await expect(list.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect.poll(value(page)).toContain('describes the setup. See @intro\n');
  await expect(visual(page).locator('.typst-visual__ref[data-target="intro"]')).toHaveAttribute('data-hint', 'Section · Introduction');
});

test('a reference to a missing label is marked', async ({ page }) => {
  await page.locator('typst-editor').evaluate((el: Editor) => {
    el.value = 'See @nowhere.\n';
  });
  await expect(visual(page).locator('.typst-visual__ref--unknown')).toHaveText('nowhere');
});

test('renaming a label from its tag updates the references in every file', async ({ page }) => {
  await visual(page).locator('h1').getByTestId('typst-label-tag').click();
  const form = page.locator('typst-editor').getByRole('form', { name: 'Label' });
  await form.getByRole('textbox', { name: 'Label name' }).fill('start');
  await expect(form.getByRole('button', { name: 'Rename and update 1 reference' })).toBeVisible();
  await form.getByRole('textbox', { name: 'Label name' }).press('Enter'); // updating the references is the default
  await expect.poll(value(page)).toContain('= Introduction <start>\n');
  await expect.poll(methodFile(page)).toContain('As @start says');
  await expect(visual(page).locator('h1').getByTestId('typst-label-tag')).toHaveText('start');
});

test('removing a label from its tag', async ({ page }) => {
  await visual(page).locator('h1').getByTestId('typst-label-tag').click();
  await page.locator('typst-editor').getByRole('form', { name: 'Label' }).getByRole('button', { name: 'Remove' }).click();
  await expect.poll(value(page)).toContain('= Introduction\n\n');
  await expect(visual(page).locator('h1').getByTestId('typst-label-tag')).toHaveCount(0);
});
