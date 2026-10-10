// Tests for the model against the real drafting package (./fixtures/drafting-0.2.2): the notes, threads, page margins
// and the sources without notes it writes compile, and draw what they should.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEngine, withPackages } from '../../../core/typst-engine/typst-engine';
import type { TextChange } from '../../../core/typst-document/typst-document';
import { addMarginNote, addReply, withoutNotes } from './model';

const engineDir = new URL('../../../core/typst-engine/', import.meta.url);
const wasm = readFileSync(new URL('wasm/typst_engine_bg.wasm', engineDir));
const fontDir = new URL('fonts/', engineDir);
const fonts = readdirSync(fontDir).map((name) => new Uint8Array(readFileSync(new URL(name, fontDir))));

describe('the drafting package (margin notes)', () => {
  const drafting = new Uint8Array(readFileSync(new URL('./fixtures/drafting-0.2.2.tar.gz', import.meta.url)));

  it('compiles point and range margin notes', async () => {
    const bare = await createEngine(wasm, fonts);
    const project = withPackages(bare, async () => drafting);
    bare.setSource(
      '/main.typ',
      [
        '#import "@preview/drafting:0.2.2": margin-note',
        '#set page(margin: (x: 4cm))',
        'Some text#margin-note[Is this still right?]',
        'and #margin-note[a range][with a note] plus #margin-note(side: left)[left][note]',
      ].join('\n'),
    );
    const { pages, diagnostics } = await project.compile('/main.typ');
    expect(diagnostics).toEqual([]);
    expect(pages).toHaveLength(1);
  });

  it('compiles comment threads (one list item per message) in both layouts', async () => {
    const bare = await createEngine(wasm, fonts);
    const project = withPackages(bare, async () => drafting);
    const anna = { author: 'Anna', date: '2026-10-10', text: 'Is this *right*? #1 ]' };
    const bob = { author: 'Bob', date: '2026-10-11', text: 'Yes.\nChecked.\n\n- with finance' };
    const inline = addReply(addReply('', anna), bob);
    const block = addReply(addReply('old\nnote', anna), { ...bob, text: 'one\ntwo' });
    expect(block.startsWith('\n  - old\n')).toBe(true);
    bare.setSource(
      '/main.typ',
      [
        '#import "@preview/drafting:0.2.2": margin-note',
        '#set page(margin: (x: 4cm))',
        `Some #margin-note[text][${inline}] and #margin-note[${block}] and #margin-note[${addReply('', bob)}]`,
      ].join('\n'),
    );
    const { diagnostics } = await project.compile('/main.typ');
    expect(diagnostics).toEqual([]);
  });

  it('compiles a note in a document without page setup', async () => {
    const bare = await createEngine(wasm, fonts);
    const project = withPackages(bare, async () => drafting);
    bare.setSource('/main.typ', '#import "@preview/drafting:0.2.2": margin-note\nText#margin-note[note]');
    expect((await project.compile('/main.typ')).diagnostics).toEqual([]);
  });

  describe('the PDF without comments (withoutNotes)', () => {
    const page = '#set page(width: 16cm, height: 8cm, margin: (right: 4cm, rest: 1cm))\n';
    /** Glyphs drawn (SVG `<use>`s) when compiling `main` with `sources`. */
    const glyphs = async (sources: Record<string, string>, main = '/main.typ') => {
      const bare = await createEngine(wasm, fonts);
      const project = withPackages(bare, async () => drafting);
      for (const [path, text] of Object.entries(sources)) bare.setSource(path, text);
      const { pages, diagnostics } = await project.compile(main);
      expect(diagnostics).toEqual([]);
      expect((await project.exportPdf(main)).pdf).not.toBeNull();
      return pages.map((p) => p.svg.split('<use').length - 1).reduce((a, b) => a + b);
    };

    it('hides every note and keeps the text of range notes, also after the document styles its notes', async () => {
      const files = {
        '/main.typ': `#import "@preview/drafting:0.2.2": margin-note, set-margin-note-defaults
${page}#set-margin-note-defaults(stroke: blue)
#let todo = margin-note.with(stroke: red)
Alpha #margin-note[Beta][Gamma note] Delta#margin-note[Point note] #todo[Helper note]
`,
      };
      const plain = { '/main.typ': `${page}Alpha Beta Delta\n` };
      const entry = withoutNotes(files, '/main.typ');
      const all = await glyphs(files);
      const none = await glyphs({ ...files, ...entry.sources }, entry.main);
      expect(none).toBe(await glyphs(plain));
      expect(all).toBeGreaterThan(none + 'GammanotePointnoteHelpernote'.length - 1);
    });
  });

  describe('page margins (drafting 0.2.2 needs a margin that differs by side)', () => {
    const demo = readFileSync(new URL('../../../../demo/examples/hello/main.typ', import.meta.url), 'utf8');
    const compile = async (text: string) => {
      const bare = await createEngine(wasm, fonts);
      const project = withPackages(bare, async () => drafting);
      bare.setSource('/main.typ', text);
      return (await project.compile('/main.typ')).diagnostics.map((d) => d.message);
    };
    const apply = (text: string, changes: readonly TextChange[]) =>
      [...changes].sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text);

    it('fails on the demo\'s single-length margin without the rewrite (the upstream bug)', async () => {
      const text = `#import "@preview/drafting:0.2.2": margin-note\n${demo}Note#margin-note[x]\n`;
      expect(demo).toMatch(/margin: 1\.5cm/);
      expect(await compile(text)).toEqual([expect.stringContaining('has no method `keys`')]);
    });

    it('compiles point and range notes in the demo after adding them', async () => {
      let text = demo;
      for (const where of [(t: string) => t.indexOf('Hello Typst') + 5, (t: string) => t.length - 1]) {
        const at = where(text);
        text = apply(text, addMarginNote(text, { from: at, to: at })!.changes);
      }
      expect(text.split('set-margin-note-defaults(')).toHaveLength(2);
      const word = text.indexOf('Typst', text.indexOf('= Hello'));
      text = apply(text, addMarginNote(text, { from: word, to: word + 5 })!.changes);
      expect(text).toMatch(/margin: \(right: 4cm, rest: 1\.5cm\)/);
      expect(await compile(text)).toEqual([]);
    });

    it.each(['5cm', '1in', '1cm + 5%', '(x: 2cm, y: 2cm)'])('compiles a note after rewriting margin: %s', async (margin) => {
      const text = `#set page(width: 16cm, height: auto, margin: ${margin})\nText\n`;
      expect(await compile(apply(text, addMarginNote(text, { from: text.length - 1, to: text.length - 1 })!.changes))).toEqual([]);
    });
  });
});
