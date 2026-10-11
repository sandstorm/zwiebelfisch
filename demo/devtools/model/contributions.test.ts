// Tests for contributions.ts.
import { describe, expect, it } from 'vitest';
import type { ExtensionContext, TypstExtension } from '../../../src';
import { ContributionLog } from './contributions';

/** A namespace as the hosts make them: a class with private state and a getter. */
class Commands {
  readonly #handlers = new Map<string, () => unknown>();
  getterCalls = 0;

  registerCommand(id: string, handler: () => unknown) {
    this.#handlers.set(id, handler);
    return { dispose: () => this.#handlers.delete(id) };
  }

  executeCommand(id: string): unknown {
    return this.#handlers.get(id)?.();
  }

  get count(): number {
    this.getterCalls++;
    return this.#handlers.size;
  }
}

function context(commands: Commands): ExtensionContext {
  const project = { main: '/main.typ' };
  return { subscriptions: [], project, commands } as unknown as ExtensionContext;
}

describe('ContributionLog', () => {
  it('records each register… call by extension, and the settings an extension declares', () => {
    const log = new ContributionLog();
    const commands = new Commands();
    const files: TypstExtension = {
      id: 'files',
      contributes: { configuration: { properties: { 'files.panel': { type: 'string', default: 'auto', description: '' } } } },
      activate: ({ commands }) => void commands.registerCommand('files.newFile', () => 'made'),
    };
    const outline: TypstExtension = { id: 'outline', activate: ({ commands }) => void commands.registerCommand('outline.show', () => {}) };

    for (const extension of [files, outline]) log.instrument(extension).activate(context(commands));

    expect([...log.byExtension()]).toEqual([
      [
        'files',
        [
          { extension: 'files', point: 'contributes.configuration', label: 'files.panel' },
          { extension: 'files', point: 'commands.registerCommand', label: 'files.newFile' },
        ],
      ],
      ['outline', [{ extension: 'outline', point: 'commands.registerCommand', label: 'outline.show' }]],
    ]);
  });

  it('passes everything through: results, other methods and getters of class instances, other context members', () => {
    const log = new ContributionLog();
    const commands = new Commands();
    const given = context(commands);
    let seen: ExtensionContext | undefined;
    let result: unknown;
    log
      .instrument({
        id: 'probe',
        activate(context) {
          seen = context;
          const registration = context.commands.registerCommand('probe.run', () => 42);
          result = context.commands.executeCommand('probe.run');
          context.subscriptions.push(registration);
        },
      })
      .activate(given);

    expect(result).toBe(42);
    expect((seen!.commands as unknown as Commands).count).toBe(1);
    expect(seen!.project).toBe(given.project);
    expect(given.subscriptions).toHaveLength(1);
    // finding the namespaces calls no getter
    expect(commands.getterCalls).toBe(1);
  });

  it('records nothing for a registration that throws', () => {
    const log = new ContributionLog();
    const broken = { registerThing: () => { throw new Error('no'); } };
    const extension = log.instrument({ id: 'broken', activate: (context) => (context as unknown as { broken: typeof broken }).broken.registerThing() });
    expect(() => extension.activate({ subscriptions: [], broken } as unknown as ExtensionContext)).toThrow('no');
    expect(log.byExtension().size).toBe(0);
  });
});
