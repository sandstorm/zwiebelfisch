// VersionControls: the "Save version" button, its commit message field and the outcome as a status line.
// See ../versions.ts.
import { DEFAULT_COMMIT_MESSAGE, type ServerMessage } from '../../../features/collaboration/gitlab-protocol';
import { FieldPopover } from '../../../ui/field-popover/field-popover';
import { versionStatus } from '../model/model';

/** A room's versions (`RoomVersions` of the collaboration session), as far as the controls use them. */
export interface Versions {
  save(message: string, author?: { name: string }): void;
  onMessage(listener: (message: ServerMessage) => void): () => void;
}

export interface VersionControlsOptions {
  /** Who saves (the commit author, unless the server knows better from the token). */
  user?: { name: string };
}

/**
 * "Save version" in a room backed by a GitLab branch: the button (asks for a
 * commit message) and the outcome as a status line.
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
    this.unsubscribe = [versions.onMessage((message) => this.show(message))];
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
    this.status.textContent = versionStatus(message);
  }
}
