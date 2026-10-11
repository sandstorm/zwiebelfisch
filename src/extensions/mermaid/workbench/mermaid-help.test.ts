// Tests for mermaid-help.ts: each section's rows, one after the other, are a diagram merman draws (with merman as the
// e2e tests cache it; skipped without it).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type FontInfo, createEngine } from '../../../core/typst-engine/typst-engine';
import { withPackages } from '../../../core/typst-packages/typst-packages';
import { MERMAN } from '../model/mermaid-figure';
import { MERMAID_HELP } from './mermaid-help';

const engineFiles = new URL('../../../core/typst-engine/', import.meta.url);
const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('fonts/index.json', engineFiles), 'utf8'));
const merman = new URL(`../../../../.cache/typst-packages/${MERMAN.slice('@preview/'.length).replace(':', '-')}.tar.gz`, import.meta.url);

/** The errors of drawing Mermaid `diagram` with merman. */
async function errors(diagram: string): Promise<string[]> {
  const engine = await createEngine(readFileSync(new URL('wasm/typst_engine_bg.wasm', engineFiles)));
  for (const [name, faces] of Object.entries(fontIndex)) engine.addLazyFont({ name, faces, load: () => new Uint8Array(readFileSync(new URL(`fonts/${name}`, engineFiles))) });
  engine.setSource('/main.typ', `#import "${MERMAN}": mermaid\n#mermaid(${JSON.stringify(diagram)})\n`);
  const packages = withPackages(engine, async () => new Uint8Array(readFileSync(merman)));
  return (await packages.compile('/main.typ')).diagnostics.map((diagnostic) => diagnostic.message);
}

describe.skipIf(!existsSync(merman))('the Mermaid help sheet', () => {
  it.each(MERMAID_HELP.sections.map((section) => [section.title, section.rows.map((row) => row.snippet).join('\n')]))('%s: the rows are one diagram', async (_, diagram) => {
    expect(await errors(diagram)).toEqual([]);
  });

  it('(a broken diagram is an error)', async () => {
    expect(await errors('sequenceDiagram\nA->>>>B: Hello')).not.toEqual([]);
  });
});
