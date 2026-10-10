// What the source-control extension does in the workbench: commit to a source control, asking for the message, and
// tell its outcomes and news as messages. See ../source-control.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import type { SourceControl, Workbench } from '../../../hosts/workbench/workbench';

/** What committing and telling need of the workbench. */
export type SourceControlUi = Pick<Workbench, 'sourceControls' | 'showInputBox' | 'showQuickPick' | 'showInformationMessage' | 'showWarningMessage' | 'showErrorMessage'>;

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
export async function commit(ui: SourceControlUi): Promise<void> {
  const controls = ui.sourceControls;
  const control =
    controls.length > 1
      ? (await ui.showQuickPick(controls.map((each) => ({ label: `Save to ${each.label}…`, control: each })), { title: 'Save', placeHolder: 'Where to save' }))?.control
      : controls[0];
  if (!control) return;
  if (control.state.busy) {
    void ui.showInformationMessage(`Saving to ${control.label} is under way.`);
    return;
  }
  const message = await ui.showInputBox({
    title: `Save to ${control.label}`,
    prompt: 'Commit message',
    value: control.defaultCommitMessage ?? '',
    placeHolder: control.defaultCommitMessage,
    validateInput: (value) => (value.trim() === '' ? 'Enter a commit message.' : null),
  });
  if (message !== undefined) control.commit(message.trim());
}

/** Tells each new status of `control` as a message of its severity, until disposed. */
export function tellStatus(ui: SourceControlUi, control: SourceControl): Disposable {
  let told = control.state.status;
  return control.onDidChange(() => {
    const { status } = control.state;
    if (status === told) return;
    told = status;
    if (!status) return;
    const show = { info: ui.showInformationMessage, warning: ui.showWarningMessage, error: ui.showErrorMessage }[status.severity];
    void show.call(ui, status.message);
  });
}
