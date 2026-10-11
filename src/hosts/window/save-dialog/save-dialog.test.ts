// Tests for save-dialog.ts: the name asked, its ending, existing files refused.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import type { InputBoxOptions } from '../window';
import { showSaveDialog } from './save-dialog';

const path = ProjectPath.of;
const existing = new Set<string>(['/main.typ', '/img/flow.drawio.png', '/chapter.typ']);
const exists = (target: ProjectPath) => existing.has(target);

/** The dialog with `answer` typed; what the input box was asked, and what it resolved to. */
async function save(answer: string | undefined, options: Parameters<typeof showSaveDialog>[2]) {
  let asked: InputBoxOptions | null = null;
  const result = await showSaveDialog(async (given) => ((asked = given), answer), exists, options);
  return { asked: asked as unknown as InputBoxOptions, result };
}

describe('showSaveDialog', () => {
  it('asks for a name in the folder of defaultUri (a file: its folder), the caret after it', async () => {
    const { asked } = await save(undefined, { title: 'New diagram', defaultUri: path('/img/flow.drawio.png') });
    expect(asked).toMatchObject({ title: 'New diagram', prompt: 'File name', value: 'img/', valueSelection: [4, 4] });
    expect((await save(undefined, { defaultUri: path('/drafts') })).asked.value).toBe('drafts/');
    expect((await save(undefined, {})).asked).toMatchObject({ title: 'Save', value: '' });
  });

  it('adds the first ending to a name without one, completes a compound ending, and resolves to the path', async () => {
    const diagrams = { filters: { Diagrams: ['drawio.png'] } };
    expect((await save('img/arch', diagrams)).result).toBe('/img/arch.drawio.png');
    expect((await save('img/arch.drawio', diagrams)).result).toBe('/img/arch.drawio.png');
    expect((await save(undefined, diagrams)).result).toBeUndefined();
  });

  it('checks the name as it is typed: empty, unusable, wrong ending, taken', async () => {
    const { asked } = await save(undefined, { filters: { Typst: ['typ'] } });
    const validate = asked.validateInput!;
    expect(validate('')).toBe('Please enter a name.');
    expect(validate('a/../b')).toMatch(/cannot contain/);
    expect(validate('table.csv')).toBe('The name ends in .typ.');
    expect(validate('chapter')).toBe('chapter.typ already exists.');
    expect(validate('appendix')).toBeNull();
  });

  it("takes any ending with '*' among the filters, and refuses a name that is taken once more on Enter", async () => {
    const any = { filters: { Typst: ['typ'], 'All files': ['*'] } };
    expect((await save('refs.bib', any)).result).toBe('/refs.bib');
    expect((await save('notes', any)).result).toBe('/notes.typ');
    expect((await save('chapter', any)).result).toBeUndefined();
  });
});
