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
  const nothing = async () => {};
  const fakeEngine = () =>
    ({ setSource: vi.fn(), setBinary: vi.fn(), remove: vi.fn() }) as unknown as Engine & {
      setSource: ReturnType<typeof vi.fn>;
      setBinary: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };

  it('pushes text and new bytes into the engine, keeping unchanged bytes', async () => {
    const engine = fakeEngine();
    const receiver = new FileReceiver(engine);
    await receiver.update({ '/main.typ': 'a', '/logo.png': logo }, nothing);
    await receiver.update({ '/main.typ': 'b', '/logo.png': null }, nothing);
    expect(engine.setSource.mock.calls).toEqual([['/main.typ', 'a'], ['/main.typ', 'b']]);
    expect(engine.setBinary.mock.calls).toEqual([['/logo.png', logo]]);
    expect(engine.remove).not.toHaveBeenCalled();
  });

  it('removes files that are no longer sent', async () => {
    const engine = fakeEngine();
    const receiver = new FileReceiver(engine);
    await receiver.update({ '/main.typ': 'a', '/ch1.typ': 'x', '/logo.png': logo }, nothing);
    await receiver.update({ '/main.typ': 'a' }, nothing);
    expect(engine.remove.mock.calls.sort()).toEqual([['/ch1.typ'], ['/logo.png']]);
  });

  it('runs a task with replaced and added sources, then restores the project\'s', async () => {
    const engine = fakeEngine();
    const receiver = new FileReceiver(engine);
    await receiver.update({ '/main.typ': 'a', '/ch1.typ': 'x' }, nothing);
    engine.setSource.mockClear();
    const seen = await receiver.withSources({ '/ch1.typ': 'y', '/entry.typ': 'e' }, async () => engine.setSource.mock.calls.slice());
    expect(seen).toEqual([['/ch1.typ', 'y'], ['/entry.typ', 'e']]);
    expect(engine.setSource.mock.calls.slice(2)).toEqual([['/ch1.typ', 'x']]);
    expect(engine.remove.mock.calls).toEqual([['/entry.typ']]);
  });

  it('restores the sources when the task fails', async () => {
    const engine = fakeEngine();
    const receiver = new FileReceiver(engine);
    await receiver.update({ '/main.typ': 'a' }, nothing);
    await expect(receiver.withSources({ '/main.typ': 'b' }, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(engine.setSource.mock.calls.at(-1)).toEqual(['/main.typ', 'a']);
  });

  it('runs one task at a time, so a compile never sees the sources of an export', async () => {
    const engine = fakeEngine();
    const receiver = new FileReceiver(engine);
    await receiver.update({ '/main.typ': 'a' }, nothing);
    let release!: () => void;
    const order: string[] = [];
    const exported = receiver.withSources({ '/main.typ': 'b' }, async () => {
      await new Promise<void>((resolve) => (release = resolve));
      order.push('export');
    });
    const compiled = receiver.update({ '/main.typ': 'c' }, async () => {
      order.push(`compile ${engine.setSource.mock.calls.at(-1)![1]}`);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([exported, compiled]);
    expect(order).toEqual(['export', 'compile c']);
  });
});
