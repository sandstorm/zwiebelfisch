// End-to-end tests (Playwright, against the demo build): guest links of GitLab-backed rooms (needs the fake GitLab
// server with ZWF_GUESTS=1: mise run test:e2e-gitlab).
import { expect, type Browser, type Page } from '@playwright/test';
import { SERVER_DEMO, fileRow, serve, signIn, test } from './fixtures';

// A member (Ann, signed in at the fake GitLab) shares a fresh branch of demo/report with a guest (Jane, in a browser
// session of her own, never signed in): the guest joins by the link with her name, sees that she is a guest, edits;
// only the member saves; revoking the link ends the guest's access.
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
  await page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'Share with guests…' }).click();
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

const guestBanner = (page: Page) => page.locator('.zwf-guests__banner--guest');
const guestBadge = (page: Page) => page.locator('.zwf-guests__badge--guest');
const sharedBanner = (page: Page) => page.locator('.zwf-guests__banner--shared');
const sharedBadge = (page: Page) => page.locator('.zwf-guests__badge--shared');
const messages = (page: Page) => page.getByTestId('zwf-notifications');
const visualText = (page: Page, text: string) => page.getByTestId('zwf-visual').getByText(text);

test('a guest joins by the link, sees that they are one, edits; only members save; revoking ends their access', async ({ browser, baseURL }, info) => {
  const room = newRoom(info.project.name);
  const ann = await joinAsMember(browser, baseURL!, room, 'Ann');
  const link = await shareWithGuests(ann, 'ACME reviewers');
  await expect(sharedBanner(ann)).toContainText('Shared with guests · 0 online');

  const jane = await joinAsGuest(browser, baseURL!, link, 'Jane');
  expect(new URL(jane.url()).hash).not.toContain('zwf-guest'); // the secret left the URL at once
  await expect(jane.locator('.zwf-collaboration__account')).toHaveText('Jane (guest)');
  await expect(guestBanner(jane)).toContainText('Guest access · shared by Ann · ends in 7 days');
  await expect(guestBadge(jane)).toHaveText('GUEST · 7 d left');
  await expect(jane.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'Save to GitLab…' })).toHaveCount(0);
  await expect(jane.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'Share with guests…' })).toHaveCount(0);

  // Ann sees her guest
  await expect(sharedBadge(ann)).toHaveText('Shared · 1 guest');
  await expect(sharedBanner(ann)).toContainText('1 online');

  // Jane's edit reaches Ann; it is Ann's to save
  await jane.getByRole('tab', { name: 'Source' }).click();
  await jane.getByTestId('zwf-source').locator('.cm-line', { hasText: '#pagebreak()' }).click();
  await jane.keyboard.press('End');
  await jane.keyboard.press('Enter');
  await jane.keyboard.press('Enter');
  await jane.keyboard.type('From a guest.');
  await expect(visualText(ann, 'From a guest.')).toBeVisible();
  await expect(ann.locator('.zwf-source-control__entry')).toHaveText('Not in GitLab: 1 file · < 1 min (Jane (guest))');

  // Ann revokes the link: Jane is told, and her banner says her access ended
  await sharedBadge(ann).click();
  await ann.getByRole('dialog', { name: 'Guest links' }).getByRole('option', { name: /ACME reviewers/ }).click();
  await messages(ann).getByRole('button', { name: 'Revoke' }).click();
  await expect(messages(ann)).toContainText('Guest link "ACME reviewers" revoked.');
  await expect(messages(jane)).toContainText('Guest access to this project has ended.');
  await expect(guestBanner(jane)).toHaveText('Guest access has ended.');
  await expect(sharedBanner(ann)).toHaveCount(0);

  // the link is gone for good
  const late = await (await browser.newContext()).newPage();
  await serve(late, baseURL!);
  await late.goto(link);
  const field = late.getByRole('form', { name: 'Join as a guest' }).getByRole('textbox');
  await field.fill('Late');
  await field.press('Enter');
  await expect(messages(late)).toContainText('This link is invalid or has expired.');
});
