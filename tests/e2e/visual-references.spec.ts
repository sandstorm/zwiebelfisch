// End-to-end tests (Playwright, against the plain-HTML example): references as chips, labels as tags, the @ list.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { caretAtEnd, selectText } from './visual-helpers';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const MAIN = '= Introduction <intro>\n\nThis report: @method describes the setup.\n\n#include "method.typ"\n';
const METHOD = '= Method <method>\n\nAs @intro says, we measure.\n';

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await page.locator('zwiebelfisch-editor').evaluate(
    (el: Editor, { main, method }) => {
      el.files = { '/method.typ': method };
      el.value = main;
    },
    { main: MAIN, method: METHOD },
  );
});

/** The shown file's Visual editor (each file has its own). */
const visual = (page: Page) => page.locator('zwiebelfisch-editor [data-testid="typst-visual"]:visible');
const value = (page: Page) => () => page.locator('zwiebelfisch-editor').evaluate((el: Editor) => el.value);
const methodFile = (page: Page) => () => page.locator('zwiebelfisch-editor').evaluate((el: Editor) => el.files['/method.typ'] as string);

test('a heading label is a tag in the heading; a reference is a chip saying what it points to', async ({ page }) => {
  await expect(visual(page).locator('h1').getByTestId('typst-label-tag')).toHaveText('intro');
  const chip = visual(page).locator('.typst-labels__ref[data-target="method"]');
  await expect(chip).toHaveAttribute('data-hint', 'Section · Method');
  // the hint is a hover tooltip only: nothing is drawn after the name
  expect(await chip.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('none');
  await expect(visual(page).locator('.typst-visual__raw-block', { hasText: '<intro>' })).toHaveCount(0);
});

test('typing @ lists the labels; Enter inserts the chosen one as a reference', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.type(' See @');
  // the shown editor's @ list (every editor has one per completion item provider)
  const list = page.locator('zwiebelfisch-editor [data-testid="typst-suggest"][data-trigger="@"]:visible');
  await expect(list.getByRole('option')).toHaveText([/^intro/, /^method/]);
  await page.keyboard.type('int');
  await expect(list.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(list).toHaveCount(0);
  await expect.poll(value(page)).toContain('describes the setup. See @intro\n');
  await expect(visual(page).locator('.typst-labels__ref[data-target="intro"]')).toHaveAttribute('data-hint', 'Section · Introduction');
});

test('a reference to a missing label is marked', async ({ page }) => {
  await page.locator('zwiebelfisch-editor').evaluate((el: Editor) => {
    el.value = 'See @nowhere.\n';
  });
  await expect(visual(page).locator('.typst-labels__ref--unknown')).toHaveText('nowhere');
});

/** Clicks the heading's label tag and picks `choice` in the quick pick it opens. */
async function tagChoice(page: Page, choice: string) {
  await visual(page).locator('h1').getByTestId('typst-label-tag').click();
  const pick = page.locator('zwiebelfisch-editor').getByRole('dialog', { name: 'Label <intro>' });
  await pick.getByRole('option', { name: choice }).click();
}

test('renaming a label from its tag updates the references in every file', async ({ page }) => {
  await tagChoice(page, 'Rename… and update 1 reference'); // the first choice while anything refers to it
  const form = page.locator('zwiebelfisch-editor').getByRole('form', { name: 'Rename <intro> and update 1 reference' });
  await form.getByRole('textbox', { name: 'Label name' }).fill('start');
  await form.getByRole('textbox', { name: 'Label name' }).press('Enter');
  await expect.poll(value(page)).toContain('= Introduction <start>\n');
  await expect.poll(methodFile(page)).toContain('As @start says');
  await expect(visual(page).locator('h1').getByTestId('typst-label-tag')).toHaveText('start');
});

test('removing a label from its tag', async ({ page }) => {
  await tagChoice(page, 'Remove label');
  await expect.poll(value(page)).toContain('= Introduction\n\n');
  await expect(visual(page).locator('h1').getByTestId('typst-label-tag')).toHaveCount(0);
});

test("a text selection's bar offers Add label where the block has none: the heading gets a tag", async ({ page }) => {
  await page.locator('zwiebelfisch-editor').evaluate((el: Editor) => {
    el.value = '= Results\n\nText\n';
  });
  const heading = visual(page).locator('h1');
  await selectText(heading, 'Results');
  const bar = page.locator('zwiebelfisch-editor [role="toolbar"][aria-label="Selection"]:visible');
  await bar.getByRole('button', { name: 'Add label' }).click();
  const draft = visual(page).getByRole('textbox', { name: 'New label' });
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('sec:');
  await page.keyboard.type('results');
  await page.keyboard.press('Enter');
  await expect.poll(value(page)).toBe('= Results <sec:results>\n\nText\n');
  await expect(heading.getByTestId('typst-label-tag')).toHaveText('sec:results');
  // labelled now: the bar has no Add label (the tag renames or removes it)
  await selectText(heading, 'Results');
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Add label' })).toBeHidden();
});
