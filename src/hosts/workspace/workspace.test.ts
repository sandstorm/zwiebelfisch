// Tests for workspace.ts (WorkspaceHost): changes through the host's veto; declared settings, the host's values, changes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import { type ConfigurationChangeEvent, WorkspaceHost } from './workspace';

const PROPERTIES = {
  'pdfExport.download': { type: 'boolean', default: true, description: 'Download button.' },
  'files.panel': { type: 'string', enum: ['auto', 'show', 'hide'], default: 'auto', description: 'File panel.' },
  'workbench.theme': { type: ['string', 'null'], default: null, description: 'Theme.' },
} as const;

function setup(values = {}) {
  const configuration = new WorkspaceHost(new Project(ProjectPath.of('/main.typ'), {}), { settings: values });
  configuration.declare(PROPERTIES);
  const events: ConfigurationChangeEvent[] = [];
  configuration.onDidChangeConfiguration((event) => events.push(event));
  return { configuration, events };
}

afterEach(() => vi.restoreAllMocks());

const path = ProjectPath.of;

describe('WorkspaceHost.applyEdit', () => {
  it('applies a change only if the project and then the host allow it', async () => {
    const project = new Project(path('/main.typ'), { '/main.typ': '= Main\n', '/a.typ': 'A\n' });
    const allowFileChange = vi.fn(async () => false);
    const workspace = new WorkspaceHost(project, { allowFileChange });
    expect(await workspace.applyEdit({ kind: 'delete', path: path('/main.typ') })).toMatch(/main file/i);
    expect(allowFileChange).not.toHaveBeenCalled();
    expect(await workspace.applyEdit({ kind: 'delete', path: path('/a.typ') })).toBe('This change is not allowed here.');
    allowFileChange.mockResolvedValue(true);
    expect(await workspace.applyEdit({ kind: 'delete', path: path('/a.typ') })).toBeNull();
    expect(project.has(path('/a.typ'))).toBe(false);
  });

  it('asks the project again once the host decided', async () => {
    const project = new Project(path('/main.typ'), { '/main.typ': '' });
    const workspace = new WorkspaceHost(project, {
      allowFileChange: async () => (project.apply({ kind: 'create', path: path('/b.typ'), content: '' }), true),
    });
    expect(await workspace.applyEdit({ kind: 'create', path: path('/b.typ'), content: 'B' })).toMatch(/already exists/);
  });
});

describe('WorkspaceHost settings', () => {
  it("reads a section's settings: the host's value, else the declared default", () => {
    const { configuration } = setup({ 'pdfExport.download': false });
    expect(configuration.getConfiguration('pdfExport').get('download')).toBe(false);
    expect(configuration.getConfiguration('files').get('panel')).toBe('auto');
    expect(configuration.getConfiguration().get('files.panel')).toBe('auto');
    expect(configuration.getConfiguration('workbench').get('theme')).toBeNull();
  });

  it('gives undefined, or the default asked for, for a setting no one declares', () => {
    const { configuration } = setup();
    expect(configuration.getConfiguration('files').get('nope')).toBeUndefined();
    expect(configuration.getConfiguration('files').get('nope', 7)).toBe(7);
    expect(configuration.getConfiguration('files').has('panel')).toBe(true);
    expect(configuration.getConfiguration('files').has('nope')).toBe(false);
  });

  it("tells where a value comes from (inspect): the default, and the host's value if it set one", () => {
    const { configuration } = setup({ 'pdfExport.download': false });
    expect(configuration.getConfiguration('pdfExport').inspect('download')).toEqual({ key: 'pdfExport.download', defaultValue: true, globalValue: false });
    expect(configuration.getConfiguration('files').inspect('panel')).toEqual({ key: 'files.panel', defaultValue: 'auto' });
    expect(configuration.getConfiguration('files').inspect('nope')).toBeUndefined();
  });

  it('ignores values of the wrong type or outside the enum, and unknown settings, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { configuration } = setup({ 'pdfExport.download': 'no', 'files.panel': 'left', 'other.thing': 1 });
    configuration.check();
    expect(configuration.getConfiguration('pdfExport').get('download')).toBe(true);
    expect(configuration.getConfiguration('files').get('panel')).toBe('auto');
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining('pdfExport.download'),
      expect.stringContaining('files.panel'),
      expect.stringContaining('Unknown setting other.thing'),
    ]);
  });

  it('replaces the values and fires once for what changed, by setting and by section', () => {
    const { configuration, events } = setup({ 'pdfExport.download': false, 'files.panel': 'show' });
    configuration.update({ 'files.panel': 'show', 'workbench.theme': 'dark' });
    expect(configuration.values).toEqual({ 'files.panel': 'show', 'workbench.theme': 'dark' });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.affectsConfiguration('pdfExport.download')).toBe(true);
    expect(event.affectsConfiguration('pdfExport')).toBe(true);
    expect(event.affectsConfiguration('workbench.theme')).toBe(true);
    expect(event.affectsConfiguration('files.panel')).toBe(false);
    expect(event.affectsConfiguration('pdf')).toBe(false);
  });

  it('fires nothing when no value changes (setting the default counts as no change)', () => {
    const { configuration, events } = setup();
    configuration.update({ 'files.panel': 'auto' });
    expect(events).toEqual([]);
  });

  it('refuses a setting declared twice', () => {
    expect(() => setup().configuration.declare({ 'files.panel': PROPERTIES['files.panel'] })).toThrow(/declared twice/);
  });
});
