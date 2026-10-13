// See WorkbenchHost in ../workbench.ts.
import type { PasteChoice, PasteChoices } from '../../languages/languages';
import type { WindowApi } from '../../window/window';

/**
 * The paste choices of every editor (the Visual and Source editors' "Paste as" chips): which kind the open one goes in
 * as, asked in a quick pick, and the command `editor.action.pasteAs` (VS Code's), which changes the open one to the
 * kind it is given (`{ kind: 'text.plain' }`) or asks.
 */
export class PasteAs implements PasteChoices {
  /** The choice of the last paste, while it is open. */
  #open: PasteChoice | null = null;

  constructor(private readonly window: Pick<WindowApi, 'showQuickPick'>) {}

  openPasteChoice(choice: PasteChoice): void {
    this.#open = choice;
  }

  closePasteChoice(choice: PasteChoice): void {
    if (this.#open === choice) this.#open = null;
  }

  pickPasteKind(choice: PasteChoice): void {
    void this.#pick(choice);
  }

  /** `editor.action.pasteAs`: the open choice changed to `kind`, or asked which; false: none is open. */
  async pasteAs(args?: { kind?: string }): Promise<boolean> {
    const choice = this.#open;
    if (!choice) return false;
    if (typeof args?.kind === 'string') choice.change(args.kind);
    else await this.#pick(choice);
    return true;
  }

  async #pick(choice: PasteChoice): Promise<void> {
    const items = choice.kinds.map(({ kind, title }) => ({ label: title, description: kind === choice.kind ? 'pasted as' : undefined, kind }));
    const picked = await this.window.showQuickPick(items, { title: 'Paste as', placeHolder: 'What the paste goes in as' });
    if (picked) choice.change(picked.kind);
  }
}
