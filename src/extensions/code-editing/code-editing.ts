import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { EditorView, keymap } from '@codemirror/view';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { codeColors } from './code-colors';

/**
 * Editing in the Source editors: CodeMirror's basic setup (line numbers, undo history, brackets, search, completion),
 * Tab and Shift+Tab indenting the selected lines (Escape, then Tab moves the focus on, CodeMirror's), and wrapped
 * lines. And the look of every CodeMirror of the widget (Source editors, raw boxes, text files): `codeColors`.
 *
 * Without this extension a Source editor is a bare CodeMirror (the text still in sync with the document) in
 * CodeMirror's default light look.
 */
export function codeEditing(): Extension {
  return {
    id: 'code-editing',
    activate({ sourceEditor, subscriptions }) {
      subscriptions.push(
        sourceEditor.registerCodeMirrorExtension({}, codeColors),
        sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, [basicSetup, keymap.of([indentWithTab]), EditorView.lineWrapping]),
      );
    },
  };
}
