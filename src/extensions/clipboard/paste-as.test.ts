// Tests for paste-as.ts: the open paste choice, its quick pick and `editor.action.pasteAs`; the order of paste edits.
import { describe, expect, it } from 'vitest';
import type { QuickPickItem } from '../../hosts/window/window';
import { PasteAs, sortPasteEdits, type PasteChoice } from './paste-as';

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
