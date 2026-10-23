// The folder of a GitLab room that holds one folder of its branch. See Collaboration in model.ts.
import type * as Y from 'yjs';
import { ProjectPath } from '../../../core/paths/paths';
import type { Project } from '../../../core/project/project';
import { type ClientMessage, FILES_MAP, META_MAP } from '../room-protocol';
import type { StatelessChannel } from './gitlab-source-control';

/**
 * A client's side of a GitLab room of one folder (`gitlab:<project>@<branch>:/<folder>`, see `gitlabRoomFolder`):
 * - constructed before the room's files are shared, it makes the main file the folder's `main.typ`, else its first
 *   `.typ` file, else a new `main.typ` in it; not when the host fixed the main file or the room holds it
 * - `pull` asks the server for a file from outside the folder (`gitlab:pull`), once per path and base commit; it then
 *   comes into the room as any of its files
 */
export class RoomFolder {
  readonly #meta: Y.Map<unknown>;
  readonly #asked = new Set<ProjectPath>();
  #askedAt: unknown;

  constructor(
    private readonly folder: ProjectPath,
    private readonly project: Project,
    ydoc: Y.Doc,
    private readonly channel: Pick<StatelessChannel, 'send'>,
  ) {
    this.#meta = ydoc.getMap(META_MAP);
    this.#chooseMain(ydoc.getMap<Y.Text>(FILES_MAP));
  }

  /** Asks for `path`, unless it is in the folder, the project has it, or it was asked for since the base last moved. */
  pull(path: ProjectPath): void {
    if (path.startsWith(`${this.folder}/`) || this.project.has(path)) return;
    const base = this.#meta.get('baseSha');
    if (base !== this.#askedAt) {
      this.#asked.clear();
      this.#askedAt = base;
    }
    if (this.#asked.has(path)) return;
    this.#asked.add(path);
    const request: ClientMessage = { type: 'gitlab:pull', path };
    this.channel.send(JSON.stringify(request));
  }

  /** The main file in the folder; the host's empty one outside it goes. */
  #chooseMain(files: Y.Map<Y.Text>): void {
    const { project, folder } = this;
    const previous = project.main;
    if (project.mainLocked || files.has(previous)) return;
    // another client's keys: not trusted to be paths
    const typst = [...files.keys()].flatMap((key) => ProjectPath.parse(key) ?? []).filter((path) => path.startsWith(`${folder}/`) && ProjectPath.isTypst(path));
    const named = ProjectPath.of(`${folder}/main.typ`);
    const main = files.has(named) ? named : (typst.sort()[0] ?? named);
    if (!project.has(main)) project.apply({ kind: 'create', path: main, content: files.get(main)?.toString() ?? '' });
    project.setMain(main);
    if (main !== previous && project.content(previous) === '') project.apply({ kind: 'delete', path: previous });
  }
}
