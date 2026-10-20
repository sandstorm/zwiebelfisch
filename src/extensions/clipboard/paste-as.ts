// See clipboard in clipboard.ts.
import type { SourceRange, TextChange } from '../../core/typst-document/typst-document';
import type { DocumentPasteEdit, Languages, TextDocument } from '../../hosts/languages/languages';
import type { WindowApi } from '../../hosts/window/window';

/**
 * A paste that went in as one of several kinds and may go in as another instead, until it closes (the next edit, the
 * selection moved away, Escape): what an editor's "Paste as" chip offers.
 */
export interface PasteChoice {
  /** The kinds it may go in as (`DocumentPasteEdit.kind`) with their names, first the one it first went in as. */
  readonly kinds: readonly { readonly kind: string; readonly title: string }[];
  /** The kind it went in as. */
  readonly kind: string;
  /** Puts it in as `kind` instead, in place of what it put in: undone in one step with the paste. */
  change(kind: string): void;
}

/** Where the editors' chips report their paste choices (`PasteAs`: a quick pick, and the command `editor.action.pasteAs`). */
export interface PasteChoices {
  /** `choice` opened: the paste just made may go in as another kind. */
  openPasteChoice(choice: PasteChoice): void;
  /** `choice` closed. */
  closePasteChoice(choice: PasteChoice): void;
  /** Asks which kind `choice` goes in as (its chip was clicked) and changes it to the one picked. */
  pickPasteKind(choice: PasteChoice): void;
}

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

/**
 * The paste edit providers of a text's language as both editors' copy and paste ask them (source-editor/,
 * visual-editor/), by priority (`languages.getDocumentPasteEditProviders`).
 */
export class PasteEdits {
  constructor(private readonly languages: Pick<Languages, 'getDocumentPasteEditProviders'>) {}

  /** On a copy or cut of `copied` from `document`: every provider adds to the clipboard `dataTransfer`. */
  prepareDocumentPaste(document: TextDocument, copied: string, dataTransfer: DataTransfer): void {
    for (const { provider } of this.languages.getDocumentPasteEditProviders(document.languageId)) provider.prepareDocumentPaste?.(document, copied, dataTransfer);
  }

  /**
   * The edits for a paste of the clipboard `dataTransfer` into `document` in place of `ranges`: of each provider that
   * reads a type the clipboard has, the edits of the kinds it declared. Unsorted by `yieldTo` (`sortPasteEdits`).
   */
  provideDocumentPasteEdits(document: TextDocument, ranges: readonly SourceRange[], dataTransfer: DataTransfer): DocumentPasteEdit[] {
    const types = [...dataTransfer.types];
    const has = (mime: string) => mime === '*/*' || types.some((type) => type === mime || (mime.endsWith('/*') && type.startsWith(mime.slice(0, -1))));
    return this.languages.getDocumentPasteEditProviders(document.languageId).flatMap(({ provider, metadata: { providedPasteEditKinds: kinds, pasteMimeTypes = ['*/*'] } }) => {
      if (kinds.length === 0 || !pasteMimeTypes.some(has)) return [];
      const edits = provider.provideDocumentPasteEdits?.(document, ranges, dataTransfer) ?? [];
      return edits.filter((edit) => kinds.some((kind) => containsKind(kind, edit.kind)));
    });
  }

  /**
   * `edit` as it goes into `document` in place of `ranges`: as every provider resolves it, each given the edit the ones
   * before left; additional edits that overlap the ranges or an earlier edit are left out.
   */
  resolveDocumentPasteEdit(edit: DocumentPasteEdit, document: TextDocument, ranges: readonly SourceRange[], dataTransfer: DataTransfer): DocumentPasteEdit {
    const additionalEdit: TextChange[] = [];
    const taken: SourceRange[] = [...ranges];
    const accept = (changes: readonly TextChange[] = []) => {
      for (const change of changes) {
        if (additionalEdit.includes(change) || taken.some((range) => conflicts(range, change))) continue;
        additionalEdit.push(change);
        taken.push(change);
      }
    };
    accept(edit.additionalEdit);
    let resolved: DocumentPasteEdit = { ...edit, additionalEdit: [...additionalEdit] };
    for (const { provider } of this.languages.getDocumentPasteEditProviders(document.languageId)) {
      const next = provider.resolveDocumentPasteEdit?.(resolved, document, ranges, dataTransfer);
      if (!next) continue;
      accept(next.additionalEdit);
      resolved = { ...next, additionalEdit: [...additionalEdit] };
    }
    return resolved;
  }
}

/**
 * `edits` in the order a paste offers them, the one it goes in as first: those of exactly a kind in `preferences`, in
 * their order; then each after those it yields to, else in the given order. An edit putting in the same text as one
 * before is left out; the plain text one (`text.plain`) takes the place of the first with its text, so a paste with
 * formatting always offers its plain text by that name.
 */
export function sortPasteEdits(edits: readonly DocumentPasteEdit[], preferences: readonly string[] = []): DocumentPasteEdit[] {
  const sorted = preferences.flatMap((kind) => edits.filter((edit) => edit.kind === kind));
  const rest = edits.filter((edit) => !sorted.includes(edit));
  while (rest.length > 0) {
    const yields = (edit: DocumentPasteEdit) => rest.some((other) => other !== edit && edit.yieldTo?.some((kind) => containsKind(kind, other.kind)));
    // yielding in a circle: the first
    const next = rest.find((edit) => !yields(edit)) ?? rest[0];
    sorted.push(next);
    rest.splice(rest.indexOf(next), 1);
  }
  const plain = sorted.find((edit) => edit.kind === 'text.plain');
  return sorted
    .filter((edit, i) => sorted.findIndex((other) => other.insertText === edit.insertText) === i)
    .map((edit) => (plain && edit.insertText === plain.insertText ? plain : edit));
}

/** Whether the paste edit kind `kind` is `other` or covers it (`typst` covers `typst.html`). */
function containsKind(kind: string, other: string): boolean {
  return other === kind || other.startsWith(`${kind}.`);
}

/** Whether changes of ranges `a` and `b` conflict: they share text, or an empty one lies inside the other (not at its ends). */
function conflicts(a: SourceRange, b: SourceRange): boolean {
  return (a.from < b.to && b.from < a.to) || (a.from === a.to && b.from < a.from && a.from < b.to) || (b.from === b.to && a.from < b.from && b.from < a.to);
}
