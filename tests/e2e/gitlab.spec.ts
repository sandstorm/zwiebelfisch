// End-to-end tests (Playwright, against the demo build): GitLab-backed rooms (needs the fake GitLab server: mise run test:e2e-gitlab).
import { expect, type Browser, type Page } from '@playwright/test';
import { SERVER, SERVER_DEMO, fileRow, openFile, serve, signIn, test } from './fixtures';

// A room backed by a (fake, in-memory) GitLab branch. Needs the server with
// the fake GitLab: run through `mise run test:e2e-gitlab`, which starts it
// (ws://127.0.0.1:1234; every test gets a fresh branch of demo/report, which
// holds the demo's advanced example: template, chapters, SVG images). Everyone
// signs in at the fake GitLab first (any name; everyone is a Developer).
test.skip(!process.env.TYPST_GITLAB_E2E, 'needs the collaboration server with a fake GitLab: mise run test:e2e-gitlab');
test.use({ baseURL: SERVER_DEMO });

/** Opens the room as `user`, signed in in a browser session of their own (main.typ shown). */
async function join(browser: Browser, baseURL: string, room: string, user: string): Promise<Page> {
  const context = await browser.newContext();
  await signIn(context, user);
  const page = await context.newPage();
  await serve(page, baseURL);
  await page.goto(`/?room=${encodeURIComponent(room)}`);
  await expect(fileRow(page, 'chapters')).toBeVisible();
  await expect(account(page)).toHaveText(user);
  return page;
}

/** The account's status bar entry ("Sign in", or the user's name). */
const account = (page: Page) => page.locator('.typst-collaboration__account');

/** Text in the Visual editor of the file shown (each opened file keeps a hidden Visual editor of its own). */
const visualText = (page: Page, text: string) => page.getByTestId('typst-visual').getByText(text);

/** A fresh room: a branch of its own. */
const newRoom = (project: string) => `gitlab:demo/report@e2e-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function users(browser: Browser, baseURL: string, project: string, room = newRoom(project)) {
  return { room, ann: await join(browser, baseURL, room, 'Ann'), bob: await join(browser, baseURL, room, 'Bob') };
}

async function saveToGitLab(page: Page, message: string): Promise<void> {
  await page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'Save to GitLab…' }).click();
  const form = page.getByRole('form', { name: 'Save to GitLab' });
  await form.getByRole('textbox', { name: 'Commit message' }).fill(message);
  await form.getByRole('button', { name: 'OK' }).click();
}

/** The messages shown to `page`'s user (outcomes and news of the source control). */
const messages = (page: Page) => page.getByTestId('typst-notifications');

/** The source control's status bar entry ("Not in GitLab: …" / "Saved · …"). */
const scmStatus = (page: Page) => page.locator('.typst-source-control__entry');

/** The M / A / D badge of `path` in the file panel (the panel may be closed). */
const changeBadge = (page: Page, path: string) =>
  page.getByTestId('typst-files').locator(`[data-path="${path}"] .typst-files__decoration[title$="not in GitLab yet"]`);

test('the branch is loaded with its files, images from the repository', async ({ browser, baseURL }, info) => {
  const { ann } = await users(browser, baseURL!, info.project.name);
  await expect(fileRow(ann, 'template.typ')).toBeVisible();
  await fileRow(ann, 'assets').click();
  await expect(fileRow(ann, 'assets/compile-times.svg')).toBeVisible();
  await expect(ann.locator('[data-testid=typst-preview] svg image, [data-testid=typst-preview] svg use').first()).toBeAttached();
});

test('Save to GitLab commits, and everyone in the room is told', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  // the main file's Visual editor is all raw boxes, so Ann types in Source
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('typst-source').locator('.cm-line', { hasText: '#pagebreak()' }).click();
  await ann.keyboard.press('End');
  await ann.keyboard.press('Enter');
  await ann.keyboard.press('Enter');
  await ann.keyboard.type('Again.');
  await expect(visualText(bob, 'Again.')).toBeVisible();
  // always visible: what is not in GitLab yet, for everyone
  for (const page of [ann, bob]) {
    await expect(scmStatus(page)).toHaveText('Not in GitLab: 1 file · < 1 min (Ann)');
    await expect(changeBadge(page, '/main.typ')).toHaveText('M');
  }

  await saveToGitLab(ann, 'Add a line');
  await expect(messages(ann)).toContainText('Saved version');
  await expect(messages(bob)).toContainText('Saved version');
  for (const page of [ann, bob]) {
    await expect(scmStatus(page)).toHaveText(/^Saved · [0-9a-f]{8}$/);
    await expect(changeBadge(page, '/main.typ')).toHaveCount(0);
  }
});

test('a click on the status bar entry opens the save dialog', async ({ browser, baseURL }, info) => {
  const { ann } = await users(browser, baseURL!, info.project.name);
  await expect(scmStatus(ann)).toHaveText(/^Saved · /);
  await scmStatus(ann).click();
  await expect(ann.getByRole('form', { name: 'Save to GitLab' })).toBeVisible();
});

test('a simulated upstream commit (playground endpoint) is merged into the room', async ({ browser, baseURL, request }, info) => {
  const { room, ann, bob } = await users(browser, baseURL!, info.project.name);
  const response = await request.post(`${SERVER}/playground/upstream?room=${encodeURIComponent(room)}`);
  expect(response.ok()).toBe(true);
  for (const page of [ann, bob]) {
    await expect(messages(page).getByRole('status').filter({ hasText: 'Merged new changes from GitLab' })).toBeVisible();
    await openFile(page, 'chapters/introduction.typ');
    await expect(visualText(page, 'a colleague added this paragraph on GitLab')).toBeVisible();
  }
});

test('a conflict with upstream is shown to everyone, also to who joins later, until it is resolved', async ({ browser, baseURL, request }, info) => {
  const { room, ann, bob } = await users(browser, baseURL!, info.project.name);
  await openFile(ann, 'chapters/introduction.typ');
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('typst-source').locator('.cm-line', { hasText: '= Introduction' }).click();
  await ann.keyboard.press('End');
  await ann.keyboard.type(' mine');
  await expect(scmStatus(ann)).toHaveText('Not in GitLab: 1 file · < 1 min (Ann)');
  // a colleague revises the same heading on GitLab
  const response = await request.post(`${SERVER}/playground/upstream?room=${encodeURIComponent(room)}&change=heading`);
  expect(response.ok()).toBe(true);
  const cleo = await join(browser, baseURL!, room, 'Cleo');
  for (const page of [ann, bob, cleo]) {
    await expect(scmStatus(page).first()).toHaveText('Conflict with GitLab: chapters/introduction.typ');
    await expect(scmStatus(page).first()).toHaveClass(/typst-source-control__entry--warning/);
  }
  // Ann has the file open (its folder, too)
  await expect(ann.getByTestId('typst-files').locator('[data-path="/chapters/introduction.typ"] .typst-files__decoration[title^="Conflicts"]')).toHaveText('!');
});

test('a save that cannot reach GitLab stays a warning for everyone, also who joins later, until a save succeeds', async ({ browser, baseURL, request }, info) => {
  const { room, ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('typst-source').locator('.cm-line', { hasText: '#pagebreak()' }).click();
  await ann.keyboard.press('End');
  await ann.keyboard.type(' Unsaved.');
  await expect(scmStatus(ann)).toHaveText('Not in GitLab: 1 file · < 1 min (Ann)');
  // the fake GitLab cannot be reached for this branch
  const outage = (on: boolean) => request.post(`${SERVER}/playground/outage?room=${encodeURIComponent(room)}&on=${on}`);
  expect((await outage(true)).ok()).toBe(true);

  await saveToGitLab(ann, 'Try');
  await expect(messages(ann)).toContainText('Saving failed: GitLab could not be reached');
  const cleo = await join(browser, baseURL!, room, 'Cleo');
  for (const page of [ann, bob, cleo]) {
    await expect(scmStatus(page).first()).toHaveText('Saving to GitLab failed');
    await expect(scmStatus(page).first()).toHaveClass(/typst-source-control__entry--warning/);
  }

  expect((await outage(false)).ok()).toBe(true);
  await saveToGitLab(ann, 'Try again');
  // the warning and the pending changes stay until the save is done: then only the saved version is left
  for (const page of [ann, bob, cleo]) await expect(scmStatus(page)).toHaveText([/^Saved · [0-9a-f]{8}$/]);
});

test('leaving as the last user with unsaved changes asks first, when the server does not save by itself', async ({ browser, baseURL, request }, info) => {
  // this room never saves by itself (playground endpoint; the server's setting stays for the others)
  const room = newRoom(info.project.name);
  expect((await request.post(`${SERVER}/playground/auto-commit?room=${encodeURIComponent(room)}`)).ok()).toBe(true);
  const { ann, bob } = await users(browser, baseURL!, info.project.name, room);
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('typst-source').locator('.cm-line', { hasText: '#pagebreak()' }).click();
  await ann.keyboard.press('End');
  await ann.keyboard.type(' Unsaved.');
  await expect(scmStatus(bob)).toHaveText('Not in GitLab: 1 file · < 1 min (Ann)');
  const annInTree = bob.getByTestId('typst-files').locator('[data-path="/main.typ"] .typst-files__decoration[title="Ann"]');
  await expect(annInTree).toHaveCount(1);

  // Bob is still there: Ann leaves without a question
  ann.on('dialog', (dialog) => {
    throw new Error(`unexpected ${dialog.type()} dialog`);
  });
  const annClosed = ann.waitForEvent('close');
  await ann.close({ runBeforeUnload: true });
  await annClosed;
  await expect(annInTree).toHaveCount(0);

  // Bob is the last one: the browser asks
  await bob.getByTestId('typst-source').or(bob.getByTestId('typst-visual')).first().click();
  const dialog = bob.waitForEvent('dialog');
  await bob.close({ runBeforeUnload: true });
  expect((await dialog).type()).toBe('beforeunload');
  await (await dialog).accept();
});

test('leaving as the last user while a conflict blocks saving asks first, also when the server saves by itself', async ({ browser, baseURL, request }, info) => {
  const room = newRoom(info.project.name);
  const ann = await join(browser, baseURL!, room, 'Ann');
  await openFile(ann, 'chapters/introduction.typ');
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('typst-source').locator('.cm-line', { hasText: '= Introduction' }).click();
  await ann.keyboard.press('End');
  await ann.keyboard.type(' mine');
  await expect(scmStatus(ann)).toHaveText('Not in GitLab: 1 file · < 1 min (Ann)');
  const response = await request.post(`${SERVER}/playground/upstream?room=${encodeURIComponent(room)}&change=heading`);
  expect(response.ok()).toBe(true);
  await expect(scmStatus(ann).first()).toHaveText('Conflict with GitLab: chapters/introduction.typ');

  const dialog = ann.waitForEvent('dialog');
  await ann.close({ runBeforeUnload: true });
  expect((await dialog).type()).toBe('beforeunload');
  await (await dialog).accept();
});

test('saving without changes says so', async ({ browser, baseURL }, info) => {
  const { ann } = await users(browser, baseURL!, info.project.name);
  await saveToGitLab(ann, 'Nothing');
  await expect(messages(ann).getByRole('status').filter({ hasText: 'No changes to save' })).toBeVisible();
});

test('signed out: the widget offers to sign in, the fake GitLab signs in, back in the room; Sign out', async ({ page }, info) => {
  const room = newRoom(info.project.name);
  await page.goto(`/?room=${encodeURIComponent(room)}`);
  await expect(messages(page)).toContainText('Sign in to join this room.');
  await expect(account(page)).toHaveText('Sign in');
  await messages(page).getByRole('button', { name: 'Sign in' }).click();
  // the fake GitLab's page (on the server), then back to the room
  await expect(page.getByRole('heading', { name: 'Sign in to the fake GitLab' })).toBeVisible();
  await page.getByRole('button', { name: 'Cleo' }).click();
  // the fragment names the file shown
  await expect(page).toHaveURL((url) => `${url.origin}${url.pathname}${url.search}` === `${SERVER_DEMO}/?room=${encodeURIComponent(room)}`);
  await expect(fileRow(page, 'chapters')).toBeVisible();
  await expect(account(page)).toHaveText('Cleo');

  await account(page).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(account(page)).toHaveText('Sign in');
  await expect(messages(page)).toContainText('Sign in to join this room.');
});

test('a plain room on this server (plain rooms off): the bar and the widget say it opens only GitLab rooms', async ({ page }) => {
  await signIn(page.context(), 'Ann');
  await page.goto('/?room=plain-e2e');
  await expect(page.locator('#playground').getByRole('status')).toContainText('only GitLab rooms');
  await expect(messages(page)).toContainText('Cannot join the room: This server opens only GitLab rooms');
});
