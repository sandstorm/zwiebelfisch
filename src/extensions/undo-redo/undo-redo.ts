import type { Extension } from '../../hosts/workbench/workbench';
import { registerChainButton, svg, type ChainButton } from '../../hosts/visual-editor/visual-editor';

/**
 * The Undo and Redo buttons of the Visual editor's toolbar, in its `1_history` group (the commands `undoRedo.undo`
 * and `undoRedo.redo`): they undo and redo through the editor's own history (⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z), disabled while
 * there is nothing to undo or redo.
 *
 * Without this extension the toolbar has no such buttons; the keys still work.
 */
export function undoRedo(): Extension {
  return {
    id: 'undo-redo',
    activate(context) {
      context.subscriptions.push(...BUTTONS.map((button) => registerChainButton(context, 'visualEditor/toolbar', button)));
    },
  };
}

const ICONS = {
  undo: svg('<path d="M9 15 4 10l5-5"/><path d="M4 10h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 15 5-5-5-5"/><path d="M20 10H9a5 5 0 0 0 0 10h3"/>'),
};

const BUTTONS: ChainButton[] = [
  { command: 'undoRedo.undo', title: 'Undo', keybinding: 'Mod+Z', icon: ICONS.undo, group: '1_history', order: 10, chain: (c) => c.undo() },
  { command: 'undoRedo.redo', title: 'Redo', keybinding: 'Mod+Shift+Z', icon: ICONS.redo, group: '1_history', order: 20, chain: (c) => c.redo() },
];
