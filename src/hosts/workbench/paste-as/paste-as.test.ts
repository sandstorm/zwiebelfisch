// Tests for paste-as.ts: the open paste choice, its quick pick and `editor.action.pasteAs`.
import { describe, expect, it } from 'vitest';
import type { PasteChoice } from '../../languages/languages';
import type { QuickPickItem } from '../../window/window';
import { PasteAs } from './paste-as';

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
