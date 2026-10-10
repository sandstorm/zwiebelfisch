import * as Y from 'yjs';
import type { TypstDocument } from '../core/typst-document/typst-document';
import type { Project } from '../core/project/project';
import { fileKind } from '../core/project/paths';

/** The Y.Doc's map of shared Typst files: path → text. */
export const FILES_MAP = 'files';

interface Binding {
  path: string;
  text: Y.Text;
}

/**
 * Shares the Typst files of a `Project` through a Y.Doc: one `Y.Text` per
 * `.typ` file in the map `files` (path → text). Every document of the project
 * is bound to its Y.Text (`TypstDocument.share`), so text edits flow both
 * ways on their own; this class keeps the *set* of files in step: files
 * created, renamed or deleted on either side.
 *
 * Joining: the shared files win. Local Typst files the Y.Doc does not have
 * yet are added to it, so the first client seeds the room. The Y.Doc should
 * be synced with the server before (else two seeds race; the loser's
 * documents then adopt the winner's text). Images and other files are not
 * shared. A rename is a new Y.Text under the new path (the old one is
 * deleted); the other clients see it as a rename.
 */
export class SharedProject {
  private readonly files: Y.Map<Y.Text>;
  private readonly bindings = new Map<TypstDocument, Binding>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly project: Project,
    private readonly ydoc: Y.Doc,
  ) {
    this.files = ydoc.getMap<Y.Text>(FILES_MAP);
    this.pull([...this.files.keys()], []);
    this.files.observe(this.onRemote);
    this.unsubscribe = project.onChange((change) => {
      if (change.kind !== 'update') this.sync();
    });
  }

  /** The shared text of `path`, if it is a shared file. */
  text(path: string): Y.Text | undefined {
    return this.files.get(path);
  }

  /**
   * Shares the project's current set of Typst files: binds new documents,
   * deletes what is gone locally. Runs after every create / rename / delete;
   * call it after `Project.replace`, which does not report one.
   */
  sync(): void {
    const previous = [...this.bindings.values()];
    this.ydoc.transact(() => {
      for (const path of this.project.paths()) {
        const document = this.project.document(path);
        if (document && fileKind(path) === 'typst') this.bind(path, document);
      }
      for (const { path, text } of previous) {
        if (!this.project.document(path) && this.files.get(path) === text) this.files.delete(path);
      }
    }, this);
    for (const [document, binding] of this.bindings) {
      if (this.project.pathOf(document) !== binding.path) this.unbind(document);
    }
  }

  /** Stops sharing; the documents keep their text. */
  destroy(): void {
    this.unsubscribe();
    this.files.unobserve(this.onRemote);
    for (const document of [...this.bindings.keys()]) this.unbind(document);
  }

  /** Binds `document` to the shared text of `path`, seeding it from the document if there is none. */
  private bind(path: string, document: TypstDocument): void {
    let text = this.files.get(path);
    if (!text) {
      text = new Y.Text();
      this.files.set(path, text);
      text.insert(0, document.text);
    }
    if (this.bindings.get(document)?.text !== text) document.share(text);
    this.bindings.set(document, { path, text });
  }

  private unbind(document: TypstDocument): void {
    document.share(null);
    this.bindings.delete(document);
  }

  private readonly onRemote = (event: Y.YMapEvent<Y.Text>): void => {
    if (event.transaction.origin === this) return;
    const added: string[] = [];
    const deleted: string[] = [];
    event.changes.keys.forEach((change, key) => (change.action === 'delete' ? deleted : added).push(key));
    this.pull(added, deleted);
  };

  /** Applies files added / deleted in the Y.Doc to the project (one of each is a rename), then binds. */
  private pull(added: string[], deleted: string[]): void {
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

  private tryApply(change: Parameters<Project['apply']>[0]): boolean {
    if (this.project.check(change)) return false;
    this.project.apply(change);
    return true;
  }
}
