import { DEFAULT_COMMIT_MESSAGE, type ServerMessage } from '../collaboration/gitlab-protocol';
import { FieldPopover } from '../visual-view/visual-view';

/** A room's versions (`RoomVersions` in src/collab), as far as the controls use them. */
export interface Versions {
  base(path: string): string | null;
  onBaseChange(listener: () => void): () => void;
  save(message: string, author?: { name: string }): void;
  onMessage(listener: (message: ServerMessage) => void): () => void;
}

export interface VersionControlsOptions {
  /** The file whose changes "Show changes" shows (the main file). */
  path: string;
  /** Who saves (the commit author, unless the server knows better from the token). */
  user?: { name: string };
  /** Shows the changes against `base` from now on. */
  setBase(base: string | null): void;
}

/**
 * "Save version" in a room backed by a GitLab branch: the button (asks for a
 * commit message), the outcome as a status line, and the change rendering's
 * base following the room's last commit, so everyone's "Show changes"
 * starts over after a save.
 */
export class VersionControls {
  private readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly popover: FieldPopover;
  private readonly unsubscribe: (() => void)[];

  constructor(
    toolbar: HTMLElement,
    private readonly versions: Versions,
    private readonly options: VersionControlsOptions,
  ) {
    const doc = toolbar.ownerDocument;
    this.element = doc.createElement('span');
    this.element.className = 'typst-editor__versions';
    this.button = doc.createElement('button');
    this.button.type = 'button';
    this.button.className = 'typst-editor__save-version';
    this.button.textContent = 'Save version';
    this.status = doc.createElement('span');
    this.status.className = 'typst-editor__version-status';
    this.status.setAttribute('role', 'status');
    this.element.append(this.button, this.status);
    toolbar.append(this.element);
    this.popover = new FieldPopover(this.element, {
      label: 'Save version',
      field: 'Commit message',
      placeholder: DEFAULT_COMMIT_MESSAGE,
      apply: (message) => this.save(message),
    });
    this.button.addEventListener('click', () => {
      if (this.popover.isOpen) this.popover.close();
      else this.popover.open(this.button, DEFAULT_COMMIT_MESSAGE, false);
    });
    const followBase = () => options.setBase(versions.base(options.path));
    followBase();
    this.unsubscribe = [versions.onBaseChange(followBase), versions.onMessage((message) => this.show(message))];
  }

  destroy(): void {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.popover.destroy();
    this.element.remove();
  }

  private save(message: string): void {
    this.button.disabled = true;
    this.status.textContent = 'Saving…';
    this.versions.save(message, this.options.user);
  }

  private show(message: ServerMessage): void {
    if (message.type !== 'gitlab:merged') this.button.disabled = false;
    this.status.textContent = describe(message);
  }
}

function describe(message: ServerMessage): string {
  switch (message.type) {
    case 'gitlab:saved':
      return `Saved version ${message.sha.slice(0, 8)} (${message.author})`;
    case 'gitlab:unchanged':
      return 'No changes to save';
    case 'gitlab:merged':
      return 'Merged new changes from GitLab';
    case 'gitlab:conflict':
      return `Changes on GitLab conflict with edits in ${message.files.map((file) => file.path).join(', ')}; not saved`;
    case 'gitlab:error':
      return `Saving failed: ${message.message}`;
  }
}
