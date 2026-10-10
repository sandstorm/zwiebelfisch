// Tests for preview.ts: the PDF export option `comments.include`.
import { describe, expect, it } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import type { PdfEntry, PdfExportOption } from '../../../hosts/preview/preview';
import { registerIncludeComments } from './preview';

const path = ProjectPath.of;

const NOTED = '#import "@preview/drafting:0.2.2": margin-note\nText#margin-note[a note]\n';

function setup() {
  const project = new Project(path('/main.typ'), { '/main.typ': NOTED, '/logo.png': new Uint8Array([1]) });
  const options: PdfExportOption[] = [];
  const registration = registerIncludeComments(
    { registerPdfExportOption: (option) => (options.push(option), new Disposable(() => options.splice(options.indexOf(option), 1))) },
    project,
  );
  return { project, option: options[0], options, registration };
}

const start: PdfEntry = { main: '/main.typ', sources: {} };

describe('registerIncludeComments', () => {
  it('registers "Include comments", off by default, until disposed', () => {
    const { option, options, registration } = setup();
    expect(option).toMatchObject({ id: 'comments.include', label: 'Include comments', default: false });
    registration.dispose();
    expect(options).toEqual([]);
  });

  it('leaves the entry as it is with comments', () => {
    expect(setup().option.apply(start, true)).toBe(start);
  });

  it('compiles a generated entry without the notes, without touching the documents', () => {
    const { option, project } = setup();
    const entry = option.apply(start, false);
    expect(entry.main).not.toBe('/main.typ');
    expect(entry.sources['/main.typ']).toBe('#import "@preview/drafting:0.2.2": margin-note\nText\n');
    expect(entry.sources[entry.main]).toContain('#include "/main.typ"');
    expect(project.document(path('/main.typ'))!.text).toBe(NOTED);
  });

  it('works on what the options before it made', () => {
    const before: PdfEntry = { main: '/main.typ', sources: { '/main.typ': 'Other#margin-note[x]\n', '/extra.typ': 'kept' } };
    const entry = setup().option.apply(before, false);
    expect(entry.sources['/main.typ']).toBe('Other\n');
    expect(entry.sources['/extra.typ']).toBe('kept');
  });
});
