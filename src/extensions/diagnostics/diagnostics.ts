// The diagnostics extension: the compile errors and warnings underlined in the Source views (`lint`) and marked in
// the Visual views (highlights with the message as tooltip), and the status bar's error / warning count with the list behind it (DiagnosticsStatus). Entry of features/diagnostics/.
// See ARCHITECTURE.md, "Diagnostics in the widget".
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import type { Highlight } from '../../core/typst-document/typst-document';
import type { Diagnostic } from '../../core/typst-engine/typst-engine';
import { DiagnosticCollection, describeDiagnostic, lint, type SourceDiagnostic } from './source-view/source-view';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { inProject, summarizeDiagnostics, type DiagnosticTarget, type DiagnosticsSummary } from './diagnostics-summary';

export { summarizeDiagnostics } from './diagnostics-summary';

/**
 * The preview's diagnostics, each document's in a DiagnosticCollection its Source views underline (`lint`) and its
 * Visual views mark, and the
 * compile status in the status bar, for the Typst file shown last (while an image is shown, too). Clicking the
 * status, or a message, opens the file and reveals the range in the Source view.
 */
export function diagnostics(): TypstExtension {
  return {
    id: 'diagnostics',
    activate({ project, workbench, sourceView, visualView, preview, subscriptions }) {
      const collection = new DiagnosticCollection();
      const status = new DiagnosticsStatus(workbench.ownerDocument, (target) => {
        const path = ProjectPath.parse(target.path);
        if (path && project.document(path)) workbench.open(path, { selection: target, mode: 'source' });
      });
      /** The Typst file shown last: whose diagnostics the status counts. */
      let lastSource = project.main;
      /** The newest compilation's (null before the first). */
      let latest: readonly Diagnostic[] | null = null;
      const show = () => {
        if (latest) status.show(summarizeDiagnostics([...latest], lastSource));
      };
      const compiled = (diagnostics: readonly Diagnostic[]) => {
        latest = diagnostics;
        for (const path of project.paths()) {
          const document = project.document(path);
          if (document) collection.set(document, diagnostics.filter((d) => d.path === path));
        }
        show();
      };
      subscriptions.push(
        sourceView.registerExtension(lint(collection)),
        visualView.registerHighlights('diagnostics', {
          provideHighlights: (document) => collection.get(document).map(diagnosticHighlight),
          onDidChangeHighlights: collection.onDidChange,
        }),
        workbench.registerStatusBarItem(status.element),
        new Disposable(() => status.destroy()),
        workbench.onDidShowFile((path) => {
          if (project.document(path)) lastSource = path;
          show();
        }),
        new Disposable(project.onChange((change) => {
          const before = lastSource;
          if (change.kind === 'rename' && change.from === lastSource) lastSource = change.path;
          else if (!project.has(lastSource)) lastSource = project.main;
          if (lastSource !== before) show();
        })),
        preview.onDidChangeDiagnostics(compiled),
      );
    },
  };
}

/**
 * How the Visual view marks a diagnostic: its text highlighted, the message as tooltip. An empty range (e.g.
 * "expected expression" at a point) still marks one character.
 */
function diagnosticHighlight(diagnostic: SourceDiagnostic): Highlight {
  return {
    from: diagnostic.from,
    to: Math.max(diagnostic.to, diagnostic.from + 1),
    className: 'typst-diagnostic',
    attributes: { 'data-severity': diagnostic.severity, title: describeDiagnostic(diagnostic) },
  };
}

/**
 * The compact compile status of the widget: "✓ compiled" or "2 errors".
 * Clicking it jumps to the summary's target; hovering or focusing it shows the
 * messages of the shown file (each jumps to its range). Diagnostics of other files
 * (which the shown editor cannot mark) are listed next to it, and those in
 * project files jump there when clicked.
 */
export class DiagnosticsStatus {
  /** The status, for the host's status bar. */
  readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly list: HTMLUListElement;
  private readonly details: HTMLUListElement;
  private target: DiagnosticsSummary['target'] = null;

  constructor(
    doc: Document,
    private readonly onJump: (target: DiagnosticTarget) => void,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'typst-status';
    this.element.dataset.testid = 'typst-status';
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
    this.element.append(summary, this.list);
  }

  show(summary: DiagnosticsSummary): void {
    this.target = summary.target;
    this.element.dataset.severity = summary.severity;
    this.button.textContent = summary.label;
    this.button.disabled = summary.target === null;
    this.list.replaceChildren(...summary.elsewhere.map((d) => this.item(d)));
    this.details.replaceChildren(...summary.inFile.map((d) => this.detail(d)));
    this.details.hidden = summary.inFile.length === 0;
  }

  destroy(): void {
    this.element.remove();
  }

  private detail(diagnostic: Diagnostic): HTMLLIElement {
    const doc = this.element.ownerDocument;
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
    const doc = this.element.ownerDocument;
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
