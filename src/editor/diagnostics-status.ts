import type { Diagnostic } from '../engine/engine';
import type { DiagnosticsSummary } from './diagnostics-summary';

/**
 * The compact compile status of the widget: "✓ compiled" or "2 errors".
 * Clicking it jumps to the summary's target; diagnostics of other files
 * (which the editor cannot mark) are listed next to it.
 */
export class DiagnosticsStatus {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly list: HTMLUListElement;
  private target: DiagnosticsSummary['target'] = null;

  constructor(parent: HTMLElement, onJump: (from: number, to: number) => void) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'typst-status';
    this.root.dataset.testid = 'typst-status';
    this.button = doc.createElement('button');
    this.button.type = 'button';
    this.button.className = 'typst-status__summary';
    this.button.textContent = 'compiling…';
    this.button.addEventListener('click', () => {
      if (this.target) onJump(this.target.from, this.target.to);
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
    const item = this.root.ownerDocument.createElement('li');
    item.dataset.severity = diagnostic.severity;
    item.textContent = `${diagnostic.path ?? '(no file)'}: ${diagnostic.message}`;
    return item;
  }
}
