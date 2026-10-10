// FileViews: which view shows a file that is not Typst source, by its kind (`Workbench.registerFileView`).
// See workbench.ts.
import { Disposable } from '../../../core/disposable/disposable';
import { ProjectPath, type FileKind } from '../../../core/paths/paths';
import type { FileContent } from '../../../core/project/project';
import type { FileView, FileViewProvider } from '../workbench';

/**
 * The file views of the editing area, one provider per kind. A provider's view is created the first time a file
 * of its kind is shown (one view per provider, also when it is registered for several kinds); showing a file hides
 * every other view.
 */
export class FileViews {
  readonly #providers = new Map<FileKind, FileViewProvider>();
  readonly #views = new Map<FileViewProvider, FileView>();

  constructor(private readonly parent: HTMLElement) {}

  register(kind: FileKind, provider: FileViewProvider): Disposable {
    if (this.#providers.has(kind)) throw new Error(`A file view for ${kind} files is registered already`);
    this.#providers.set(kind, provider);
    return new Disposable(() => {
      this.#providers.delete(kind);
      if ([...this.#providers.values()].includes(provider)) return;
      this.#views.get(provider)?.dispose();
      this.#views.delete(provider);
    });
  }

  /** Shows `path` in the view for its kind (if there is one); null (a Typst file is shown) hides them all. */
  show(file: { path: ProjectPath; content: FileContent } | null): void {
    const provider = file ? this.#providers.get(ProjectPath.kind(file.path)) : undefined;
    for (const [owner, view] of this.#views) if (owner !== provider) view.hide();
    if (!file || !provider) return;
    let view = this.#views.get(provider);
    if (!view) {
      view = provider.createFileView(this.parent);
      this.#views.set(provider, view);
    }
    view.show(file.path, file.content);
  }

  dispose(): void {
    for (const view of this.#views.values()) view.dispose();
    this.#views.clear();
    this.#providers.clear();
  }
}
