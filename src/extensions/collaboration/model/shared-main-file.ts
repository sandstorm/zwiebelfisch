// The project's main file as state of the room. See Collaboration in model.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type * as Y from 'yjs';
import type { Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { PROJECT_MAP } from '../../../core/room-protocol/room-protocol';

/**
 * Shares which file is the project's main one through the Y.Doc map `project` (key `main`: its path), so everyone in
 * the room compiles the same file. A change on either side reaches the other (`setMain`).
 *
 * Joining: the room's main file wins; a room without one takes the local main file. A main file the project does not
 * have yet (its file still on the way) is taken once it arrives.
 */
export class SharedMainFile {
  private readonly state: Y.Map<string>;
  private readonly subscription: Disposable;

  constructor(
    private readonly project: Project,
    private readonly ydoc: Y.Doc,
  ) {
    this.state = ydoc.getMap<string>(PROJECT_MAP);
    if (this.state.has(MAIN_KEY)) this.pull();
    else this.push(project.main);
    this.state.observe(this.onRemote);
    this.subscription = Disposable.from(
      project.onDidChangeMain((path) => this.push(path)),
      project.onDidChangeFile((change) => {
        if (change.kind !== 'update') this.pull();
      }),
    );
  }

  dispose(): void {
    this.subscription.dispose();
    this.state.unobserve(this.onRemote);
  }

  private push(path: ProjectPath): void {
    if (this.state.get(MAIN_KEY) !== path) this.ydoc.transact(() => this.state.set(MAIN_KEY, path), this);
  }

  /** Takes the room's main file, when the project has it (another client's value: not trusted to be a path). */
  private pull(): void {
    const path = ProjectPath.parse(this.state.get(MAIN_KEY) ?? '');
    if (path && this.project.document(path)) this.project.setMain(path);
  }

  private readonly onRemote = (event: Y.YMapEvent<string>): void => {
    if (event.transaction.origin !== this) this.pull();
  };
}

const MAIN_KEY = 'main';
