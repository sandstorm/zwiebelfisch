// "← Back to …" and "Forward to … →" above a supplementary file. See fileNavigation in ../file-navigation.ts.
import { ProjectPath } from '../../../core/paths/paths';

/**
 * One link bar above the shown file: back to the file the user came from (left), and forward again once they went back
 * (right); a click runs `go`, the tooltips name `keys` (as people read them). Hidden with nowhere to go.
 */
export class HistoryLinks {
  readonly element: HTMLElement;

  constructor(
    doc: Document,
    private readonly go: (direction: 'back' | 'forward') => void,
    private readonly keys: { readonly back?: string; readonly forward?: string },
  ) {
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
    const key = this.keys[direction];
    button.title = `${direction === 'back' ? 'Go back' : 'Go forward'} to ${name}${key ? ` (${key})` : ''}`;
    button.addEventListener('click', () => this.go(direction));
    return button;
  }
}
