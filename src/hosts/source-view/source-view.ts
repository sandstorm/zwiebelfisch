// SourceViewHost: makes the Source views (CodeMirror bound to a TypstDocument) and applies what is contributed to
// them. Entry of hosts/source-view/. See ARCHITECTURE.md, "SourceView", and docs/2026_10_10_extensions-architecture.md.
// Why a host: the Source view itself only keeps text and selection in sync with its document (plus reveal).
// Everything else — the Typst language, colors, lint, document links, other users' carets — is a
// contribution, registered once and applied to every view made before or after, so a feature never tracks views.
import type { Extension } from '@codemirror/state';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { SourceViewContext, SourceViewExtension } from './contribution';
import { type Contributions, SourceView, type SourceViewOptions } from './view';

export type { SourceViewContext, SourceViewExtension } from './contribution';
export type { SourceView, SourceViewOptions } from './view';

/** The Source view's contribution points (what `ExtensionContext.sourceView` offers). */
export interface SourceViewContributions {
  /** Adds CodeMirror extensions to every Source view, the existing ones included, until disposed. */
  registerExtension(extension: SourceViewExtension): Disposable;
}

/** Makes Source views and keeps the registered contributions applied to all of them. */
export class SourceViewHost implements SourceViewContributions {
  private readonly extensions: SourceViewExtension[] = [];
  private readonly changed = new EventEmitter<void>();
  /** How a view gets its contributions: it asks for them now and again on every change. */
  private readonly contributions: Contributions = {
    extensionsFor: (view) => this.extensionsFor(view),
    onDidChange: this.changed.event,
  };

  registerExtension(extension: SourceViewExtension): Disposable {
    return this.register(this.extensions, extension);
  }

  /** A Source view of `document` in `parent`, with every contribution registered now or later. */
  createView(parent: HTMLElement, document: TypstDocument, options: SourceViewOptions = {}): SourceView {
    return new SourceView(parent, document, options, this.contributions);
  }

  private register<T>(list: T[], item: T): Disposable {
    list.push(item);
    this.changed.fire();
    return new Disposable(() => {
      list.splice(list.indexOf(item), 1);
      this.changed.fire();
    });
  }

  private extensionsFor(view: SourceViewContext): Extension {
    return this.extensions.map((extension) => (typeof extension === 'function' ? extension(view) : extension));
  }
}
