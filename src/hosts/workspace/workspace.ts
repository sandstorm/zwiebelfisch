// The workspace namespace of the extension API (VS Code's `workspace`): changes to the project's files
// (`applyEdit`, through the host's veto) and the widget's settings. Extensions declare their settings
// (`TypstExtension.contributes`), the host gives the values (`createTypstEditor({ settings })`, changeable later),
// extensions read them through `workspace.getConfiguration('<section>')` and hear about changes through
// `onDidChangeConfiguration`. Entry of hosts/workspace/. See ARCHITECTURE.md, "Extensions".
// Why settings: an option of one feature is that feature's business. The widget passes every value through one
// generic map instead of knowing each option by name, and the `<typst-editor>` element maps it onto an attribute the
// same way. Why `applyEdit` here: every change an extension asks for goes through the project's rules and then the
// host's veto (`allowFileChange`), in one place.
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { FileChange, Project } from '../../core/project/project';

/** The project's changes and the settings as extensions use them (VS Code's `workspace` namespace). */
export interface Workspace {
  /**
   * Applies `change` if the project allows it and then the host (`allowFileChange`, may be async; the project is
   * asked again afterwards). Resolves to the reason it was refused, in words for people, or null once applied.
   */
  applyEdit(change: FileChange): Promise<string | null>;
  /** The settings under `section` (`getConfiguration('pdfExport').get('download')`), or all by full id. */
  getConfiguration(section?: string): WorkspaceConfiguration;
  /** Some settings changed their value (the host set new ones). */
  readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
}

/** The values of settings by full id (`{ 'pdfExport.download': false }`): JSON-like values. */
export type Settings = Readonly<Record<string, unknown>>;

/** A JSON type a setting's value may have. */
export type ConfigurationType = 'boolean' | 'string' | 'number' | 'object' | 'array' | 'null';

/** One setting as an extension declares it (VS Code's configuration property). */
export interface ConfigurationProperty {
  /** The value's type, or the types it may have (`['string', 'null']`). A value of another type counts as unset. */
  readonly type: ConfigurationType | readonly ConfigurationType[];
  /** Its value while the host sets none. */
  readonly default: unknown;
  /** What it does, for people configuring the widget. */
  readonly description: string;
  /** The only values it may have. */
  readonly enum?: readonly unknown[];
}

/** The settings of one section (VS Code's WorkspaceConfiguration). */
export interface WorkspaceConfiguration {
  /** The value the host set, else the declared default; undefined (or `defaultValue`) for a setting no one declares. */
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  /** Whether the setting is declared or has a value. */
  has(key: string): boolean;
  /** Where the value comes from: the declared default, and the host's value if it set a valid one (`globalValue`). */
  inspect<T>(key: string): ConfigurationInspect<T> | undefined;
}

export interface ConfigurationInspect<T> {
  /** The full id. */
  readonly key: string;
  readonly defaultValue?: T;
  /** The value the host set (VS Code: the user's), absent when it set none. */
  readonly globalValue?: T;
}

/** Which settings changed (VS Code's ConfigurationChangeEvent). */
export interface ConfigurationChangeEvent {
  /** Whether the setting `section` (a full id), or one under it (`pdfExport`), changed. */
  affectsConfiguration(section: string): boolean;
}

export interface WorkspaceOptions {
  /** The settings' values by full id, changeable later (`update`). */
  settings?: Settings;
  /** The host's veto on a change someone asked for (`applyEdit`); default: all may happen. */
  allowFileChange?(change: FileChange): boolean | Promise<boolean>;
}

/**
 * The workspace of one widget: its project's changes, asked for by extensions, and the settings. A setting's value
 * counts only if the setting is declared and the value has the declared type (and is one of the `enum`, if any);
 * otherwise the setting has its default, and a warning says why.
 */
export class WorkspaceHost implements Workspace {
  readonly #properties = new Map<string, ConfigurationProperty>();
  #values: Settings;
  readonly #changed = new EventEmitter<ConfigurationChangeEvent>();
  readonly onDidChangeConfiguration = this.#changed.event;

  constructor(
    private readonly project: Project,
    private readonly options: WorkspaceOptions = {},
  ) {
    this.#values = { ...options.settings };
  }

  async applyEdit(change: FileChange): Promise<string | null> {
    const problem = this.project.check(change);
    if (problem) return problem;
    const allowed = (await this.options.allowFileChange?.(change)) ?? true;
    if (!allowed) return 'This change is not allowed here.';
    // The project may have changed while the host decided.
    const late = this.project.check(change);
    if (late) return late;
    this.project.apply(change);
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

  /** The values the host set, by full id. */
  get values(): Settings {
    return { ...this.#values };
  }

  /** Replaces the values the host set (missing ids go back to their default) and tells who listens what changed. */
  update(values: Settings): void {
    const before = this.#values;
    this.#values = { ...values };
    const ids = [...new Set([...Object.keys(before), ...Object.keys(values)])];
    const changed = ids.filter((id) => !same(this.#effective(id, before), this.#effective(id, this.#values)));
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
      has: (key) => this.#properties.has(full(key)) || full(key) in this.#values,
      inspect: <T>(key: string): ConfigurationInspect<T> | undefined => {
        const id = full(key);
        const property = this.#properties.get(id);
        if (!property) return undefined;
        const value = this.#values[id];
        return { key: id, defaultValue: property.default as T, ...(this.#isValid(id, value) ? { globalValue: value as T } : {}) };
      },
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
