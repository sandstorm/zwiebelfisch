// End-to-end tests (Playwright, against the demo build): guest links of GitLab-backed rooms (needs the fake GitLab
// server with ZWF_GUESTS=1: mise run test:e2e-gitlab).
import { expect, type Browser, type Page } from '@playwright/test';
import { SERVER_DEMO, fileRow, serve, signIn, test } from './fixtures';

// A member (Ann, signed in at the fake GitLab) shares a fresh branch of demo/report with a guest (Jane, in a browser
// session of her own, never signed in): the guest joins by the link with her name, sees that she is a guest, edits
// (but creates no file of a type guests may not change); only the member saves; revoking the link ends the guest's
// access.
test.use({ baseURL: SERVER_DEMO });

const newRoom = (project: string) => `gitlab:demo/report@e2e-guest-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Opens the room as the member `user`, signed in in a browser session of their own. */
async function joinAsMember(browser: Browser, baseURL: string, room: string, user: string): Promise<Page> {
  const context = await browser.newContext();
  await signIn(context, user);
  const page = await context.newPage();
  await serve(page, baseURL);
  await page.goto(`/?room=${encodeURIComponent(room)}`);
  await expect(fileRow(page, 'chapters')).toBeVisible();
  await expect(page.locator('.zwf-collaboration__account')).toHaveText(user);
  return page;
}

/** Ann makes a guest link for `label` (7 days, the default): the link, as shown once. */
async function shareWithGuests(page: Page, label: string): Promise<string> {
  await shareButton(page).click();
  await page.getByRole('menu', { name: 'Share with guests' }).getByRole('menuitem', { name: 'New guest link…' }).click();
  const form = page.getByRole('form', { name: 'Share with guests' });
  await form.getByRole('textbox').fill(label);
  await form.getByRole('button', { name: 'OK' }).click();
  await page.getByRole('dialog', { name: 'Share with guests' }).getByRole('option', { name: /7 days/ }).click();
  const shown = page.getByRole('form', { name: 'Guest link (shown only now)' });
  const link = await shown.getByRole('textbox').inputValue();
  await shown.getByRole('button', { name: 'OK' }).click();
  expect(link).toMatch(/#zwf-guest=[A-Z2-7]{26}$/);
  return link;
}

/** Opens `link` in a browser session of its own (signed in nowhere) and joins as `name`. */
async function joinAsGuest(browser: Browser, baseURL: string, link: string, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await serve(page, baseURL);
  await page.goto(link);
  // asked while the room connects: Enter, not a click on OK (the connecting overlay lies over the editing area)
  const field = page.getByRole('form', { name: 'Join as a guest' }).getByRole('textbox');
  await field.fill(name);
  await field.press('Enter');
  await expect(fileRow(page, 'chapters')).toBeVisible();
  return page;
}

const titleBar = (page: Page) => page.getByTestId('zwf-title-bar');
/** The guest's access in the title bar ("Guest access · until …"), which tints it. */
const guestAccess = (page: Page) => titleBar(page).locator('.zwf-guests__access');
/** The member's "Share" ("Shared · N guests" while the room has links). */
function shareButton(page: Page) {
  return titleBar(page).locator('.zwf-guests__share');
}
const messages = (page: Page) => page.getByTestId('zwf-notifications');
const visualText = (page: Page, text: string) => page.getByTestId('zwf-visual').getByText(text);

test('a guest joins by the link, sees that they are one, edits; only members save; revoking ends their access', async ({ browser, baseURL }, info) => {
  const room = newRoom(info.project.name);
  const ann = await joinAsMember(browser, baseURL!, room, 'Ann');
  const link = await shareWithGuests(ann, 'ACME reviewers');
  await expect(shareButton(ann)).toHaveText('Shared · 0 guests');

  const jane = await joinAsGuest(browser, baseURL!, link, 'Jane');
  expect(new URL(jane.url()).hash).not.toContain('zwf-guest'); // the secret left the URL at once
  await expect(jane.locator('.zwf-collaboration__account')).toHaveText('Jane (guest)');
  await expect(guestAccess(jane)).toContainText('Guest access · until ');
  await expect(guestAccess(jane)).toHaveAttribute('title', 'You are a guest of Ann: you edit, members save.');
  await expect(guestAccess(jane)).toHaveAttribute('data-background', 'warning');
  await expect(titleBar(jane).getByRole('button', { name: 'Save to GitLab…' })).toHaveCount(0);
  await expect(shareButton(jane)).toHaveCount(0);

  // Ann sees her guest
  await expect(shareButton(ann)).toHaveText('Shared · 1 guest');
  await expect(shareButton(ann)).toHaveAttribute('title', /; 1 online\./);

  // a file of a type guests may not change: not created, and Jane is told why
  await jane.getByTestId('zwf-files').getByRole('button', { name: 'New', exact: true }).click();
  await jane.getByRole('menu', { name: 'New' }).getByRole('menuitem', { name: 'New file…' }).click();
  await jane.getByRole('textbox', { name: 'File name' }).fill('notes.md');
  await jane.getByRole('textbox', { name: 'File name' }).press('Enter');
  await expect(messages(jane)).toContainText('notes.md cannot be created here: it would be read-only.');
  await expect(fileRow(jane, 'notes.md')).toHaveCount(0);

  // Jane's edit reaches Ann; it is Ann's to save
  await jane.getByRole('tab', { name: 'Source' }).click();
  await jane.getByTestId('zwf-source').locator('.cm-line', { hasText: '#pagebreak()' }).click();
  await jane.keyboard.press('End');
  await jane.keyboard.press('Enter');
  await jane.keyboard.press('Enter');
  await jane.keyboard.type('From a guest.');
  await expect(visualText(ann, 'From a guest.')).toBeVisible();
  await expect(ann.locator('.zwf-source-control__entry')).toHaveText('Not in GitLab: 1 file · < 1 min (Jane (guest))');

  // a notification stands at the top right below the title bar, not over it
  const [bar, note] = await Promise.all([titleBar(jane).boundingBox(), messages(jane).getByRole('alert').first().boundingBox()]);
  expect(note!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
  expect(note!.x + note!.width).toBeGreaterThan(bar!.x + bar!.width - 40);

  // Ann revokes the link from the Share menu, confirmed on a modal card: Jane is told, and her title bar says her access ended
  await shareButton(ann).click();
  await ann.getByRole('menu', { name: 'Share with guests' }).getByRole('menuitem', { name: /^Revoke “ACME reviewers” \(until .* · 1 online\)…$/ }).click();
  const confirm = ann.getByTestId('zwf-modal').getByRole('alertdialog', { name: 'Revoke the guest link “ACME reviewers”?' });
  await expect(confirm.getByRole('button')).toHaveText(['Revoke', 'Cancel']);
  await confirm.getByRole('button', { name: 'Revoke' }).click();
  await expect(messages(ann)).toContainText('Guest link “ACME reviewers” revoked.');
  await expect(messages(jane)).toContainText('Guest access to this project has ended.');
  await expect(guestAccess(jane)).toHaveText('Guest access has ended.');
  await expect(guestAccess(jane)).toHaveAttribute('data-background', 'error');
  await expect(shareButton(ann)).toHaveText('Share');

  // the link is gone for good
  const late = await (await browser.newContext()).newPage();
  await serve(late, baseURL!);
  await late.goto(link);
  const field = late.getByRole('form', { name: 'Join as a guest' }).getByRole('textbox');
  await field.fill('Late');
  await field.press('Enter');
  await expect(messages(late)).toContainText('This link is invalid or has expired.');
});
