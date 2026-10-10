// Tests for document-links.ts: the file paths of a text as document links.
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import type { Command, DocumentLinkProvider, ExtensionContext } from '../../hosts/workbench/workbench';
import { documentLinks } from './document-links';

const path = ProjectPath.of;

const TEXT = '#import "template.typ": t\n#include "missing.typ"\n#image("gone.png")\n#include "../up.typ"\n';

function setup() {
  const project = new Project(path('/main.typ'), { '/main.typ': TEXT, '/template.typ': '' });
  let provider: DocumentLinkProvider | null = null;
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const workbench = {
    registerDocumentLinkProvider: (registered: DocumentLinkProvider) => ((provider = registered), new Disposable(() => {})),
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => (commands.set(id, handler), new Disposable(() => {})),
    applyChange: vi.fn(async () => null as string | null),
    open: vi.fn(),
  };
  documentLinks().activate({ project, workbench, subscriptions: [] } as unknown as ExtensionContext);
  const links = provider!.provideDocumentLinks({ path: path('/main.typ'), text: TEXT });
  const resolved = links.map((link) => provider!.resolveDocumentLink!(link));
  const run = async (command: Command) => commands.get(command.command)!(...(command.arguments ?? []));
  return { workbench, links, resolved, run };
}

describe('documentLinks', () => {
  it('links the file paths of a text, by their range', () => {
    const { links } = setup();
    expect(links.map(({ range }) => TEXT.slice(range.from, range.to))).toEqual(['template.typ', 'missing.typ', 'gone.png', '../up.typ']);
  });

  it('resolves an existing file to its target, a missing one to a tooltip, a path out of the project to nothing', () => {
    const { resolved } = setup();
    expect(resolved[0]).toMatchObject({ target: path('/template.typ') });
    expect(resolved[2]).toMatchObject({ tooltip: 'gone.png is not in the project' });
    expect(resolved[2].command).toBeUndefined();
    expect(resolved[3]).toEqual({ range: expect.anything() });
  });

  it('offers to create a missing Typst file (a command), and opens it once created', async () => {
    const { resolved, workbench, run } = setup();
    const { tooltip, command } = resolved[1];
    expect(tooltip).toBe('missing.typ is not in the project');
    expect(command).toEqual({ title: 'Create missing.typ', command: 'documentLinks.createFile', arguments: ['/missing.typ'] });
    await run(command!);
    expect(workbench.applyChange).toHaveBeenCalledWith({ kind: 'create', path: path('/missing.typ'), content: '' });
    expect(workbench.open).toHaveBeenCalledWith(path('/missing.typ'));
    workbench.applyChange.mockResolvedValueOnce('This change is not allowed here.');
    await expect(run(command!)).rejects.toThrow('This change is not allowed here.');
  });
});
