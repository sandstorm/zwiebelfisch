// Tests for label-edits.ts: inserting references, editing, removing and renaming labels.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { find, schemaWith, TestPrompts, visualEditorExtension } from '../../../testing/testing';
import { Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { LabelIndex } from '../model/label-index';
import { serializeToTypst, parseTypst } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';
import { insertReference, renameLabel, setLabel } from './label-edits';
import { labelName } from '../model/reference-syntax';
import { registerReferences } from './visual-editor';

const introduction = readFileSync(new URL('../../../../demo/examples/advanced/chapters/introduction.typ', import.meta.url), 'utf8');
const results = readFileSync(new URL('../../../../demo/examples/advanced/chapters/results.typ', import.meta.url), 'utf8');

/** The labels of a project with one empty file. */
const noLabels = () => new LabelIndex(new Project(ProjectPath.of('/main.typ'), { '/main.typ': '' }));
const schema = schemaWith({ contributions: [visualEditorExtension((visualEditor) => registerReferences(visualEditor, { labels: noLabels(), prompts: new TestPrompts() }))] });
const stateOf = (source: string) => EditorState.create({ doc: parseTypst(source, schema) });

describe('label edits', () => {
  it('inserts a reference in place of the typed @query', () => {
    const state = stateOf('See \\@me now\n'); // typed text: `@me`
    const from = 1 + 'See '.length;
    const tr = insertReference(state, { from, to: from + 3 }, 'method');
    expect(serializeToTypst(tr.doc)).toBe('See @method now\n');
    expect(tr.selection.from).toBe(from + 1);
  });

  it('renames the label of the advanced example\'s introduction, and only the label', () => {
    const state = stateOf(introduction);
    const heading = find(state.doc, 'heading').pos;
    expect(serializeToTypst(renameLabel(state, heading, 'start', false).doc)).toBe(introduction.replace('<intro>', '<start>'));
  });

  it('renames a figure label together with its references in the same file', () => {
    const state = stateOf(results);
    let figure = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'figure' && node.attrs.label?.name === 'fig:compile-times') figure = pos;
    });
    const renamed = serializeToTypst(renameLabel(state, figure, 'fig:times', true).doc);
    expect(renamed).toBe(results.replaceAll('fig:compile-times', 'fig:times'));
    expect(serializeToTypst(renameLabel(state, figure, 'fig:times', false).doc)).toBe(results.replace('<fig:compile-times>', '<fig:times>'));
  });

  it('removes a label with the whitespace before it', () => {
    const state = stateOf(introduction);
    const heading = find(state.doc, 'heading').pos;
    expect(serializeToTypst(setLabel(state, heading, null).doc)).toBe(introduction.replace(' <intro>', ''));
  });

  it('adds a label after a space; keeps the gap when changing one', () => {
    const state = stateOf('= Goals\n\nText<t>\n');
    expect(serializeToTypst(setLabel(state, 0, 'goals').doc)).toBe('= Goals <goals>\n\nText<t>\n');
    const paragraph = find(state.doc, 'paragraph').pos;
    expect(serializeToTypst(setLabel(state, paragraph, 'u').doc)).toBe('= Goals\n\nText<u>\n');
  });

  it('turns typed text into a label name, or null', () => {
    expect(labelName(' intro ')).toBe('intro');
    expect(labelName('fig:compile times')).toBe('fig:compile-times');
    expect(labelName('a<b>c!')).toBe('abc');
    expect(labelName('sec.')).toBe('sec');
    expect(labelName('Größe_1')).toBe('Größe_1');
    expect(labelName(' <> ')).toBeNull();
  });
});
