import type { Extension } from '../../hosts/workbench/workbench';
import { svg } from '../../hosts/visual-editor/visual-editor';

/**
 * The Undo and Redo buttons of the Visual editor's toolbar, in its `history` group: they undo and redo through the
 * editor's own history (⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z), disabled while there is nothing to undo or redo.
 *
 * Without this extension the toolbar has no such buttons; the keys still work.
 */
export function undoRedo(): Extension {
  return {
    id: 'undo-redo',
    activate({ visualEditor, subscriptions }) {
      subscriptions.push(
        visualEditor.registerToolbarItem({ group: 'history', order: 10, action: { label: 'Undo', shortcut: 'Mod+Z', icon: ICONS.undo, run: (c) => c.undo() } }),
        visualEditor.registerToolbarItem({ group: 'history', order: 20, action: { label: 'Redo', shortcut: 'Mod+Shift+Z', icon: ICONS.redo, run: (c) => c.redo() } }),
      );
    },
  };
}

const ICONS = {
  undo: svg('<path d="M9 15 4 10l5-5"/><path d="M4 10h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 15 5-5-5-5"/><path d="M20 10H9a5 5 0 0 0 0 10h3"/>'),
};
