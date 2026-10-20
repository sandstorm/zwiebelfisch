// Tests for paste-as.ts: the open paste choice, its quick pick and `editor.action.pasteAs`; asking the paste edit
// providers; the order of paste edits.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../core/paths/paths';
import { SourceOffset, SourceRange } from '../../core/typst-document/typst-document';
import { LanguagesHost } from '../../hosts/languages/languages';
import type { QuickPickItem } from '../../hosts/window/window';
import { PasteAs, PasteEdits, sortPasteEdits, type PasteChoice } from './paste-as';

const document = { path: ProjectPath.of('/main.typ'), languageId: 'typst', text: 'aaaa bbbb cccc' };

/** A choice of Typst and Text that went in as Typst; `changed`: the kinds asked for. */
function choice(): PasteChoice & { changed: string[] } {
  const changed: string[] = [];
  return { kinds: [{ kind: 'typst', title: 'Typst' }, { kind: 'text.plain', title: 'Plain text' }], kind: 'typst', change: (kind) => void changed.push(kind), changed };
}

/** A window whose quick pick picks the item labelled `label` (none: cancels); `shown`: the items it was shown. */
function window(label?: string) {
  const shown: QuickPickItem[][] = [];
  return {
    shown,
    showQuickPick: (async (items: readonly QuickPickItem[]) => {
      shown.push([...items]);
      return items.find((item) => item.label === label);
    }) as never,
  };
}

describe('PasteAs', () => {
  it("asks in a quick pick which kind a choice goes in as (the current one marked) and changes it to the one picked", async () => {
    const quickPick = window('Plain text');
    const pasteAs = new PasteAs(quickPick);
    const open = choice();
    pasteAs.openPasteChoice(open);
    expect(await pasteAs.pasteAs()).toBe(true);
    expect(quickPick.shown[0].map(({ label, description }) => [label, description])).toEqual([['Typst', 'pasted as'], ['Plain text', undefined]]);
    expect(open.changed).toEqual(['text.plain']);
  });

  it('editor.action.pasteAs changes the open choice to the kind given; with none open it does nothing', async () => {
    const pasteAs = new PasteAs(window());
    const open = choice();
    pasteAs.openPasteChoice(open);
    await pasteAs.pasteAs({ kind: 'text.plain' });
    expect(open.changed).toEqual(['text.plain']);
    pasteAs.closePasteChoice(open);
    expect(await pasteAs.pasteAs({ kind: 'typst' })).toBe(false);
    expect(open.changed).toEqual(['text.plain']);
  });

  it('keeps the newer choice open when an older one closes; a cancelled pick changes nothing', async () => {
    const pasteAs = new PasteAs(window());
    const [older, newer] = [choice(), choice()];
    pasteAs.openPasteChoice(older);
    pasteAs.openPasteChoice(newer);
    pasteAs.closePasteChoice(older);
    await pasteAs.pasteAs({ kind: 'text.plain' });
    expect(newer.changed).toEqual(['text.plain']);
    await pasteAs.pasteAs();
    expect(newer.changed).toEqual(['text.plain']);
  });
});

describe('PasteEdits', () => {
  it('gives the paste edits of the providers of the language that read a type the clipboard has, of their declared kinds', () => {
    const languages = new LanguagesHost();
    const pasteEdits = new PasteEdits(languages);
    const edit = (kind: string) => ({ kind, title: kind, insertText: kind });
    const offering = (...kinds: string[]) => ({ provideDocumentPasteEdits: () => kinds.map(edit) });
    languages.registerDocumentPasteEditProvider({ language: 'typst' }, offering('typst.markdown', 'typst.markdown.gfm', 'other'), { providedPasteEditKinds: ['typst.markdown'], pasteMimeTypes: ['text/*'] });
    languages.registerDocumentPasteEditProvider({ language: 'typst' }, offering('typst.word'), { providedPasteEditKinds: ['typst.word'], pasteMimeTypes: ['text/rtf'] });
    languages.registerDocumentPasteEditProvider({ language: 'typst' }, offering('typst.any'), { providedPasteEditKinds: ['typst.any'] });
    languages.registerDocumentPasteEditProvider({ language: 'typst' }, offering('resolving'), { providedPasteEditKinds: [] });
    languages.registerDocumentPasteEditProvider({ language: 'json' }, offering('json'), { providedPasteEditKinds: ['json'] });
    const data = { types: ['text/plain', 'text/html'] } as unknown as DataTransfer;
    const kinds = pasteEdits.provideDocumentPasteEdits(document, [SourceRange.of({ from: 0, to: 0 })], data).map(({ kind }) => kind);
    expect(kinds).toEqual(['typst.markdown', 'typst.markdown.gfm', 'typst.any']);
  });

  it('asks the paste edit providers by priority (higher first, default 100; equal: registration order), offering and resolving', () => {
    const languages = new LanguagesHost();
    const pasteEdits = new PasteEdits(languages);
    const resolved: string[] = [];
    const provider = (kind: string) => ({
      provideDocumentPasteEdits: () => [{ kind, title: kind, insertText: kind }],
      resolveDocumentPasteEdit: () => void resolved.push(kind),
    });
    languages.registerDocumentPasteEditProvider({}, provider('typst'), { providedPasteEditKinds: ['typst'] }, { priority: 0 });
    languages.registerDocumentPasteEditProvider({}, provider('typst.a'), { providedPasteEditKinds: ['typst.a'] });
    languages.registerDocumentPasteEditProvider({}, provider('typst.b'), { providedPasteEditKinds: ['typst.b'] }, { priority: 200 });
    languages.registerDocumentPasteEditProvider({}, provider('typst.c'), { providedPasteEditKinds: ['typst.c'] });
    const data = { types: ['text/plain'] } as unknown as DataTransfer;
    const ranges = [SourceRange.of({ from: 0, to: 0 })];
    expect(pasteEdits.provideDocumentPasteEdits(document, ranges, data).map(({ kind }) => kind)).toEqual(['typst.b', 'typst.a', 'typst.c', 'typst']);
    pasteEdits.resolveDocumentPasteEdit({ kind: 'typst', title: 'Typst', insertText: '' }, document, ranges, data);
    expect(resolved).toEqual(['typst.b', 'typst.a', 'typst.c', 'typst']);
  });

  it('resolves the paste edit that goes in by every provider of the language in order, each given the one before; drops edits that collide', () => {
    const languages = new LanguagesHost();
    const pasteEdits = new PasteEdits(languages);
    const change = (from: number, to: number, insert: string) => ({ from: SourceOffset.of(from), to: SourceOffset.of(to), insert });
    const prepared: string[] = [];
    languages.registerDocumentPasteEditProvider(
      { language: 'typst' },
      {
        prepareDocumentPaste: (_document, copied) => void prepared.push(copied),
        resolveDocumentPasteEdit: (edit) => ({ ...edit, insertText: edit.insertText.toUpperCase(), additionalEdit: [...(edit.additionalEdit ?? []), change(0, 0, 'top '), change(6, 7, 'x'), change(10, 12, 'cc')] }),
      },
      { providedPasteEditKinds: [] },
    );
    languages.registerDocumentPasteEditProvider(
      { language: 'typst' },
      { resolveDocumentPasteEdit: (edit) => ({ ...edit, insertText: `${edit.insertText}!`, additionalEdit: [...(edit.additionalEdit ?? []), change(11, 13, 'CC'), change(14, 14, 'end')] }) },
      { providedPasteEditKinds: [] },
    );
    languages.registerDocumentPasteEditProvider({ language: 'json' }, { resolveDocumentPasteEdit: (edit) => ({ ...edit, insertText: 'json' }) }, { providedPasteEditKinds: [] });
    const data = {} as DataTransfer;
    pasteEdits.prepareDocumentPaste(document, 'bb', data);
    expect(prepared).toEqual(['bb']);
    // pasted over `bbbb` (5..9): an edit inside it (6..7) and one overlapping an earlier one (11..13) are dropped
    const ranges = [SourceRange.of({ from: 5, to: 9 })];
    const edit = { kind: 'typst', title: 'Typst', insertText: 'pasted' };
    expect(pasteEdits.resolveDocumentPasteEdit(edit, document, ranges, data)).toEqual({ ...edit, insertText: 'PASTED!', additionalEdit: [change(0, 0, 'top '), change(10, 12, 'cc'), change(14, 14, 'end')] });
  });
});

describe('sortPasteEdits', () => {
  const edit = (kind: string, insertText = kind, yieldTo?: string[]) => ({ kind, title: kind, insertText, yieldTo });

  it('puts each edit after the kinds it yields to (a kind covers those below it), else keeps the order', () => {
    const edits = [edit('text.plain', 'p', ['typst']), edit('typst', 't', ['typst.html']), edit('typst.html', 'h'), edit('typst.markdown', 'm', ['typst.code'])];
    expect(sortPasteEdits(edits).map(({ kind }) => kind)).toEqual(['typst.html', 'typst', 'typst.markdown', 'text.plain']);
  });

  it('puts the preferred kinds (exactly those) first, and leaves out an edit putting in the same text as one before', () => {
    const edits = [edit('typst.code', 'c'), edit('typst', 't', ['typst.code']), edit('typst.html', 'h')];
    expect(sortPasteEdits(edits, ['typst']).map(({ kind }) => kind)).toEqual(['typst', 'typst.code', 'typst.html']);
    expect(sortPasteEdits([...edits, edit('typst.markdown', 'c')]).map(({ kind }) => kind)).toEqual(['typst.code', 'typst', 'typst.html']);
  });

  it('offers the plain text by its name: it takes the place of the first edit putting in the same text', () => {
    const edits = [edit('typst.code', 'c'), edit('typst', 't', ['typst.code']), edit('text.plain', 't', ['typst']), edit('typst.html', 'h')];
    expect(sortPasteEdits(edits, ['text.plain']).map(({ kind }) => kind)).toEqual(['text.plain', 'typst.code', 'typst.html']);
    expect(sortPasteEdits(edits, ['typst']).map(({ kind }) => kind)).toEqual(['text.plain', 'typst.code', 'typst.html']);
  });
});
