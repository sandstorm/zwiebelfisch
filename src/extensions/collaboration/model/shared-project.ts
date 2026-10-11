// The project's Typst files as Y.Texts. See Collaboration in model.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import * as Y from 'yjs';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { FileChange, Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { FILES_MAP } from '../../../core/room-protocol/room-protocol';
import { TextBinding } from './text-binding';

/**
 * Shares the Typst files of a `Project` through a Y.Doc: one `Y.Text` per
 * `.typ` file in the map `files` (path → text). Every document of the project
 * is bound to its Y.Text (`TextBinding`), so text edits flow both
 * ways on their own; this class keeps the *set* of files in step: files
 * created, renamed or deleted on either side.
 *
 * Joining: the shared files win. Local Typst files the Y.Doc does not have
 * yet are added to it, so the first client seeds the room. The Y.Doc should
 * be synced with the server before (else two seeds race; the loser's
 * documents then adopt the winner's text). Other files are SharedAssets'
 * (GitLab-backed rooms only). A rename is a new Y.Text under the new path (the old one is
 * deleted); the other clients see it as a rename.
 */
export class SharedProject {
  private readonly files: Y.Map<Y.Text>;
  private readonly bindings = new Map<TypstDocument, Binding>();
  private readonly subscription: Disposable;

  constructor(
    private readonly project: Project,
    private readonly ydoc: Y.Doc,
  ) {
    this.files = ydoc.getMap<Y.Text>(FILES_MAP);
    this.pull([...this.files.keys()].flatMap((key) => ProjectPath.parse(key) ?? []), []);
    this.files.observe(this.onRemote);
    this.subscription = project.onDidChangeFile((change) => {
      if (change.kind !== 'update') this.sync();
    });
  }

  /** The shared text of `path`, if it is a shared file. */
  text(path: ProjectPath): Y.Text | undefined {
    return this.files.get(path);
  }

  /**
   * Shares the project's current set of Typst files: binds new documents,
   * deletes what is gone locally. Runs after every create / rename / delete.
   */
  private sync(): void {
    const previous = [...this.bindings.values()];
    this.ydoc.transact(() => {
      for (const path of this.project.paths()) {
        const document = this.project.document(path);
        if (document && ProjectPath.isTypst(path)) this.bind(path, document);
      }
      for (const { path, binding } of previous) {
        if (!this.project.document(path) && this.files.get(path) === binding.text) this.files.delete(path);
      }
    }, this);
    for (const [document, binding] of this.bindings) {
      if (this.project.pathOf(document) !== binding.path) this.unbind(document);
    }
  }

  /** Stops sharing; the documents keep their text. */
  dispose(): void {
    this.subscription.dispose();
    this.files.unobserve(this.onRemote);
    for (const document of [...this.bindings.keys()]) this.unbind(document);
  }

  /** Binds `document` to the shared text of `path`, seeding it from the document if there is none. */
  private bind(path: ProjectPath, document: TypstDocument): void {
    let text = this.files.get(path);
    if (!text) {
      text = new Y.Text();
      this.files.set(path, text);
      text.insert(0, document.text);
    }
    let binding = this.bindings.get(document)?.binding;
    if (binding?.text !== text) {
      binding?.dispose();
      binding = new TextBinding(text, document);
    }
    this.bindings.set(document, { path, binding });
  }

  private unbind(document: TypstDocument): void {
    this.bindings.get(document)?.binding.dispose();
    this.bindings.delete(document);
  }

  private readonly onRemote = (event: Y.YMapEvent<Y.Text>): void => {
    if (event.transaction.origin === this) return;
    const added: ProjectPath[] = [];
    const deleted: ProjectPath[] = [];
    event.changes.keys.forEach((change, key) => {
      const path = ProjectPath.parse(key); // another client's key: not trusted to be a path
      if (path) (change.action === 'delete' ? deleted : added).push(path);
    });
    this.pull(added, deleted);
  };

  /** Applies files added / deleted in the Y.Doc to the project (one of each is a rename), then binds. */
  private pull(added: ProjectPath[], deleted: ProjectPath[]): void {
    if (added.length === 1 && deleted.length === 1 && this.tryApply({ kind: 'rename', from: deleted[0], path: added[0] })) {
      this.sync();
      return;
    }
    for (const path of deleted) if (this.project.document(path)) this.tryApply({ kind: 'delete', path });
    for (const path of added) {
      const text = this.files.get(path);
      if (text && !this.project.has(path)) this.tryApply({ kind: 'create', path, content: text.toString() });
    }
    this.sync();
  }

  private tryApply(change: FileChange): boolean {
    if (this.project.check(change)) return false;
    this.project.apply(change);
    return true;
  }
}

interface Binding {
  path: ProjectPath;
  binding: TextBinding;
}
