// DiagnosticsStatus: the status bar's error / warning count and the list behind it. Entry of features/diagnostics/.
// See ARCHITECTURE.md, "Diagnostics in the widget".
import type { Diagnostic } from '../../core/typst-engine/typst-engine';
import { describeDiagnostic } from '../source-view/source-view';
import { inProject, type DiagnosticTarget, type DiagnosticsSummary } from './diagnostics-summary';

export { summarizeDiagnostics } from './diagnostics-summary';

/**
 * The compact compile status of the widget: "✓ compiled" or "2 errors".
 * Clicking it jumps to the summary's target; hovering or focusing it shows the
 * messages of the shown file (each jumps to its range). Diagnostics of other files
 * (which the shown editor cannot mark) are listed next to it, and those in
 * project files jump there when clicked.
 */
export class DiagnosticsStatus {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly list: HTMLUListElement;
  private readonly details: HTMLUListElement;
  private target: DiagnosticsSummary['target'] = null;

  constructor(
    parent: HTMLElement,
    private readonly onJump: (target: DiagnosticTarget) => void,
  ) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'typst-status';
    this.root.dataset.testid = 'typst-status';
    this.button = doc.createElement('button');
    this.button.type = 'button';
    this.button.className = 'typst-status__summary';
    this.button.textContent = 'compiling…';
    this.button.addEventListener('click', () => {
      if (this.target) onJump(this.target);
    });
    this.details = doc.createElement('ul');
    this.details.className = 'typst-status__details';
    this.details.hidden = true;
    // The details open on hover/focus of this wrapper, so the pointer can move into them.
    const summary = doc.createElement('span');
    summary.className = 'typst-status__hover';
    summary.append(this.button, this.details);
    this.list = doc.createElement('ul');
    this.list.className = 'typst-status__elsewhere';
    this.root.append(summary, this.list);
    parent.append(this.root);
  }

  show(summary: DiagnosticsSummary): void {
    this.target = summary.target;
    this.root.dataset.severity = summary.severity;
    this.button.textContent = summary.label;
    this.button.disabled = summary.target === null;
    this.list.replaceChildren(...summary.elsewhere.map((d) => this.item(d)));
    this.details.replaceChildren(...summary.inFile.map((d) => this.detail(d)));
    this.details.hidden = summary.inFile.length === 0;
  }

  destroy(): void {
    this.root.remove();
  }

  private detail(diagnostic: Diagnostic): HTMLLIElement {
    const doc = this.root.ownerDocument;
    const item = doc.createElement('li');
    item.dataset.severity = diagnostic.severity;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'typst-status__detail';
    button.textContent = describeDiagnostic(diagnostic);
    const { path, from, to } = diagnostic;
    button.addEventListener('click', () => this.onJump({ path: path!, from, to }));
    item.append(button);
    return item;
  }

  private item(diagnostic: Diagnostic): HTMLLIElement {
    const doc = this.root.ownerDocument;
    const item = doc.createElement('li');
    item.dataset.severity = diagnostic.severity;
    const text = `${diagnostic.path ?? '(no file)'}: ${diagnostic.message}`;
    const { path, from, to } = diagnostic;
    if (!inProject(path)) {
      item.textContent = text;
      return item;
    }
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'typst-status__open';
    button.textContent = text;
    button.addEventListener('click', () => this.onJump({ path, from, to }));
    item.append(button);
    return item;
  }
}
