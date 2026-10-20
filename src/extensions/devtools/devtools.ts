import type { SidePanel } from '../../hosts/window/window';
import type { ExtensionContext, Extension } from '../../hosts/extension-host/extension-host';
import css from './devtools.css?inline';
import { describeValue } from './model/describe';
import { EngineMemoryLog } from './model/engine-memory';
import { ContributionLog } from './recording/contributions';
import { EventLog, subscribeToEvents } from './recording/event-log';
import { LoadedVisualEditors } from './visual-editor/loaded-visual-editors';
import { DevtoolsPanel, type DevtoolsTab } from './window/devtools-panel';
import type { ShownDocument } from './window/document-tab';

/**
 * `extensions` with their contributions recorded, followed by the devtools extension: a right side panel that shows
 * what the widget is made of while it runs. createEditor gives it the whole extension list, last. The panel shows:
 * - the Typst engine's memory and how it grew
 * - the shown file's ProseMirror document, each node with its source range
 * - every contribution, by extension or by contribution point
 * - the events as they fire, with their values
 *
 * The setting `devtools.enabled` (default true) shows or removes the panel. Contributions and memory are recorded from
 * activation on, also while the panel is hidden; events only while it is shown.
 */
export function devtools(extensions: readonly Extension[]): Extension[] {
  const contributions = new ContributionLog();
  return [...extensions, devtoolsExtension(contributions)].map((extension) => contributions.instrument(extension));
}

function devtoolsExtension(contributions: ContributionLog): Extension {
  return {
    id: 'devtools',
    contributes: { configuration: { properties: { 'devtools.enabled': ENABLED_SETTING } } },
    activate(context) {
      const { project, window, workspace, visualEditor, preview, subscriptions } = context;
      const events = new EventLog();
      const memory = new EngineMemoryLog();
      // told after activation only: editors are made once a file is shown
      const visualEditors = new LoadedVisualEditors(() => changed('document'));
      const shownDocument = (): ShownDocument => {
        const path = window.activeFile;
        const document = project.document(path);
        if (!document) return { kind: 'none', path, reason: 'Not Typst source: no document.' };
        const shown = visualEditors.rows(document);
        if (!shown) return { kind: 'none', path, reason: 'No Visual editor of this file yet: open the Visual tab.' };
        return { kind: 'rows', path, ...shown, source: (range) => describeValue(document.text.slice(range.from, range.to)) };
      };
      const side = window.registerSidePanel('devtools', { label: 'Devtools', icon: ICON, side: 'right', alignment: 'bottom' });
      const panel = new DevtoolsPanel(side.body, {
        contributions,
        events,
        memory,
        document: shownDocument,
        reveal: (selection) => window.showDocument(window.activeFile, { selection }),
      });
      const enabled = () => workspace.getConfiguration('devtools').get<boolean>('enabled', true);
      // drawn only while shown; when shown again, with all that was recorded meanwhile
      const changed = (part?: DevtoolsTab | 'memory') => {
        if (side.visible) panel.changed(part);
      };
      // one line, cheap: kept up to date while hidden, too
      const recordMemory = () => {
        memory.add(preview.engineMemory);
        panel.changed('memory');
      };
      if (preview.engineMemory > 0) recordMemory();
      side.setAvailable(enabled());
      subscriptions.push(
        window.registerStyleSheet(css),
        side,
        panel,
        visualEditor.registerTiptapExtension(visualEditors.tiptapExtension),
        window.onDidChangeActiveFile(() => changed('document')),
        contributions.onDidChange(() => changed('contributions')),
        side.onDidChangeVisibility(() => changed()),
        logWhileVisible(side, context, events, () => changed('events')),
        preview.onDidChangeEngineMemory(recordMemory),
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('devtools.enabled')) side.setAvailable(enabled());
        }),
      );
    },
  };
}

const ENABLED_SETTING = {
  type: 'boolean',
  default: true,
  description: 'Whether the devtools panel is on the right rail: the memory of the Typst engine, the shown document, every contribution, the events while it is shown.',
} as const;

const ICON =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4l-5.6 5.6a1.4 1.4 0 0 1-2-2l5.6-5.6a4 4 0 0 1 5.4-5.4L10 7l1 2 2 1z"/></svg>';

/** Logs every event of `context` into `events` while `side` is shown (`logged` after each), until disposed. */
function logWhileVisible(side: SidePanel, context: ExtensionContext, events: EventLog, logged: () => void): { dispose(): void } {
  let logging: { dispose(): void } | null = null;
  const apply = () => {
    logging?.dispose();
    logging = side.visible
      ? subscribeToEvents(context, (event, value) => {
          if (events.add(event, value)) logged();
        })
      : null;
  };
  apply();
  const visibility = side.onDidChangeVisibility(apply);
  return {
    dispose: () => {
      visibility.dispose();
      logging?.dispose();
    },
  };
}
