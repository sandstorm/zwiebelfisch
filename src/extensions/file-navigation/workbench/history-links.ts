// "← Back to …" and "Forward to … →" above a supplementary file. See fileNavigation in ../file-navigation.ts.
import { ProjectPath } from '../../../core/paths/paths';

/**
 * One link bar, above the shown file (`workbench.registerEditorFrame`): back to the file the user came
 * from (left), and forward again once they went back (right); a click runs `go`. Hidden with nowhere to go.
 */
export class HistoryLinks {
  readonly element: HTMLElement;

  constructor(doc: Document, private readonly go: (direction: 'back' | 'forward') => void) {
    this.element = doc.createElement('nav');
    this.element.className = 'zwf-file-navigation zwf-file-navigation--history';
    this.element.setAttribute('aria-label', 'Navigation history');
    this.element.hidden = true;
  }

  /** Shows the links to `back` and `forward` (null: none that way). */
  show(back: ProjectPath | null, forward: ProjectPath | null): void {
    this.element.hidden = back === null && forward === null;
    this.element.replaceChildren(...(back ? [this.#link(back, 'back')] : []), ...(forward ? [this.#link(forward, 'forward')] : []));
  }

  #link(path: ProjectPath, direction: 'back' | 'forward'): HTMLButtonElement {
    const name = ProjectPath.displayName(path);
    const button = this.element.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = `zwf-file-navigation__history zwf-file-navigation__history--${direction}`;
    button.textContent = direction === 'back' ? `← Back to ${name}` : `Forward to ${name} →`;
    button.title = direction === 'back' ? `Go back to ${name} (${KEYS.back})` : `Go forward to ${name} (${KEYS.forward})`;
    button.addEventListener('click', () => this.go(direction));
    return button;
  }
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** VS Code's Go Back / Go Forward keys, as `registerKeybinding` takes them. Not Ctrl+Minus outside the Mac: the browser's zoom. */
export const KEYBINDINGS = {
  back: MAC ? 'Ctrl+Minus' : 'Ctrl+Alt+Minus',
  forward: 'Ctrl+Shift+Minus',
} as const;

/** The same keys as the user reads them. */
const KEYS = MAC ? { back: '⌃-', forward: '⌃⇧-' } : { back: 'Ctrl+Alt+-', forward: 'Ctrl+Shift+-' };
