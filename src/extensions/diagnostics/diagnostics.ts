import type { TypstDiagnostic } from '../../core/typst-engine/typst-engine';
import { SOURCE_EDITOR } from '../../hosts/source-editor/source-editor';
import type { Extension } from '../../hosts/workbench/workbench';
import css from './diagnostics.css?inline';
import { DiagnosticCollection } from './model/model';
import { summarizeDiagnostics } from './model/diagnostics-summary';
import { lint } from './source-editor/source-editor';
import { diagnosticHighlight } from './visual-editor/visual-editor';
import { DiagnosticsStatus } from './workbench/workbench';

/**
 * Compile errors and warnings where the user looks:
 * - underlined in the Source editors, with the message on hover
 * - highlighted in the Visual editors, with the message as tooltip
 * - counted in the status bar, with the list behind it
 *
 * The status counts the Typst file shown last, also while an image is shown. Clicking the status or a message opens
 * the file in the Source editor at the range.
 */
export function diagnostics(): Extension {
  return {
    id: 'diagnostics',
    activate({ project, window, workbench, sourceEditor, visualEditor, preview, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      const collection = new DiagnosticCollection();
      const status = new DiagnosticsStatus(workbench.ownerDocument, (target) => {
        if (project.document(target.path)) workbench.open(target.path, { selection: target, viewType: SOURCE_EDITOR });
      });
      /** The Typst file shown last: whose diagnostics the status counts. */
      let lastSource = project.main;
      /** The newest compilation's (null before the first). */
      let latest: readonly TypstDiagnostic[] | null = null;
      const show = () => {
        if (latest) status.show(summarizeDiagnostics(latest, lastSource));
      };
      const compiled = (diagnostics: readonly TypstDiagnostic[]) => {
        latest = diagnostics;
        for (const path of project.paths()) {
          const document = project.document(path);
          if (document) collection.set(document, diagnostics.filter((d) => d.path === path));
        }
        show();
      };
      subscriptions.push(
        sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, lint(collection)),
        visualEditor.registerHighlights('diagnostics', {
          provideHighlights: (document) => collection.get(document).map(diagnosticHighlight),
          onDidChangeHighlights: collection.onDidChange,
        }),
        window.registerStatusBarItem(status.element, { alignment: 'left', priority: 100 }),
        status,
        window.onDidChangeActiveFile((path) => {
          if (project.document(path)) lastSource = path;
          show();
        }),
        project.onDidChangeFile((change) => {
          const before = lastSource;
          if (change.kind === 'rename' && change.from === lastSource) lastSource = change.path;
          else if (!project.has(lastSource)) lastSource = project.main;
          if (lastSource !== before) show();
        }),
        preview.onDidChangeDiagnostics(compiled),
      );
    },
  };
}
