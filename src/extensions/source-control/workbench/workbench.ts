// What the source-control extension does in the workbench: commit to a source control, asking for the message.
// See ../source-control.ts.
import type { Scm, SourceControl } from '../../../hosts/scm/scm';
import type { WindowApi } from '../../../hosts/window/window';

/** What committing needs of the extension API: the source controls, and the window to ask (and say it is busy). */
export interface SourceControlUi {
  readonly scm: Pick<Scm, 'sourceControls'>;
  readonly window: Pick<WindowApi, 'showInputBox' | 'showQuickPick' | 'showInformationMessage'>;
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
