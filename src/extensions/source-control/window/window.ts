// What the source-control extension does in the window. See sourceControl in ../source-control.ts.
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { Scm, SourceControl } from '../../../hosts/scm/scm';
import type { FileDecoration, FileDecorationProvider, WindowApi } from '../../../hosts/window/window';

/**
 * Commits the project with the message the user enters (its default offered): to `control`, else to the one
 * source control the user may commit to or the one picked. While a commit is under way it only says so; a source
 * control the user may not commit to (no `commit`) is never asked.
 */
export async function commit({ scm, window }: SourceControlUi, control?: SourceControl): Promise<void> {
  if (control && !control.commit) return;
  const controls = committable(scm.sourceControls);
  control ??= controls.length > 1 ? await pickControl(controls, window) : controls[0];
  if (!control) return;
  if (control.busy) {
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
  if (message !== undefined) control.commit?.(message.trim());
}

/** The one of several `controls` the user picks (undefined: cancelled). */
async function pickControl(controls: readonly SourceControl[], window: SourceControlUi['window']): Promise<SourceControl | undefined> {
  return (await window.showQuickPick(controls.map((each) => ({ label: `Save to ${each.label}…`, control: each })), { title: 'Save', placeHolder: 'Where to save' }))?.control;
}

/** The source controls the user may commit to (those with `commit`). */
export function committable(controls: readonly SourceControl[]): readonly SourceControl[] {
  return controls.filter((control) => control.commit);
}

/** What committing needs of the extension API: the source controls, and the window to ask (and say it is busy). */
export interface SourceControlUi {
  readonly scm: Pick<Scm, 'sourceControls'>;
  readonly window: Pick<WindowApi, 'showInputBox' | 'showQuickPick' | 'showInformationMessage'>;
}

/** The title bar's button for the registered source controls: "Save to GitLab…" ("Saving to GitLab…" meanwhile). */
export function commitTitle(controls: readonly SourceControl[]): string {
  if (controls.length !== 1) return 'Save…';
  const [control] = controls;
  return control.busy ? `Saving to ${control.label}…` : `Save to ${control.label}…`;
}

/**
 * The source controls' save status (their `statusBarItems`), one button each, in registration order, for the title
 * bar; a click commits to the source control of the entry (`onCommit`).
 */
export class SourceControlStatus {
  /** The entries, for the title bar. */
  readonly element: HTMLElement;

  constructor(
    private readonly doc: Document,
    private readonly onCommit: (control: SourceControl) => void,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'zwf-source-control__status';
  }

  /** Shows the entries of `controls`, reusing the buttons there are (so a focused one stays focused). */
  show(controls: readonly SourceControl[]): void {
    const entries = controls.flatMap((control) => (control.statusBarItems ?? []).map((command) => ({ control, command })));
    const buttons = [...this.element.children] as HTMLButtonElement[];
    for (const button of buttons.slice(entries.length)) button.remove();
    entries.forEach(({ control, command }, index) => {
      const button = buttons[index] ?? this.element.appendChild(this.#button());
      button.textContent = command.title;
      button.title = command.tooltip ?? '';
      button.classList.toggle('zwf-source-control__entry--warning', command.backgroundColor === 'warning');
      button.onclick = () => this.onCommit(control);
    });
  }

  #button(): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'zwf-source-control__entry';
    return button;
  }
}

/** The source controls' resource states as file decorations (badges such as M, A, D), also on closed folders. */
export function resourceDecorations(scm: Pick<Scm, 'sourceControls'>, onDidChange: Event<void>): FileDecorationProvider {
  return {
    provideFileDecoration: (path) =>
      scm.sourceControls.flatMap((control) =>
        (control.resourceStates ?? []).flatMap((state): FileDecoration[] => (state.path === path && state.decorations ? [{ ...state.decorations, propagate: true }] : [])),
      ),
    onDidChangeFileDecorations: (listener) => onDidChange(() => listener(undefined)),
  };
}
