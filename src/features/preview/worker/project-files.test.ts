// Tests for project-files.ts.
import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '../../../core/typst-engine/typst-engine';
import { FileSender, FileReceiver } from './project-files';

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

describe('FileReceiver', () => {
  const fakeEngine = () =>
    ({ setSource: vi.fn(), setBinary: vi.fn(), remove: vi.fn() }) as unknown as Engine & {
      setSource: ReturnType<typeof vi.fn>;
      setBinary: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };

  it('pushes text and new bytes into the engine, keeping unchanged bytes', () => {
    const engine = fakeEngine();
    const receiver = new FileReceiver(engine);
    receiver.apply({ '/main.typ': 'a', '/logo.png': logo });
    receiver.apply({ '/main.typ': 'b', '/logo.png': null });
    expect(engine.setSource.mock.calls).toEqual([['/main.typ', 'a'], ['/main.typ', 'b']]);
    expect(engine.setBinary.mock.calls).toEqual([['/logo.png', logo]]);
    expect(engine.remove).not.toHaveBeenCalled();
  });

  it('removes files that are no longer sent', () => {
    const engine = fakeEngine();
    const receiver = new FileReceiver(engine);
    receiver.apply({ '/main.typ': 'a', '/ch1.typ': 'x', '/logo.png': logo });
    receiver.apply({ '/main.typ': 'a' });
    expect(engine.remove.mock.calls.sort()).toEqual([['/ch1.typ'], ['/logo.png']]);
  });
});
