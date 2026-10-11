import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './devtools.css?inline';
import { describeValue } from './model/describe';
import { ContributionLog } from './recording/contributions';
import { EventLog, subscribeToEvents } from './recording/event-log';
import { LoadedVisualEditors } from './visual-editor/loaded-visual-editors';
import { DevtoolsPanel } from './workbench/devtools-panel';
import type { ShownDocument } from './workbench/document-tab';

/**
 * `extensions` with their contributions recorded, followed by the devtools extension, whose right side panel shows
 * what the widget is made of while it runs. Give it the whole list:
 * `createTypstEditor(host, { extensions: (builtins) => devtools(builtins) })`. Not a built-in: a host adds it (the demo
 * with `?devtools`).
 *
 * The panel has three tabs: the shown file's ProseMirror document, each node with its source range (what the Typst ↔
 * ProseMirror conversion made of the file); every contribution in its point's terms, by extension or by point; and the
 * events as they fire, with their values in full.
 *
 * It uses only what any extension gets, so it sees what an outside extension sees. That is why it wraps the list: an
 * extension sees only its own context, so the others' contributions are recorded by wrapping their `activate`
 * (ContributionLog in recording/contributions.ts), not by a listing in the hosts. See docs/30_reference/02_embedding.typ,
 * "Devtools".
 */
export function devtools(extensions: readonly TypstExtension[]): TypstExtension[] {
  const contributions = new ContributionLog();
  return [...extensions, devtoolsExtension(contributions)].map((extension) => contributions.instrument(extension));
}

function devtoolsExtension(contributions: ContributionLog): TypstExtension {
  return {
    id: 'devtools',
    activate(context) {
      const { project, window, workbench, visualEditor, subscriptions } = context;
      const events = new EventLog();
      // told after activation only: editors are made once a file is shown
      const visualEditors = new LoadedVisualEditors(() => panel.changed('document'));
      const shownDocument = (): ShownDocument => {
        const path = window.activeFile;
        const document = project.document(path);
        if (!document) return { kind: 'none', path, reason: 'Not Typst source: no document.' };
        const shown = visualEditors.rows(document);
        if (!shown) return { kind: 'none', path, reason: 'No Visual editor of this file yet: open the Visual tab.' };
        return { kind: 'rows', path, ...shown, source: (range) => describeValue(document.text.slice(range.from, range.to)) };
      };
      const side = workbench.registerSidePanel('devtools', { label: 'Devtools', icon: icon(workbench.ownerDocument), side: 'right', alignment: 'bottom' });
      const panel = new DevtoolsPanel(side.body, {
        contributions,
        events,
        document: shownDocument,
        reveal: (selection) => workbench.open(window.activeFile, { selection }),
      });
      subscriptions.push(
        workbench.registerStyleSheet(css),
        side,
        panel,
        visualEditor.registerTiptapExtension(visualEditors.tiptapExtension),
        window.onDidChangeActiveFile(() => panel.changed('document')),
        contributions.onDidChange(() => panel.changed('contributions')),
        subscribeToEvents(context, (event, value) => {
          if (events.add(event, value)) panel.changed('events');
        }),
      );
    },
  };
}

function icon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICON;
  return svg;
}

const ICON = '<path d="M14.7 6.3a4 4 0 0 1-5.4 5.4l-5.6 5.6a1.4 1.4 0 0 1-2-2l5.6-5.6a4 4 0 0 1 5.4-5.4L10 7l1 2 2 1z"/>';
