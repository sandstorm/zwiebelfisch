// Tests for contribution-points.ts.
import { Extension, Mark, Node } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { describeContribution, describeSetting } from './contribution-points';

const describeAt = (point: string, ...args: unknown[]) => describeContribution(point, args);

describe('describeContribution', () => {
  it('a node or mark: its name, Tiptap priority (also inherited), the syntax and calls it parses', () => {
    const taskItem = Node.create({ name: 'taskItem', priority: 110 });
    const spec = { name: 'taskItem', tiptap: taskItem.extend({}), typst: { parseTypst: { syntaxNodes: { ListItem: {} }, calls: { task: {} } } }, view: { box: 'code' } };
    expect(describeAt('visualEditor.registerNode', spec)).toEqual({
      title: 'taskItem',
      details: ['priority 110', 'parses ListItem', 'parses #task(..)', 'code box'],
      rank: [-110],
    });
    // the node type's own extension among those the spec's brings
    const taskLists = Extension.create({ name: 'taskLists', addExtensions: () => [Node.create({ name: 'taskList', priority: 110 })] });
    expect(describeAt('visualEditor.registerNode', { name: 'taskList', tiptap: taskLists, typst: { parseTypst: { calls: { '*': {} } } } }).details).toEqual(['priority 110', 'parses any call']);
    expect(describeAt('visualEditor.registerNode', { name: 'heading', typst: {} }).details).toEqual(['type made by another spec']);
    expect(describeAt('visualEditor.registerMark', { name: 'bold', tiptap: Mark.create({ name: 'bold' }), typst: { parseTypst: { syntaxNodes: { Strong: {} } } } })).toEqual({
      title: 'bold',
      details: ['priority 100', 'parses Strong'],
      rank: [-100],
    });
  });

  it('commands and keybindings', () => {
    expect(describeAt('commands.registerCommand', 'files.newFile', () => {}).title).toBe('files.newFile');
    expect(describeAt('contributes.keybindings', 'Ctrl+Alt+M', 'comments.addComment').title).toBe('Ctrl+Alt+M → comments.addComment');
  });

  it('submenus, floating bars, menu items, side panels, status bar items: where they go and in which order', () => {
    expect(describeAt('visualEditor.registerSubmenu', { id: 'visualEditor/align', label: 'Align', parent: 'visualEditor/toolbar', group: '4_align', icon: () => '' })).toEqual({
      title: 'visualEditor/align',
      details: ['"Align"', 'in visualEditor/toolbar', 'group 4_align', 'order 0'],
      rank: ['visualEditor/toolbar', 1, '4_align', 0],
    });
    expect(describeAt('visualEditor.registerFloatingBar', { id: 'visualEditor/table', label: 'Table', order: 20, anchor: () => null })).toEqual({ title: 'visualEditor/table', details: ['"Table"', 'order 20'], rank: [20] });
    expect(describeAt('workbench.registerMenuItem', 'visualEditor/insert', { command: 'tables.insertTable', title: 'Insert table', order: 20, keybinding: 'Mod+Alt+T' }).details).toEqual([
      'menu visualEditor/insert',
      'order 20',
      '→ tables.insertTable',
      'Mod+Alt+T',
    ]);
    expect(describeAt('workbench.registerMenuItem', 'files/context', { command: 'files.rename', title: 'Rename…', group: 'navigation', order: 2 })).toEqual({
      title: 'Rename…',
      details: ['menu files/context', 'group navigation', 'order 2', '→ files.rename'],
      rank: ['files/context', 0, 'navigation', 2],
    });
    expect(describeAt('workbench.registerSidePanel', 'outline', { label: 'Outline', icon: {}, order: 20 })).toEqual({ title: 'outline', details: ['"Outline"', 'left', 'order 20'], rank: ['left', 20] });
    expect(describeAt('workbench.registerSidePanel', 'devtools', { label: 'Devtools', icon: {}, side: 'right' })).toEqual({ title: 'devtools', details: ['"Devtools"', 'right', 'order 0'], rank: ['right', 0] });
    expect(describeAt('window.registerStatusBarItem', { textContent: ' 12 words ', nodeName: 'SPAN' }, { alignment: 'right', priority: 5 })).toEqual({
      title: '12 words',
      details: ['right', 'priority 5'],
      rank: [1, -5],
    });
    expect(describeAt('preview.registerToolbarItem', function zoom() {}, { group: '2_view', order: 1 })).toEqual({ title: 'zoom', details: ['group 2_view', 'order 1'], rank: [1, '2_view', 1] });
  });

  it('custom editors: view type, name, files, priority', () => {
    expect(describeAt('window.registerCustomEditorProvider', 'diagrams.editor', {}, { displayName: 'Diagram', filenamePattern: '*.drawio.png', priority: 'option' })).toEqual({
      title: 'diagrams.editor',
      details: ['"Diagram"', '*.drawio.png', 'priority option'],
      rank: [2, -100],
    });
  });

  it('providers: their name, priority and trigger', () => {
    function images() {}
    expect(describeAt('visualEditor.registerRawBoxRenderer', images, { priority: 110 })).toEqual({ title: 'images', details: ['priority 110'], rank: [-110] });
    expect(describeAt('languages.registerDocumentLinkProvider', { language: 'typst' }, { provideDocumentLinks: () => [] })).toEqual({
      title: 'document links',
      details: ['language typst', 'priority 100'],
      rank: [-100],
    });
    expect(describeAt('visualEditor.registerCompletionItemProvider', { provideCompletionItems: () => [] }, { char: '@', allowedPrefixes: [' ', '('] })).toEqual({
      title: 'trigger "@"',
      details: ['after " ", "("'],
      rank: ['@'],
    });
    expect(describeAt('preview.registerPdfExportOption', { id: 'comments.include', label: 'Include comments', default: false, apply: () => ({}) })).toEqual({
      title: 'comments.include',
      details: ['"Include comments"', 'default false'],
    });
    expect(describeAt('scm.registerSourceControl', { id: 'gitlab', label: 'GitLab' }).details).toEqual(['"GitLab"']);
    expect(describeAt('window.registerFileDecorationProvider', new (class Presence {})()).title).toBe('Presence');
  });

  it('a style sheet by its size; an unknown point by the generic summary', () => {
    expect(describeAt('workbench.registerStyleSheet', '.a {}'.repeat(500)).details).toEqual(['2.4 kB']);
    expect(describeAt('somewhere.registerThing', 'thing.id', { priority: 3 })).toEqual({ title: 'thing.id · priority 3', details: [] });
  });
});

describe('describeSetting', () => {
  it('a setting: its id, type, default and values', () => {
    expect(describeSetting('files.panel', { type: 'string', default: 'auto', enum: ['auto', 'hide'], description: '' })).toEqual({
      title: 'files.panel',
      details: ['string', 'default "auto"', 'one of "auto", "hide"'],
    });
    expect(describeSetting('x.y', { type: ['string', 'null'], default: null, description: '' }).details).toEqual(['string | null', 'default null']);
  });
});
