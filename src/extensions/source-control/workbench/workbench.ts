// SourceControlView: one source control in the tab bar: "Save to <label>…" with its commit message field, and its
// status line. Entry of extensions/source-control/workbench/. See ../source-control.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import type { SourceControl } from '../../../hosts/workbench/workbench';
import { FieldPopover } from '../../../ui/field-popover/field-popover';

/**
 * The controls of `sourceControl` in `parent`: a button that asks for a commit message and commits, disabled while
 * a commit is under way, and the source control's status as a status line.
 */
export class SourceControlView {
  private readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly popover: FieldPopover;
  private readonly subscription: Disposable;

  constructor(
    parent: HTMLElement,
    private readonly sourceControl: SourceControl,
  ) {
    const doc = parent.ownerDocument;
    const action = `Save to ${sourceControl.label}`;
    const message = sourceControl.defaultCommitMessage ?? '';
    this.element = doc.createElement('span');
    this.element.className = 'typst-editor__source-control';
    this.button = doc.createElement('button');
    this.button.type = 'button';
    this.button.className = 'typst-editor__commit';
    this.button.textContent = `${action}…`;
    this.status = doc.createElement('span');
    this.status.className = 'typst-editor__source-control-status';
    this.status.setAttribute('role', 'status');
    this.element.append(this.button, this.status);
    parent.append(this.element);
    this.popover = new FieldPopover(this.element, {
      label: action,
      field: 'Commit message',
      placeholder: message,
      apply: (text) => sourceControl.commit(text),
    });
    this.button.addEventListener('click', () => {
      if (this.popover.isOpen) this.popover.close();
      else this.popover.open(this.button, message, false);
    });
    this.subscription = sourceControl.onDidChange(() => this.show());
    this.show();
  }

  destroy(): void {
    this.subscription.dispose();
    this.popover.destroy();
    this.element.remove();
  }

  private show(): void {
    const { busy, status } = this.sourceControl.state;
    this.button.disabled = busy;
    this.status.textContent = status;
  }
}
