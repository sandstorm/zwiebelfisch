// Tests for note-thread.ts.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { connect } from '../collaboration/in-process';
import { parseNoteCall, printNoteCall } from './margin-note-syntax';
import { addReply, deleteMessage, editMessage, localDate, readThread } from './note-thread';

const anna = (text: string) => ({ author: 'Anna', date: '2026-10-10', text });
const bob = (text: string) => ({ author: 'Bob', date: '2026-10-11', text });

const BLOCK = '\n  - *Anna* (2026-10-10): Is this number still right?\n  - *Bob* (2026-10-11): Yes, checked with finance.\n';

describe('readThread', () => {
  it('reads one list item per message, oldest first', () => {
    expect(readThread(BLOCK)).toEqual([
      { author: 'Anna', date: '2026-10-10', text: 'Is this number still right?' },
      { author: 'Bob', date: '2026-10-11', text: 'Yes, checked with finance.' },
    ]);
    expect(readThread('- *Anna* (2026-10-10): Is this right?')).toEqual([anna('Is this right?')]);
  });

  it('reads hand-written layouts: other indentation, tabs, siblings after an inline first item', () => {
    expect(readThread('- *A* (2026-01-01): one\n- *B* (2026-01-02): two').map((m) => m.author)).toEqual(['A', 'B']);
    expect(readThread('\n\t- *A* (2026-01-01): one\n\t- *B* (2026-01-02): two\n').map((m) => m.text)).toEqual(['one', 'two']);
    expect(readThread(' - *A* (2026-01-01):\n')).toEqual([{ author: 'A', date: '2026-01-01', text: '' }]);
  });

  it('reads line breaks, paragraph breaks and escapes back as plain text', () => {
    const note = '\n  - *Anna* (2026-10-10): one\\\n    two\n\n    three \\#1 \\*x\\* a\\\\\n';
    expect(readThread(note)).toEqual([anna('one\ntwo\n\nthree #1 *x* a\\')]);
  });

  it('keeps a hand-written first item without name and date as markup', () => {
    expect(readThread('\n  - see *this*\n    too\n  - *Bob* (2026-10-11): ok\n')).toEqual([
      { author: null, date: null, text: 'see *this*\ntoo' },
      bob('ok'),
    ]);
  });

  it('reads any other note as one anonymous message, as written', () => {
    expect(readThread('')).toEqual([]);
    expect(readThread('  ')).toEqual([]);
    for (const note of ['a *note*', '- a\n- b', '- a', '- *A* (2026-01-01): x\n- b', 'text\n- *A* (2026-01-01): x', '- *A* (2026-01-01): x\nnot indented']) {
      expect(readThread(note), note).toEqual([{ author: null, date: null, text: note }]);
    }
  });
});

describe('addReply', () => {
  it('writes the first message of an empty note inline, or in the block form when it has several lines', () => {
    expect(addReply('', anna('Is this right?'))).toBe('- *Anna* (2026-10-10): Is this right?');
    expect(addReply('', anna('one\ntwo'))).toBe('\n  - *Anna* (2026-10-10): one\\\n    two\n');
  });

  it('appends an item after the last one, changing nothing else', () => {
    const note = `${BLOCK.trimEnd()}\n`;
    const replied = addReply(note, anna('Thanks.'));
    expect(replied).toBe(`${BLOCK.trimEnd()}\n  - *Anna* (2026-10-10): Thanks.\n`);
    expect(addReply('- *A* (2026-01-01): one\n- *B* (2026-01-02): two', bob('three'))).toBe(
      '- *A* (2026-01-01): one\n- *B* (2026-01-02): two\n- *Bob* (2026-10-11): three',
    );
    expect(addReply('\n\t- *A* (2026-01-01): one\n', bob('x'))).toBe('\n\t- *A* (2026-01-01): one\n\t- *Bob* (2026-10-11): x\n');
  });

  it('starts the line with a reply after an inline first message (only an insertion)', () => {
    expect(addReply('- *Anna* (2026-10-10): Is this right?', bob('Yes.'))).toBe(
      '- *Anna* (2026-10-10): Is this right?\n- *Bob* (2026-10-11): Yes.',
    );
  });

  it('turns a note that is no thread into the first item, without name and date', () => {
    expect(addReply('Check *this*', bob('Done.'))).toBe('- Check *this*\n- *Bob* (2026-10-11): Done.');
    expect(addReply(' one\n two ', bob('x'))).toBe('\n  - one\n    two\n  - *Bob* (2026-10-11): x\n');
    expect(readThread(addReply('Check *this*', bob('Done.')))).toEqual([{ author: null, date: null, text: 'Check *this*' }, bob('Done.')]);
  });

  it('keeps several lines on one item: line breaks, paragraph breaks', () => {
    const replied = addReply('- *Anna* (2026-10-10): a', bob('one\ntwo\n\nthree'));
    expect(replied).toBe('- *Anna* (2026-10-10): a\n- *Bob* (2026-10-11): one\\\n  two\n\n  three');
    expect(readThread(replied)[1]).toEqual(bob('one\ntwo\n\nthree'));
  });

  it('escapes the text and the name as plain text, also what would start a list or heading', () => {
    const text = 'a ] b [ * c #d $x$ `y` // z\n- e\n= f\n1. g';
    const replied = addReply('', { author: 'Bo*b', date: '2026-10-11', text });
    expect(replied).toBe(
      '\n  - *Bo\\*b* (2026-10-11): a \\] b \\[ \\* c \\#d \\$x\\$ \\`y\\` \\// z\\\n    \\- e\\\n    \\= f\\\n    1\\. g\n',
    );
    expect(readThread(replied)).toEqual([{ author: 'Bo*b', date: '2026-10-11', text }]);
    expect(parseNoteCall(printNoteCall({ head: '#margin-note', note: replied }))?.note).toBe(replied);
  });

  it('ignores an empty reply', () => {
    expect(addReply('x', anna('  \n'))).toBe('x');
  });
});

describe('editMessage', () => {
  it('replaces the text of one message', () => {
    expect(editMessage(BLOCK, 1, 'Yes, #1.')).toBe(BLOCK.replace('Yes, checked with finance.', 'Yes, \\#1.'));
    expect(editMessage('- *Anna* (2026-10-10): old', 0, 'new')).toBe('- *Anna* (2026-10-10): new');
  });

  it('returns hand-written notes unchanged when the text is the same (exact round trip)', () => {
    for (const note of [BLOCK, '- *A* (2026-01-01): *bold* \\#x\n- *B* (2026-01-02): two', '\n\t- see *this*\n\t- *B* (2026-01-02): ok\n', 'a *note*']) {
      readThread(note).forEach((message, i) => expect(editMessage(note, i, message.text), note).toBe(note));
    }
  });

  it('moves an inline first message onto its own line when it gets several lines', () => {
    expect(editMessage('- *Anna* (2026-10-10): a', 0, 'a\nb')).toBe('\n  - *Anna* (2026-10-10): a\\\n    b\n');
  });

  it('edits an anonymous message as markup, escaped only where it would break the call', () => {
    expect(editMessage('old *note*', 0, 'new *note* ]')).toBe('new *note* \\]');
    expect(editMessage('\n  - old\n  - *Bob* (2026-10-11): ok\n', 0, 'new *x*\nline')).toBe('\n  - new *x*\n    line\n  - *Bob* (2026-10-11): ok\n');
  });

  it('refuses an empty text or a missing message', () => {
    expect(editMessage(BLOCK, 0, ' ')).toBeNull();
    expect(editMessage(BLOCK, 2, 'x')).toBeNull();
  });
});

describe('deleteMessage', () => {
  it('removes a message with its line', () => {
    expect(deleteMessage(BLOCK, 1)).toBe('\n  - *Anna* (2026-10-10): Is this number still right?\n');
    expect(deleteMessage(BLOCK, 0)).toBe('\n  - *Bob* (2026-10-11): Yes, checked with finance.\n');
  });

  it('leaves an empty note when the only message goes', () => {
    expect(deleteMessage('- *Anna* (2026-10-10): x', 0)).toBe('');
    expect(deleteMessage('legacy', 0)).toBe('');
    expect(deleteMessage('legacy', 1)).toBeNull();
  });
});

describe('localDate', () => {
  it('is the local date as YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('concurrent replies', () => {
  for (const [layout, note] of [['inline', '- *Anna* (2026-10-10): Is this right?'], ['block', BLOCK]]) {
    it(`converge to one thread with both replies (${layout})`, () => {
      const [docA, docB] = [new Y.Doc(), new Y.Doc()];
      docA.getText('main').insert(0, `Text #margin-note[key][${note}] more.\n`);
      connect(docA, docB)();
      const [a, b] = [TypstDocument.fromYText(docA.getText('main')), TypstDocument.fromYText(docB.getText('main'))];
      const reply = (document: TypstDocument, message: ReturnType<typeof anna>) => {
        const call = /#margin-note\[key\]\[[\s\S]*\]/.exec(document.text)!;
        const parsed = parseNoteCall(call[0])!;
        const next = printNoteCall({ ...parsed, note: addReply(parsed.note, message) });
        document.setText(document.text.replace(call[0], next), 'test');
      };
      reply(a, anna('From A'));
      reply(b, bob('From B'));
      connect(docA, docB);
      expect(a.text).toBe(b.text);
      const merged = parseNoteCall(/#margin-note\[key\]\[[\s\S]*\]/.exec(a.text)![0])!.note;
      expect(readThread(merged).slice(-2).map((m) => m.text).sort()).toEqual(['From A', 'From B']);
      expect(readThread(merged)).toHaveLength(readThread(note).length + 2);
    });
  }
});
