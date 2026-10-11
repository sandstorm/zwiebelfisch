// The files the user was in, for "Back to …" / "Forward to …", as data. See fileNavigation in ../file-navigation.ts.
import type { ProjectPath } from '../../../core/paths/paths';
import type { FileChange } from '../../../core/project/project';
import type { SourceRange } from '../../../core/typst-document/typst-document';

/**
 * The files shown one after another, oldest first, and the one shown now among them. Opening another file drops what
 * lay ahead (as a browser's history). A location's editor and selection are those it had when the user left it.
 * Renamed files keep their places; deleted files go, and the same file twice in a row becomes one place.
 */
export class NavigationHistory {
  #locations: NavigationLocation[];
  #index = 0;

  constructor(start: ProjectPath) {
    this.#locations = [{ path: start }];
  }

  /** Where going back leads; undefined at the start. */
  get back(): NavigationLocation | undefined {
    return this.#locations[this.#index - 1];
  }

  /** Where going forward leads; undefined unless the user went back. */
  get forward(): NavigationLocation | undefined {
    return this.#locations[this.#index + 1];
  }

  /** The user left `from` (the current file, as it is now) for the file `to`: `from` is the way back now. */
  open(from: NavigationLocation, to: ProjectPath): void {
    if (from.path === to) return;
    this.#locations.splice(this.#index, Infinity, from, { path: to });
    this.#index++;
    const over = this.#locations.length - HISTORY_LIMIT;
    if (over > 0) {
      this.#locations.splice(0, over);
      this.#index -= over;
    }
  }

  /** Goes back from `from` (the current file, as it is now): the location to show, undefined at the start. */
  goBack(from: NavigationLocation): NavigationLocation | undefined {
    return this.#go(from, -1);
  }

  /** Goes forward from `from` (the current file, as it is now): the location to show, undefined at the end. */
  goForward(from: NavigationLocation): NavigationLocation | undefined {
    return this.#go(from, 1);
  }

  /**
   * Keeps the places with their files: a renamed file under its new name, a deleted one gone (but the current place:
   * the workbench shows another file then, which `open` records).
   */
  followFileChange(change: FileChange): void {
    if (change.kind === 'rename') {
      this.#locations = this.#locations.map((location) => (location.path === change.from ? { ...location, path: change.path } : location));
    } else if (change.kind === 'delete') {
      const current = this.#locations[this.#index];
      this.#locations = this.#locations.filter((location) => location.path !== change.path || location === current);
      this.#index = this.#locations.indexOf(current);
    } else return;
    this.#mergeRepeats();
  }

  #go(from: NavigationLocation, step: -1 | 1): NavigationLocation | undefined {
    const target = this.#locations[this.#index + step];
    if (!target) return undefined;
    this.#locations[this.#index] = from;
    this.#index += step;
    return target;
  }

  /** The same file twice in a row is one place: the current one, else the one visited later. */
  #mergeRepeats(): void {
    const current = this.#locations[this.#index];
    const merged: NavigationLocation[] = [];
    for (const location of this.#locations) {
      const last = merged[merged.length - 1];
      if (last?.path !== location.path) merged.push(location);
      else if (last !== current) merged[merged.length - 1] = location;
    }
    this.#locations = merged;
    this.#index = merged.indexOf(current);
  }
}

/** Where the user was: a file, the editor it was shown in, and the selection there (a Typst file's). */
export interface NavigationLocation {
  readonly path: ProjectPath;
  /** The custom editor it was shown in (e.g. `sourceEditor`); undefined: the one it opens in. */
  readonly viewType?: string;
  readonly selection?: SourceRange;
}

/** How many locations are kept, the current one included; the oldest go first. */
export const HISTORY_LIMIT = 50;
