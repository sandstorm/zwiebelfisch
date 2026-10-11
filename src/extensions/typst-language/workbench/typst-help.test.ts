// Tests for typst-help.ts: every row compiles with the Typst engine (the package row with merman, as the e2e tests
// cache it; skipped without it).
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FontInfo, type TypstEngine, createEngine } from '../../../core/typst-engine/typst-engine';
import { withPackages } from '../../../core/typst-packages/typst-packages';
import { TYPST_HELP } from './typst-help';

const engineFiles = new URL('../../../core/typst-engine/', import.meta.url);
const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('fonts/index.json', engineFiles), 'utf8'));
const merman = new URL('../../../../.cache/typst-packages/merman-0.4.0.tar.gz', import.meta.url);
/** A PNG of one pixel. */
const PIXEL = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0));

let engine: TypstEngine;
beforeAll(async () => {
  engine = await createEngine(readFileSync(new URL('wasm/typst_engine_bg.wasm', engineFiles)));
  for (const [name, faces] of Object.entries(fontIndex)) engine.addLazyFont({ name, faces, load: () => new Uint8Array(readFileSync(new URL(`fonts/${name}`, engineFiles))) });
  // the files the rows name
  engine.setBinary('/image.png', PIXEL);
  engine.setSource('/template.typ', '#let conf = 1');
  engine.setSource('/chapter.typ', 'A chapter');
});

const rows = TYPST_HELP.sections.flatMap((section) => section.rows.map((row) => row.snippet));
const isPackage = (snippet: string) => snippet.includes('@preview/');

describe('the Typst help sheet', () => {
  it.each(rows.filter((snippet) => !isPackage(snippet)).map((snippet) => [snippet]))('%s compiles', (snippet) => {
    // a reference needs its label, and the heading numbering to name it
    const context = snippet.startsWith('@') ? '#set heading(numbering: "1.")\n= Introduction <intro>\n\n' : '';
    engine.setSource('/main.typ', `${context}${snippet}\n`);
    expect(engine.compile('/main.typ').diagnostics).toEqual([]);
  });

  it.skipIf(!existsSync(merman)).each(rows.filter(isPackage).map((snippet) => [snippet]))('%s compiles', async (snippet) => {
    engine.setSource('/main.typ', `${snippet}\n`);
    const packages = withPackages(engine, async () => new Uint8Array(readFileSync(merman)));
    expect((await packages.compile('/main.typ')).diagnostics).toEqual([]);
  });
});
