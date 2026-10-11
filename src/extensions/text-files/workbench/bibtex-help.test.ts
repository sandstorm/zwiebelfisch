// Tests for bibtex-help.ts: its entries are a bibliography Typst reads, cited as its other rows show.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../core/typst-engine/typst-engine';
import { BIBTEX_HELP } from './bibtex-help';

const engineFiles = new URL('../../../core/typst-engine/', import.meta.url);
const [entries, inTheDocument] = BIBTEX_HELP.sections;

describe('the BibTeX help sheet', () => {
  it('its entries make a bibliography the document cites as shown', async () => {
    const engine = await createEngine(readFileSync(new URL('wasm/typst_engine_bg.wasm', engineFiles)));
    engine.addFont(readFileSync(new URL('fonts/LibertinusSerif-Regular.otf', engineFiles)));
    const entry = entries.rows.filter((row) => row.snippet.startsWith('@')).map((row) => row.snippet);
    engine.setSource('/refs.bib', entry.join('\n\n'));
    const [bibliography, ...citations] = inTheDocument.rows.map((row) => row.snippet);
    engine.setSource('/main.typ', `${citations.join('\n\n')}\n\n@lamport1994 @typst\n\n${bibliography}\n`);
    expect(engine.compile('/main.typ').diagnostics).toEqual([]);
  });
});
