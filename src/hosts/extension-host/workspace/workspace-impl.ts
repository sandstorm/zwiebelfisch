// See Workspace in workspace.ts.
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import type { FileChange, Project } from '../../../core/project/project';
import {
  type Workspace,
  type Settings,
  type ConfigurationType,
  type ConfigurationProperty,
  type WorkspaceConfiguration,
  type ConfigurationInspect,
  type ConfigurationChangeEvent,
  type WorkspaceOptions,
  type FileStat,
  type FileSystem,
  type FileSystemProvider,
  FilePermission,
  mergeSettings,
} from './workspace';

/**
 * The `Workspace` of one widget. A setting's value counts only if the setting is declared and the value has the
 * declared type (and is one of the `enum`, if any); otherwise the setting has its default, and a warning says why.
 */
export class WorkspaceHost implements Workspace {
  readonly #properties = new Map<string, ConfigurationProperty>();
  #values: Settings;
  readonly #changed = new EventEmitter<ConfigurationChangeEvent>();
  readonly onDidChangeConfiguration = this.#changed.event;
  readonly #fileSystems: FileSystemProvider[] = [];
  readonly fs: FileSystem = {
    stat: (folder): FileStat =>
      this.#fileSystems.some((provider) => provider.stat(folder).permissions === FilePermission.Readonly) ? { permissions: FilePermission.Readonly } : {},
  };

  constructor(
    private readonly project: Project,
    private readonly options: WorkspaceOptions = {},
  ) {
    this.#values = mergeSettings({}, options.settings ?? {});
  }

  async applyEdit(change: FileChange): Promise<string | null> {
    const problem = this.project.check(change) ?? this.#readonlyFolder(change);
    if (problem) return problem;
    const allowed = (await this.options.allowFileChange?.(change)) ?? true;
    if (!allowed) return 'This change is not allowed here.';
    // The project may have changed while the host decided.
    const late = this.project.check(change);
    if (late) return late;
    this.project.apply(change);
    return null;
  }

  registerFileSystemProvider(provider: FileSystemProvider): Disposable {
    this.#fileSystems.push(provider);
    return new Disposable(() => {
      const index = this.#fileSystems.indexOf(provider);
      if (index >= 0) this.#fileSystems.splice(index, 1);
    });
  }

  /** Why `change` may not happen in the folders it creates, deletes or renames a file in (Readonly), or null. */
  #readonlyFolder(change: FileChange): string | null {
    if (change.kind === 'update') return null;
    const paths = change.kind === 'rename' ? [change.from, change.path] : [change.path];
    for (const path of paths) {
      const folder = folderOf(path);
      if (this.fs.stat(folder).permissions !== FilePermission.Readonly) continue;
      const where = folder === null ? 'the top folder' : ProjectPath.displayName(folder);
      return `Files in ${where} cannot be created, renamed or deleted here.`;
    }
    return null;
  }

  /** Declares settings by full id (`pdfExport.download`); an id declared twice is an error. */
  declare(properties: Readonly<Record<string, ConfigurationProperty>>): void {
    for (const [id, property] of Object.entries(properties)) {
      if (this.#properties.has(id)) throw new Error(`Setting ${id} is declared twice`);
      this.#properties.set(id, property);
    }
  }

  /** Warns about every value set for a setting no one declared, or of the wrong type (call once all are declared). */
  check(): void {
    for (const [id, value] of Object.entries(this.#values)) this.#warnIfInvalid(id, value);
  }

  getConfigurationProperties(): ReadonlyMap<string, ConfigurationProperty> {
    return this.#properties;
  }

  /** The values the host set, by full id. */
  get values(): Settings {
    return { ...this.#values };
  }

  /**
   * Merges `values` into the values the host set (as Monaco's `updateOptions`): ids left out keep theirs, an id given
   * `undefined` goes back to its default. Tells who listens what changed.
   */
  update(values: Settings): void {
    const before = this.#values;
    this.#values = mergeSettings(before, values);
    const changed = Object.keys(values).filter((id) => !same(this.#effective(id, before), this.#effective(id, this.#values)));
    for (const id of changed) this.#warnIfInvalid(id, values[id]);
    if (changed.length === 0) return;
    this.#changed.fire({ affectsConfiguration: (section) => changed.some((id) => id === section || id.startsWith(`${section}.`)) });
  }

  getConfiguration(section?: string): WorkspaceConfiguration {
    const full = (key: string) => (section ? `${section}.${key}` : key);
    return {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        const id = full(key);
        if (!this.#properties.has(id) && !(id in this.#values)) return defaultValue;
        return this.#effective(id, this.#values) as T | undefined;
      },
      inspect: <T>(key: string): ConfigurationInspect<T> | undefined => {
        const id = full(key);
        const property = this.#properties.get(id);
        if (!property) return undefined;
        const value = this.#values[id];
        return { key: id, defaultValue: property.default as T, ...(this.#isValid(id, value) ? { globalValue: value as T } : {}) };
      },
      update: async (key: string, value: unknown) => this.update({ [full(key)]: value }),
    } as WorkspaceConfiguration;
  }

  dispose(): void {
    this.#changed.dispose();
  }

  /** The value of `id` with `values` set: the set one if valid, else the default. */
  #effective(id: string, values: Settings): unknown {
    const value = values[id];
    if (this.#isValid(id, value)) return value;
    return this.#properties.get(id)?.default;
  }

  #isValid(id: string, value: unknown): boolean {
    const property = this.#properties.get(id);
    if (!property || value === undefined) return false;
    const types: readonly ConfigurationType[] = typeof property.type === 'string' ? [property.type] : property.type;
    if (!types.includes(typeOf(value))) return false;
    return !property.enum || property.enum.includes(value);
  }

  #warnIfInvalid(id: string, value: unknown): void {
    if (value === undefined || this.#isValid(id, value)) return;
    const property = this.#properties.get(id);
    if (!property) console.warn(`Unknown setting ${id} (no extension declares it): ignored`);
    else console.warn(`Setting ${id}: ${JSON.stringify(value)} is not a valid value; using the default ${JSON.stringify(property.default)}`);
  }
}

/** The folder `path` is in; null: the top level. */
function folderOf(path: ProjectPath): ProjectPath | null {
  return ProjectPath.parse(path.slice(0, path.lastIndexOf('/')));
}

/** Equal values (settings are JSON-like: objects and arrays by content). */
function same(a: unknown, b: unknown): boolean {
  return a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
}

function typeOf(value: unknown): ConfigurationType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  return type === 'boolean' || type === 'string' || type === 'number' ? type : 'object';
}
