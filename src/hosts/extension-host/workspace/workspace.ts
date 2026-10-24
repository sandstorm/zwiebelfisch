import type { Disposable } from '../../../core/disposable/disposable';
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import type { FileChange } from '../../../core/project/project';

/**
 * Changes to the project's files and the widget's settings (VS Code's `workspace` namespace).
 *
 * Extensions use it to:
 * - change files (`applyEdit`): a change is applied only if the project's rules, the permissions of the files and
 *   folders it touches (`fs`) and then the host page (`allowFileChange`) allow it
 * - make files and folders read-only (`registerFileSystemProvider`)
 * - read the settings they declare (`contributes.configuration`), hear when the host page sets new values, and set
 *   them for the widget (a settings UI)
 *
 * A setting value that is undeclared or of the wrong type is ignored (the setting keeps its default), with a warning.
 */
export interface Workspace {
  /**
   * Applies `change` if the project allows it, no folder it creates, deletes or renames a file in and no file it
   * touches is Readonly (`fs.stat`), and then the host allows it (`allowFileChange`, may be async; the project is asked again
   * afterwards). Resolves to the reason it was refused, in words for people, or null once applied.
   */
  applyEdit(change: FileChange): Promise<string | null>;
  /** The permissions of the project's files and folders (VS Code's `workspace.fs`; synchronous, the project is in memory). */
  readonly fs: FileSystem;
  /**
   * Registers a provider of file and folder permissions (VS Code's `workspace.registerFileSystemProvider`, for `stat`
   * only): a file or folder is Readonly while any registered provider says so.
   */
  registerFileSystemProvider(provider: FileSystemProvider): Disposable;
  /** The settings under `section` (`getConfiguration('pdfExport').get('download')`), or all by full id. */
  getConfiguration(section?: string): WorkspaceConfiguration;
  /**
   * Every declared setting by full id, in declaration order (VS Code's configuration registry's
   * `getConfigurationProperties`), e.g. for a settings UI.
   */
  getConfigurationProperties(): ReadonlyMap<string, ConfigurationProperty>;
  /** Some settings changed their value (the host set new ones). */
  readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
}

/**
 * VS Code's FilePermission: `Readonly`, a folder in which no file is created, renamed or moved in or out, or deleted;
 * a file that is not changed, renamed or deleted (nor created, when it is not there yet).
 */
export const FilePermission = { Readonly: 1 } as const;

export type FilePermission = (typeof FilePermission)[keyof typeof FilePermission];

/** What is known of a file or folder (VS Code's FileStat, its permissions only). */
export interface FileStat {
  readonly permissions?: FilePermission;
}

/** The project's files and folders (VS Code's FileSystem, `stat` only). */
export interface FileSystem {
  /** The stat of the file or folder `path` (it need not be there yet); null is the top level. */
  stat(path: ProjectPath | null): FileStat;
}

/** Says what may be done with files and in folders (VS Code's FileSystemProvider, `stat` only). */
export interface FileSystemProvider {
  /** The stat of the file or folder `path` (it need not be there yet); null is the top level. */
  stat(path: ProjectPath | null): FileStat;
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
  /** Where the value comes from: the declared default, and the host's value if it set a valid one (`globalValue`). */
  inspect<T>(key: string): ConfigurationInspect<T> | undefined;
  /**
   * Sets the setting's value for this widget, as if the host had set it (VS Code's `update`, the global target);
   * `undefined` goes back to the default. Listeners hear the change; an invalid value is ignored, with a warning.
   */
  update(key: string, value: unknown): Promise<void>;
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

/** `changes` over `settings`, id by id; an id whose value is `undefined` is removed. */
export function mergeSettings(settings: Settings, changes: Settings): Settings {
  const merged: Record<string, unknown> = { ...settings, ...changes };
  for (const [id, value] of Object.entries(changes)) if (value === undefined) delete merged[id];
  return merged;
}

export { WorkspaceHost } from './workspace-impl';
