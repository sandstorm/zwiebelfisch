// Tests for worker.ts.
import { describe, expect, it } from 'vitest';
import { FileSender } from './worker';

const logo = new Uint8Array([1, 2, 3]);

describe('FileSender', () => {
  it('sends text every time but the same bytes only once', () => {
    const sender = new FileSender();
    expect(sender.encode({ '/main.typ': 'a', '/logo.png': logo })).toEqual({ '/main.typ': 'a', '/logo.png': logo });
    expect(sender.encode({ '/main.typ': 'b', '/logo.png': logo })).toEqual({ '/main.typ': 'b', '/logo.png': null });
  });

  it('sends bytes again when they are replaced, or were removed in between', () => {
    const sender = new FileSender();
    sender.encode({ '/logo.png': logo });
    const other = new Uint8Array([4]);
    expect(sender.encode({ '/logo.png': other })).toEqual({ '/logo.png': other });
    sender.encode({});
    expect(sender.encode({ '/logo.png': other })).toEqual({ '/logo.png': other });
  });
});
