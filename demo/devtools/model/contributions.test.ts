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

    const summary = [...log.byExtension()].map(([extension, entries]) => [extension, entries.map((entry) => `${entry.point}: ${entry.title} ${entry.details.join(', ')}`.trim())]);
    expect(summary).toEqual([
      ['files', ['contributes.configuration: files.panel string, default "auto"', 'commands.registerCommand: files.newFile']],
      ['outline', ['commands.registerCommand: outline.show']],
    ]);
    const [setting, command] = log.byExtension().get('files')!;
    expect(setting.arguments).toContain('default: "auto"');
    expect(command.arguments).toBe('["files.newFile", ƒ]');
    // the extension's line that registered it
    expect(command.location).toMatch(/contributions\.test\.ts:\d+:\d+$/);
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

  it('marks registrations made after activation and those disposed since, and tells of both', () => {
    const log = new ContributionLog();
    const commands = new Commands();
    let changes = 0;
    log.onDidChange(() => changes++);
    let later = () => {};
    log
      .instrument({
        id: 'late',
        activate(context) {
          const early = context.commands.registerCommand('late.early', () => {});
          later = () => {
            context.commands.registerCommand('late.later', () => {});
            early.dispose();
            early.dispose();
          };
        },
      })
      .activate(context(commands));
    expect(changes).toBe(0);

    later();

    expect(log.byExtension().get('late')!.map(({ title, late, disposed }) => ({ title, late, disposed }))).toEqual([
      { title: 'late.early', late: false, disposed: true },
      { title: 'late.later', late: true, disposed: false },
    ]);
    expect(changes).toBe(2);
    // the registration still went away
    expect(commands.executeCommand('late.early')).toBeUndefined();
  });

  it('groups by contribution point, each in the order its host resolves them: by priority, else registration order', () => {
    const log = new ContributionLog();
    const visualView = { registerRawBoxRenderer: (_provider: unknown, _options?: { priority?: number }) => ({ dispose() {} }) };
    const renderers = (id: string, priority?: number) =>
      log.instrument({ id, activate: (context) => void (context as unknown as { visualView: typeof visualView }).visualView.registerRawBoxRenderer(function render() {}, { priority }) });
    for (const extension of [renderers('snippets'), renderers('images', 110), renderers('diagrams')]) {
      extension.activate({ subscriptions: [], visualView } as unknown as ExtensionContext);
    }
    expect([...log.byPoint()].map(([point, entries]) => [point, entries.map((entry) => entry.extension)])).toEqual([['visualView.registerRawBoxRenderer', ['images', 'snippets', 'diagrams']]]);
  });

  it('records nothing for a registration that throws', () => {
    const log = new ContributionLog();
    const broken = { registerThing: () => { throw new Error('no'); } };
    const extension = log.instrument({ id: 'broken', activate: (context) => (context as unknown as { broken: typeof broken }).broken.registerThing() });
    expect(() => extension.activate({ subscriptions: [], broken } as unknown as ExtensionContext)).toThrow('no');
    expect(log.byExtension().size).toBe(0);
  });
});
