// The account in the status bar. See collaboration in ../collaboration.ts.
import type { Account } from '../account';

/**
 * The status bar entry of the user's account on the collaboration server: "Sign in" while signed out, the user's
 * name while signed in (a click opens the account menu, with "Sign out"), nothing until the server answered.
 */
export class AccountStatus {
  /** The entry, for the status bar. */
  readonly element: HTMLButtonElement;

  constructor(
    doc: Document,
    private readonly account: Account,
    actions: { signIn(): void; showMenu(anchor: HTMLElement): void },
  ) {
    this.element = doc.createElement('button');
    this.element.type = 'button';
    this.element.className = 'typst-collaboration__account';
    this.element.onclick = () => (this.account.identity ? actions.showMenu(this.element) : actions.signIn());
    this.show();
  }

  /** Shows what the account knows now (call it when `account.onDidChange` fires). */
  show(): void {
    const identity = this.account.identity;
    this.element.hidden = identity === undefined;
    this.element.textContent = identity ? identity.name : 'Sign in';
    this.element.title = identity ? `Signed in as ${identity.name}${identity.email ? ` (${identity.email})` : ''}` : 'Sign in to edit together';
    this.element.setAttribute('aria-label', identity ? `Account: ${identity.name}` : 'Sign in');
  }
}
