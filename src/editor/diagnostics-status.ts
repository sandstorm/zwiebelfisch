import type { Diagnostic } from '../engine/engine';
import { inProject, type DiagnosticTarget, type DiagnosticsSummary } from './diagnostics-summary';

/**
 * The compact compile status of the widget: "✓ compiled" or "2 errors".
 * Clicking it jumps to the summary's target; diagnostics of other files
 * (which the shown editor cannot mark) are listed next to it, and those in
 * project files jump there when clicked.
 */
export class DiagnosticsStatus {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly list: HTMLUListElement;
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
    this.list = doc.createElement('ul');
    this.list.className = 'typst-status__elsewhere';
    this.root.append(this.button, this.list);
    parent.append(this.root);
  }

  show(summary: DiagnosticsSummary): void {
    this.target = summary.target;
    this.root.dataset.severity = summary.severity;
    this.button.textContent = summary.label;
    this.button.disabled = summary.target === null;
    this.list.replaceChildren(...summary.elsewhere.map((d) => this.item(d)));
  }

  destroy(): void {
    this.root.remove();
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
