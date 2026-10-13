// Tests for preview.ts: the PDF export option `comments.include` and the view option `comments.show` (compiled with the
// real drafting package, ../model/fixtures/drafting-0.2.2).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceOffset } from '../../../core/typst-document/typst-document';
import { type FontInfo, type PdfEntry, createEngine } from '../../../core/typst-engine/typst-engine';
import { type PackageEngine, withPackages } from '../../../core/typst-packages/typst-packages';
import type { PdfExportOption, PreviewEntry, PreviewViewOption } from '../../../hosts/preview/preview';
import { registerIncludeComments, registerShowComments } from './preview';

const path = ProjectPath.of;

const NOTED = '#import "@preview/drafting:0.2.2": margin-note\nText#margin-note[a note]\n';

function setup(files: Record<string, string | Uint8Array> = { '/main.typ': NOTED, '/logo.png': new Uint8Array([1]) }) {
  const project = new Project(path('/main.typ'), files);
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

  it('with comments, compiles a generated entry that styles the notes with the project\'s drafting, then includes main', () => {
    const { option, project } = setup({ '/main.typ': '#include "ch.typ"\n', '/ch.typ': NOTED.replace('0.2.2', '0.2.1') });
    const entry = option.apply(start, true);
    expect(entry.main).not.toBe('/main.typ');
    const lines = entry.sources[entry.main].split('\n');
    expect(lines[0]).toBe('#import "@preview/drafting:0.2.1": set-margin-note-defaults');
    expect(lines[1]).toBe('#set-margin-note-defaults(');
    expect(entry.sources[entry.main]).toContain('stroke: rgb("#e0a800")');
    expect(entry.sources[entry.main].endsWith('#include "/main.typ"\n')).toBe(true);
    expect(Object.keys(entry.sources)).toEqual([entry.main]);
    expect(project.document(path('/ch.typ'))!.text).toBe(NOTED.replace('0.2.2', '0.2.1'));
  });

  it('with comments, leaves the entry as it is when the project does not use drafting', () => {
    expect(setup({ '/main.typ': 'Plain\n' }).option.apply(start, true)).toBe(start);
  });

  it('without comments, compiles a generated entry without the notes, without touching the documents', () => {
    const { option, project } = setup();
    const entry = option.apply(start, false);
    expect(entry.main).not.toBe('/main.typ');
    expect(entry.sources['/main.typ']).toBe('#import "@preview/drafting:0.2.2": margin-note\nText\n');
    expect(entry.sources[entry.main]).toContain('#set-margin-note-defaults(hidden: true)');
    expect(entry.sources[entry.main]).not.toContain('stroke');
    expect(entry.sources[entry.main]).toContain('#include "/main.typ"');
    expect(project.document(path('/main.typ'))!.text).toBe(NOTED);
  });

  it('works on what the options before it made', () => {
    const before: PdfEntry = { main: '/main.typ', sources: { '/main.typ': 'Other#margin-note[x]\n', '/extra.typ': 'kept' } };
    const without = setup().option.apply(before, false);
    expect(without.sources['/main.typ']).toBe('Other\n');
    expect(without.sources['/extra.typ']).toBe('kept');
    const styled = setup({ '/main.typ': 'Plain\n' }).option.apply({ main: '/main.typ', sources: { '/main.typ': NOTED } }, true);
    expect(styled.sources['/main.typ']).toBe(NOTED);
    expect(styled.sources[styled.main]).toContain('#include "/main.typ"');
  });
});

describe('registerShowComments', () => {
  const registered = (files: Record<string, string> = { '/main.typ': NOTED }) => {
    const project = new Project(path('/main.typ'), files);
    const options: PreviewViewOption[] = [];
    registerShowComments({ registerViewOption: (option) => (options.push(option), new Disposable(() => {})) }, project);
    return { option: options[0], project };
  };
  const before: PreviewEntry = { output: 'pages', prelude: ['#let before = 1'] };

  it('registers "Comments", on by default', () => {
    expect(registered().option).toMatchObject({ id: 'comments.show', label: 'Comments', default: true });
  });

  it('while on, styles the notes with the drafting version the project imports', () => {
    const { prelude } = registered({ '/main.typ': '#include "a.typ"', '/a.typ': NOTED.replace('0.2.2', '0.2.1') }).option.apply(before, true);
    expect(prelude.slice(0, 2)).toEqual(['#let before = 1', '#import "@preview/drafting:0.2.1": set-margin-note-defaults']);
    expect(prelude[2]).toMatch(/^#set-margin-note-defaults\(\n[^]*stroke: rgb\("#e0a800"\)[^]*\)$/);
  });

  it('while on, changes nothing in a project without drafting (no package to download, main compiled directly)', () => {
    expect(registered({ '/main.typ': 'Plain\n' }).option.apply(before, true)).toBe(before);
  });

  it('follows the project: the first note\'s import brings the style', () => {
    const { option, project } = registered({ '/main.typ': 'Plain\n' });
    expect(option.apply({ output: 'pages', prelude: [] }, true).prelude).toEqual([]);
    project.document(path('/main.typ'))!.change([{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: NOTED }], 'test');
    expect(option.apply({ output: 'pages', prelude: [] }, true).prelude[0]).toContain('set-margin-note-defaults');
  });

  it('applies to the HTML preview too, which leaves the notes out (also while on) and gives drafting the sizes of no page', () => {
    const { option } = registered({ '/main.typ': NOTED.replace('0.2.2', '0.2.1') });
    expect(option.outputs).toEqual(['pages', 'html']);
    const html: PreviewEntry = { ...before, output: 'html' };
    for (const show of [true, false]) {
      const { prelude } = option.apply(html, show);
      expect(prelude.slice(0, 2)).toEqual(['#let before = 1', '#import "@preview/drafting:0.2.1": set-margin-note-defaults']);
      expect(prelude[2]).toMatch(/^#set-margin-note-defaults\(page-width: 0pt, .*\)$/);
      expect(prelude.join('\n')).toContain('#show box:');
      expect(prelude.join('\n')).not.toContain('stroke');
    }
    expect(registered({ '/main.typ': 'Plain\n' }).option.apply(html, true)).toBe(html);
  });

  it('while off, hides the notes by show rules, importing nothing', () => {
    const { prelude } = registered().option.apply(before, false);
    expect(prelude[0]).toBe('#let before = 1');
    expect(prelude.join('\n')).not.toContain('#import');
    expect(prelude.join('\n')).not.toContain('stroke');
  });

  describe('compiled', () => {
    const page = '#set page(width: 16cm, height: 8cm, margin: (right: 4cm, rest: 1cm))\n';
    const noted = `#import "@preview/drafting:0.2.2": margin-note
${page}#let todo = margin-note.with(stroke: red)
Alpha #margin-note[Beta][Gamma note] Delta#margin-note[Point note] #todo[Helper note] #underline[Under] #margin-note(side: left)[Left][note]
`;

    /** The SVG of each page; with `prelude`, compiled as the preview does (the main file included). */
    const compiled = async (engine: Engine, main: string, prelude?: readonly string[]) => {
      engine.bare.setSource('/main.typ', main);
      engine.bare.setSource('/view.typ', `${(prelude ?? []).join('\n')}\n#include "/main.typ"\n`);
      const { pages, diagnostics } = await engine.packages.compile(prelude ? '/view.typ' : '/main.typ');
      expect(diagnostics).toEqual([]);
      return pages.map((p) => p.svg);
    };
    /** What is drawn: glyphs and shapes per page. */
    const drawn = (svgs: string[]) => svgs.map((svg) => [svg.split('<use').length - 1, svg.split('<path').length - 1]);
    const prelude = (main: string, show: boolean) => registered({ '/main.typ': main }).option.apply({ output: 'pages', prelude: [] }, show).prelude;

    it('draws a document with notes as the same document without them, keeping the noted text and its own underline', async () => {
      const engine = await engineWithDrafting();
      const plain = `${page}Alpha Beta Delta  #underline[Under] Left\n`;
      const hidden = drawn(await compiled(engine, noted, prelude(noted, false)));
      expect(hidden).toEqual(drawn(await compiled(engine, plain)));
      expect(drawn(await compiled(engine, noted))[0][0]).toBeGreaterThan(hidden[0][0]);
    }, 60_000);

    it('keeps boxes without a body (cheq\'s checkboxes) while hiding the notes', async () => {
      const engine = await engineWithDrafting();
      const boxes = `${noted}#box(width: 1em, height: 1em, stroke: black) #box()\n`;
      expect(drawn(await compiled(engine, boxes, prelude(boxes, false)))[0][1]).toBeGreaterThan(0);
    }, 60_000);

    it('draws the notes in the editor\'s look on the same pages, and a document\'s own defaults win', async () => {
      const engine = await engineWithDrafting();
      const styled = await compiled(engine, noted, prelude(noted, true));
      expect(styled).toHaveLength((await compiled(engine, noted)).length);
      expect(styled[0]).toContain('#e0a800');
      expect((await compiled(engine, noted))[0]).not.toContain('#e0a800');
      const own = noted.replace('margin-note\n', 'margin-note, set-margin-note-defaults\n#set-margin-note-defaults(stroke: blue)\n');
      const overridden = await compiled(engine, own, prelude(own, true));
      expect(overridden[0]).not.toContain('#e0a800');
      expect(overridden[0]).toContain('#0074d9');
    }, 60_000);

    it('compiles a document with notes to HTML without them, keeping the noted text, where drafting alone panics', async () => {
      const engine = await engineWithDrafting();
      const html = async (main: string, prelude: readonly string[]) => {
        engine.bare.setSource('/main.typ', main);
        engine.bare.setSource('/view.typ', `${prelude.join('\n')}\n#include "/main.typ"\n`);
        const { files, diagnostics } = await engine.packages.compileHtml('/view.typ');
        return { text: files.map((f) => new TextDecoder().decode(f.data)).join(), errors: diagnostics.filter((d) => d.severity === 'error').map((d) => d.message) };
      };
      expect((await html(noted, [])).errors).toEqual([expect.stringContaining('margin-note can only be called after')]);
      // the margins of a book (inside, outside) too
      for (const main of [noted, noted.replace('right: 4cm, rest: 1cm', 'inside: 2cm, outside: 4cm')]) {
        const prelude = registered({ '/main.typ': main }).option.apply({ output: 'html', prelude: [] }, true).prelude;
        const { text, errors } = await html(main, prelude);
        expect(errors).toEqual([]);
        expect(text).toMatch(/Alpha\s+Beta\s+Delta/);
        expect(text).not.toMatch(/note/);
      }
    }, 60_000);

    it('exports the PDF with comments in the same look', async () => {
      const engine = await engineWithDrafting();
      const { option } = setup({ '/main.typ': noted });
      const entry = option.apply(start, true);
      for (const [file, text] of Object.entries({ '/main.typ': noted, ...entry.sources })) engine.bare.setSource(file, text);
      const { pages, diagnostics } = await engine.packages.compile(entry.main);
      expect(diagnostics).toEqual([]);
      expect(pages[0].svg).toContain('#e0a800');
      expect((await engine.packages.exportPdf(entry.main)).pdf).not.toBeNull();
    }, 60_000);
  });
});

type Engine = { bare: Awaited<ReturnType<typeof createEngine>>; packages: PackageEngine };

/** An engine with the default fonts that finds drafting 0.2.2 (the test fixture) as a package. */
async function engineWithDrafting(): Promise<Engine> {
  const engineDir = new URL('../../../core/typst-engine/', import.meta.url);
  const fontDir = new URL('fonts/', engineDir);
  const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('index.json', fontDir), 'utf8'));
  const bare = await createEngine(readFileSync(new URL('wasm/typst_engine_bg.wasm', engineDir)));
  for (const [name, faces] of Object.entries(fontIndex)) bare.addLazyFont({ name, faces, load: () => new Uint8Array(readFileSync(new URL(name, fontDir))) });
  const drafting = new Uint8Array(readFileSync(new URL('../model/fixtures/drafting-0.2.2.tar.gz', import.meta.url)));
  return { bare, packages: withPackages(bare, async () => drafting) };
}
