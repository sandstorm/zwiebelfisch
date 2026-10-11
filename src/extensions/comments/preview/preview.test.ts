// Tests for preview.ts: the PDF export option `comments.include` and the view option `comments.show` (compiled with the
// real drafting package, ../model/fixtures/drafting-0.2.2).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { type FontInfo, type PdfEntry, createEngine } from '../../../core/typst-engine/typst-engine';
import { withPackages } from '../../../core/typst-packages/typst-packages';
import type { PdfExportOption, PreviewEntry, PreviewViewOption } from '../../../hosts/preview/preview';
import { NOTE_STYLE } from '../model/add-margin-note';
import { registerIncludeComments, registerShowComments } from './preview';

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

describe('registerShowComments', () => {
  const registered = () => {
    const options: PreviewViewOption[] = [];
    registerShowComments({ registerViewOption: (option) => (options.push(option), new Disposable(() => {})) });
    return options[0];
  };
  const start: PreviewEntry = { prelude: ['#let before = 1'] };

  it('registers "Comments", on by default, changing nothing while on', () => {
    const option = registered();
    expect(option).toMatchObject({ id: 'comments.show', label: 'Comments', default: true });
    expect(option.apply(start, true)).toBe(start);
    expect(option.apply(start, false).prelude[0]).toBe('#let before = 1');
    // show rules only: no package to download for a document without notes
    expect(option.apply(start, false).prelude.join('\n')).not.toContain('#import');
  });

  it('draws a document with notes as the same document without them, keeping the noted text and its own underline', async () => {
    const engineDir = new URL('../../../core/typst-engine/', import.meta.url);
    const fontDir = new URL('fonts/', engineDir);
    const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('index.json', fontDir), 'utf8'));
    const engine = await createEngine(readFileSync(new URL('wasm/typst_engine_bg.wasm', engineDir)));
    for (const [name, faces] of Object.entries(fontIndex)) engine.addLazyFont({ name, faces, load: () => new Uint8Array(readFileSync(new URL(name, fontDir))) });
    const drafting = new Uint8Array(readFileSync(new URL('../model/fixtures/drafting-0.2.2.tar.gz', import.meta.url)));
    const project = withPackages(engine, async () => drafting);
    /** What is drawn: glyphs and shapes per page; with `prelude`, compiled as the preview does (the main file included). */
    const drawn = async (main: string, prelude?: readonly string[]) => {
      engine.setSource('/main.typ', main);
      engine.setSource('/view.typ', `${(prelude ?? []).join('\n')}\n#include "/main.typ"\n`);
      const { pages, diagnostics } = await project.compile(prelude ? '/view.typ' : '/main.typ');
      expect(diagnostics).toEqual([]);
      return pages.map((page) => [page.svg.split('<use').length - 1, page.svg.split('<path').length - 1]);
    };
    const page = '#set page(width: 16cm, height: 8cm, margin: (right: 4cm, rest: 1cm))\n';
    const noted = `#import "@preview/drafting:0.2.2": margin-note, set-margin-note-defaults
${page}${NOTE_STYLE}#let todo = margin-note.with(stroke: red)
Alpha #margin-note[Beta][Gamma note] Delta#margin-note[Point note] #todo[Helper note] #underline[Under] #margin-note(side: left)[Left][note]
`;
    const plain = `${page}Alpha Beta Delta  #underline[Under] Left\n`;
    const hidden = await drawn(noted, registered().apply({ prelude: [] }, false).prelude);
    expect(hidden).toEqual(await drawn(plain));
    expect((await drawn(noted))[0][0]).toBeGreaterThan(hidden[0][0]);
  }, 60_000);
});
