// The demo as a static site (GitHub Pages, .github/workflows/pages.yml): no server, nothing saved. See main.ts.
import type { Extension } from '../src';

/**
 * Whether this page is the static-site build (`mise run build:demo -- --mode static`): served as plain files next to
 * the docs' HTML pages, with no playground server and no docs-files plugin behind it. There the demo opens the
 * Documentation example, offers Local mode only, and says that nothing is saved. Every other build (the dev server,
 * demo:build, the e2e build, the Docker image) is the playground as it was.
 */
export const STATIC_SITE = import.meta.env.MODE === 'static';

/** What the static site says about saving: in its banner, and when someone saves (⌘S / Ctrl+S). */
export const READ_ONLY = 'Read-only demo: edit as you like, nothing is saved. Your edits stay in this page; reloading it starts over.';

/** The banner above the playground bar: read-only, and the way back to the docs (the site's top, one folder up). */
export function readOnlyBanner(document: Document): HTMLElement {
  const banner = document.createElement('p');
  banner.className = 'demo-notice';
  banner.setAttribute('role', 'note');
  banner.dataset.testid = 'read-only-notice';
  const back = document.createElement('a');
  back.href = '../';
  back.textContent = 'Back to the docs';
  banner.append(`${READ_ONLY} `, back);
  return banner;
}

/**
 * Save (`workbench.action.files.save`, ⌘S / Ctrl+S) on the static site: saves nothing, says so instead of the
 * browser's "Save page as".
 */
export function readOnlySave(): Extension {
  return {
    id: 'read-only-save',
    contributes: {
      commands: [{ command: SAVE, title: 'Save' }],
      keybindings: [{ command: SAVE, key: 'Mod+KeyS' }],
    },
    activate({ commands, window, subscriptions }) {
      subscriptions.push(commands.registerCommand(SAVE, () => void window.showInformationMessage(READ_ONLY)));
    },
  };
}

const SAVE = 'workbench.action.files.save';
