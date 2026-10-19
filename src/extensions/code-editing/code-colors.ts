// codeColors: CodeMirror's look in the widget's color scheme, light or dark. See codeEditing in code-editing.ts.
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { isLightText } from '../../core/color-scheme/color-scheme';

/** A token of editor.css (`--zwf-syn-*`), with CodeMirror's default light color as fallback. */
const token = (name: string, light: string) => `var(--zwf-syn-${name}, ${light})`;

/** CodeMirror's default highlight style, its colors taken from the widget's tokens. */
export const highlightStyle = HighlightStyle.define([
  { tag: t.meta, color: token('meta', '#404740') },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, textDecoration: 'underline', fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.keyword, color: token('keyword', '#708') },
  { tag: [t.atom, t.bool, t.url, t.contentSeparator, t.labelName], color: token('atom', '#219') },
  { tag: [t.literal, t.inserted], color: token('literal', '#164') },
  { tag: [t.string, t.deleted], color: token('string', '#a11') },
  { tag: [t.regexp, t.escape, t.special(t.string)], color: token('string-2', '#e40') },
  { tag: t.definition(t.variableName), color: token('definition', '#00f') },
  { tag: t.local(t.variableName), color: token('local', '#30a') },
  { tag: [t.typeName, t.namespace], color: token('type', '#085') },
  { tag: t.className, color: token('class', '#167') },
  { tag: [t.special(t.variableName), t.macroName], color: token('macro', '#256') },
  { tag: t.definition(t.propertyName), color: token('property', '#00c') },
  { tag: t.comment, color: token('comment', '#940') },
  { tag: t.invalid, color: token('invalid', '#f00') },
]);

const scheme = new Compartment();

/**
 * Follows the scheme the editor is shown in (the page's color-scheme, the widget's `workbench.theme`, the OS):
 * light text around the editor turns on CodeMirror's dark theme (cursor, selection, gutters, panels,
 * tooltips). Checked when the editor is placed or resized, when the OS scheme changes, and when the widget's
 * `data-scheme` changes (the theme set anew).
 */
const follower = ViewPlugin.fromClass(
  class {
    private readonly media: MediaQueryList | null;
    private readonly observer: MutationObserver | null;
    private observed: Element | null = null;
    private pending = false;

    constructor(private readonly view: EditorView) {
      const window = view.dom.ownerDocument.defaultView;
      this.media = window?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
      this.media?.addEventListener('change', this.schedule);
      this.observer = window?.MutationObserver ? new window.MutationObserver(this.schedule) : null;
      this.schedule();
    }

    update(update: ViewUpdate): void {
      if (update.geometryChanged) this.schedule();
    }

    destroy(): void {
      this.media?.removeEventListener('change', this.schedule);
      this.observer?.disconnect();
    }

    /** Watches the widget's `data-scheme` once the editor is inside it (it is placed after it is made). */
    private observe(): void {
      const widget = this.view.dom.closest('[data-scheme]');
      if (!widget || widget === this.observed) return;
      this.observed = widget;
      this.observer?.disconnect();
      this.observer?.observe(widget, { attributes: true, attributeFilter: ['data-scheme'] });
    }

    /** Later: a view may not dispatch while it is being built or updated. */
    private readonly schedule = () => {
      if (this.pending) return;
      this.pending = true;
      queueMicrotask(() => {
        this.pending = false;
        this.check();
      });
    };

    private check(): void {
      if (!this.view.dom.isConnected) return;
      this.observe();
      const dark = isLightText(getComputedStyle(this.view.dom).color);
      if (dark === null || dark === this.view.state.facet(EditorView.darkTheme)) return;
      this.view.dispatch({ effects: scheme.reconfigure(EditorView.darkTheme.of(dark)) });
    }
  },
);

/** CodeMirror's light or dark theme, whichever the widget's color scheme around the editor is. */
const followColorScheme: Extension = [scheme.of([]), follower];

/**
 * CodeMirror's look in the widget, for every CodeMirror in it (Source editors, raw boxes, text files): CodeMirror's
 * default highlight style with its colors from the widget's `--zwf-syn-*` tokens, and CodeMirror's light or dark theme
 * (cursor, selection, gutters, panels, tooltips) following the widget's color scheme around the editor.
 */
export const codeColors: Extension = [syntaxHighlighting(highlightStyle), followColorScheme];
