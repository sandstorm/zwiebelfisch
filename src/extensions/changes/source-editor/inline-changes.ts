// The changes since the baseline, drawn in a CodeMirror. See changes in ../changes.ts.
import { getOriginalDoc, originalDocChangeEffect, unifiedMergeView } from '@codemirror/merge';
import { ChangeSet, Compartment, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type { ChangesState } from '../baseline';

/**
 * What the CodeMirror's text changed since `original()` (nothing while that is undefined), in `@codemirror/merge`'s
 * unified view: changed lines tinted, new text underlined, deleted lines read-only in red above where they were, a
 * bar in the gutter. The text stays editable; the marks follow each edit. Brought up to date a moment after
 * `onDidChange` (never inside another update).
 *
 * Used by: the changes extension, for the Source editors and the text files' editors.
 */
export function inlineChanges(changes: ChangesState): Extension {
  const compartment = new Compartment();
  const initial = changes.original();
  return [
    compartment.of(initial === undefined ? [] : merged(initial)),
    ViewPlugin.define((view) => {
      let shown = initial;
      let destroyed = false;
      const refresh = () => {
        if (destroyed) return;
        const original = changes.original();
        if (original === shown) return;
        if (original === undefined || shown === undefined) {
          view.dispatch({ effects: compartment.reconfigure(original === undefined ? [] : merged(original)) });
        } else {
          const length = getOriginalDoc(view.state).length;
          view.dispatch({ effects: originalDocChangeEffect(view.state, ChangeSet.of({ from: 0, to: length, insert: original }, length)) });
        }
        shown = original;
      };
      const subscription = changes.onDidChange(() => queueMicrotask(refresh));
      return {
        destroy() {
          destroyed = true;
          subscription.dispose();
        },
      };
    }),
  ];
}

function merged(original: string): Extension {
  return [
    EditorView.editorAttributes.of({ class: 'zwf-changes-inline' }),
    unifiedMergeView({ original, mergeControls: false, highlightChanges: true, gutter: true }),
  ];
}
