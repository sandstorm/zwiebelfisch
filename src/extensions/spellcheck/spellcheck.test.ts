// @vitest-environment jsdom
// Tests for spellcheck.ts: the spellcheck and lang attributes of a Visual editor's editable element.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import { VisualEditor, VisualEditorHost } from '../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../hosts/workbench/workbench';
import { WorkspaceHost } from '../../hosts/workspace/workspace';
import { spellcheck } from './spellcheck';

const path = ProjectPath.of;

/** `spellcheck` activated over `files` with `settings`, and a Visual editor of `shown` (default: the main file). */
function setup(files: Record<string, string>, settings = {}, shown = '/main.typ') {
  const project = new Project(path('/main.typ'), files);
  const workspace = new WorkspaceHost(project, { settings });
  const extension = spellcheck();
  workspace.declare(extension.contributes!.configuration!.properties);
  const visualEditor = new VisualEditorHost();
  extension.activate({ project, workspace, visualEditor, subscriptions: [] } as unknown as ExtensionContext);
  const parent = document.body.appendChild(document.createElement('div'));
  new VisualEditor(parent, project.document(path(shown))!, visualEditor);
  const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
  return { project, workspace, editable };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('spellcheck', () => {
  it("sets spellcheck on the editable element, beside the host's attributes, and follows the setting", () => {
    const { workspace, editable } = setup({ '/main.typ': 'Hello\n' });
    expect(editable.getAttribute('spellcheck')).toBe('true');
    expect(editable.classList.contains('typst-visual')).toBe(true);
    expect(editable.hasAttribute('lang')).toBe(false);
    workspace.update({ 'spellcheck.enabled': false });
    expect(editable.getAttribute('spellcheck')).toBe('false');
    workspace.update({});
    expect(editable.getAttribute('spellcheck')).toBe('true');
  });

  it('starts off when the setting says so', () => {
    expect(setup({ '/main.typ': 'Hello\n' }, { 'spellcheck.enabled': false }).editable.getAttribute('spellcheck')).toBe('false');
  });

  it('sets lang from set text(lang, region), read again a moment after an edit', () => {
    const { project, editable } = setup({ '/main.typ': '#set text(lang: "de", region: "AT")\n\nServus\n' });
    expect(editable.getAttribute('lang')).toBe('de-AT');
    project.document(path('/main.typ'))!.setText('#set text(lang: "fr")\n\nSalut\n', null);
    expect(editable.getAttribute('lang')).toBe('de-AT');
    vi.runAllTimers();
    expect(editable.getAttribute('lang')).toBe('fr');
    project.document(path('/main.typ'))!.setText('Hello\n', null);
    vi.runAllTimers();
    expect(editable.hasAttribute('lang')).toBe(false);
  });

  it("takes another file's language from its own rule, else from the main file", () => {
    const files = { '/main.typ': '#set text(lang: "de")\n#include "a.typ"\n', '/a.typ': 'Hallo\n', '/b.typ': '#set text(lang: "en")\nHello\n' };
    expect(setup(files, {}, '/a.typ').editable.getAttribute('lang')).toBe('de');
    expect(setup(files, {}, '/b.typ').editable.getAttribute('lang')).toBe('en');
  });
});
