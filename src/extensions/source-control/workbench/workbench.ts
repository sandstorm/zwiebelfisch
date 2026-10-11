// What the source-control extension does in the workbench: commit to a source control, asking for the message, and
// tell its outcomes and news as messages. See ../source-control.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import type { Scm, SourceControl } from '../../../hosts/scm/scm';
import type { Window } from '../../../hosts/window/window';

/** What telling needs of the window: its messages. */
export type SourceControlMessages = Pick<Window, 'showInformationMessage' | 'showWarningMessage' | 'showErrorMessage'>;

/** What committing needs of the extension API: the source controls, and the window to ask and tell. */
export interface SourceControlUi {
  readonly scm: Pick<Scm, 'sourceControls'>;
  readonly window: Pick<Window, 'showInputBox' | 'showQuickPick'> & SourceControlMessages;
}

/** The tab bar's entry for the registered source controls: "Save to GitLab…" ("Saving to GitLab…" meanwhile). */
export function commitTitle(controls: readonly SourceControl[]): string {
  if (controls.length !== 1) return 'Save…';
  const [control] = controls;
  return control.state.busy ? `Saving to ${control.label}…` : `Save to ${control.label}…`;
}

/**
 * Commits the project: to the one registered source control, or the one picked, with the message the user enters
 * (its default offered). While a commit is under way it only says so.
 */
export async function commit({ scm, window }: SourceControlUi): Promise<void> {
  const controls = scm.sourceControls;
  const control =
    controls.length > 1
      ? (await window.showQuickPick(controls.map((each) => ({ label: `Save to ${each.label}…`, control: each })), { title: 'Save', placeHolder: 'Where to save' }))?.control
      : controls[0];
  if (!control) return;
  if (control.state.busy) {
    void window.showInformationMessage(`Saving to ${control.label} is under way.`);
    return;
  }
  const message = await window.showInputBox({
    title: `Save to ${control.label}`,
    prompt: 'Commit message',
    value: control.defaultCommitMessage ?? '',
    placeHolder: control.defaultCommitMessage,
    validateInput: (value) => (value.trim() === '' ? 'Enter a commit message.' : null),
  });
  if (message !== undefined) control.commit(message.trim());
}

/** Tells each new status of `control` as a message of its severity, until disposed. */
export function tellStatus(messages: SourceControlMessages, control: SourceControl): Disposable {
  let told = control.state.status;
  return control.onDidChange(() => {
    const { status } = control.state;
    if (status === told) return;
    told = status;
    if (!status) return;
    const show = { info: messages.showInformationMessage, warning: messages.showWarningMessage, error: messages.showErrorMessage }[status.severity];
    void show.call(messages, status.message);
  });
}
