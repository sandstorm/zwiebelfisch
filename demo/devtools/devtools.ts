// The devtools: a side panel showing what the widget is made of while it runs: the Typst ↔ ProseMirror projection
// of the shown file (each node with its source range), every contribution by extension, and the events as they
// fire. Built on the package's public API alone (src/index.ts), so it sees what any outside extension sees; the
// demo adds it with `?devtools`. Not part of the library. See docs/architecture/development.typ.
// Why it wraps the list: an extension sees only its own context, so the contributions of the others are recorded by
// wrapping their `activate` (model/contributions.ts), not by a listing in the hosts.
import type { TypstExtension } from '../../src';
import css from './devtools.css?inline';
import { ContributionLog } from './model/contributions';
import { describeValue } from './model/describe';
import { EventLog, subscribeToEvents } from './model/event-log';
import { ProjectionViews } from './visual-view/projection-views';
import { DevtoolsPanel, type ShownProjection } from './workbench/devtools-panel';

/**
 * `extensions` with their contributions recorded, followed by the devtools extension (`devtools`), whose side panel
 * shows them. Give it the whole list: `createTypstEditor(host, { extensions: (builtins) => devtools(builtins) })`.
 */
export function devtools(extensions: readonly TypstExtension[]): TypstExtension[] {
  const contributions = new ContributionLog();
  return [...extensions, devtoolsExtension(contributions)].map((extension) => contributions.instrument(extension));
}

const ICON = '<path d="M14.7 6.3a4 4 0 0 1-5.4 5.4l-5.6 5.6a1.4 1.4 0 0 1-2-2l5.6-5.6a4 4 0 0 1 5.4-5.4L10 7l1 2 2 1z"/>';

function devtoolsExtension(contributions: ContributionLog): TypstExtension {
  return {
    id: 'devtools',
    activate(context) {
      const { project, window, workbench, visualView, subscriptions } = context;
      const events = new EventLog();
      // told after activation only: views are made once a file is shown
      const views = new ProjectionViews(() => panel.changed('projection'));
      const projection = (): ShownProjection => {
        const path = window.activeFile;
        const document = project.document(path);
        if (!document) return { kind: 'none', path, reason: 'Not Typst source: no projection.' };
        const shown = views.rows(document);
        if (!shown) return { kind: 'none', path, reason: 'No Visual view of this file yet: open the Visual tab.' };
        return { kind: 'rows', path, ...shown, source: (range) => describeValue(document.text.slice(range.from, range.to)) };
      };
      const side = workbench.registerSidePanel('devtools', { label: 'Devtools', icon: icon(workbench.ownerDocument), order: 1000 });
      const panel = new DevtoolsPanel(side.body, {
        contributions,
        events,
        projection,
        reveal: (selection) => workbench.open(window.activeFile, { selection }),
      });
      subscriptions.push(
        workbench.registerStyleSheet(css),
        side,
        panel,
        visualView.registerTiptapExtension(views.tiptapExtension),
        window.onDidChangeActiveFile(() => panel.changed('projection')),
        subscribeToEvents(context, (event, value) => {
          events.add(event, value);
          panel.changed('events');
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
