// The "Find in files" panel's Replace mode controls. See SearchPanel in search-panel.ts.
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import type { Refusal, Replacement } from '../model/replace';
import type { FileMatches } from '../model/search-results';
import type { TextQuery } from '../model/text-query';

/**
 * What Replace mode adds to the panel apart from the tree's buttons: the field with the replace text, and below the
 * results the outcome of the last replace ("Replaced 23 occurrences in 4 files", the matches that had changed
 * meanwhile, the files the host refused) with its Undo, one step for all files, until the next replace. A replace of
 * more than one file or `CONFIRM_ABOVE` matches is confirmed first.
 */
export class ReplaceControls {
  /** The replace field. */
  readonly field: HTMLElement;
  /** The outcome of the last replace, with Undo (hidden while there is none). */
  readonly notice: HTMLElement;
  readonly #changed = new EventEmitter<void>();
  /** Fires when the replace text changed (typed or set). */
  readonly onDidChange: Event<void> = this.#changed.event;
  readonly #input: HTMLInputElement;
  readonly #outcome: HTMLElement;
  readonly #undo: HTMLButtonElement;
  #last: Replacement | null = null;

  constructor(
    doc: Document,
    private readonly options: ReplaceControlsOptions,
  ) {
    this.field = element(doc, 'div', 'zwf-search__field zwf-search__replace');
    this.#input = this.field.appendChild(element(doc, 'input', 'zwf-search__input'));
    this.#input.type = 'text';
    this.#input.placeholder = 'Replace';
    this.#input.setAttribute('aria-label', 'Replace');
    this.#input.spellcheck = false;
    this.notice = element(doc, 'p', 'zwf-search__notice');
    this.notice.setAttribute('role', 'status');
    this.notice.hidden = true;
    this.#outcome = this.notice.appendChild(element(doc, 'span', 'zwf-search__outcome'));
    this.#undo = this.notice.appendChild(element(doc, 'button', 'zwf-search__button', 'Undo'));
    this.#undo.type = 'button';
    this.#input.addEventListener('input', () => this.#changed.fire());
    this.#undo.addEventListener('click', () => void this.#undoLast());
  }

  /** The replace text. */
  get text(): string {
    return this.#input.value;
  }

  set text(value: string) {
    this.#input.value = value;
    this.#changed.fire();
  }

  /**
   * Replaces the matches of `files()` (asked for once confirmed, so they are current) by what `query` makes of the
   * replace text; `confirm`: asks first when that is many (Replace all).
   */
  async replace(query: TextQuery, files: () => readonly FileMatches[], confirm = false): Promise<void> {
    if (confirm) {
      const listed = files();
      const count = listed.reduce((sum, file) => sum + file.matches.length, 0);
      const many = listed.length > 1 || count > CONFIRM_ABOVE;
      if (many && !(await this.options.confirm(`Replace ${plural(count, 'occurrence')} in ${plural(listed.length, 'file')}?`, 'Replace'))) return;
    }
    const text = this.text;
    this.#last?.dispose();
    const replacement = (this.#last = await this.options.replace(query, files(), text));
    const done = replacement.replaced ? `Replaced ${plural(replacement.replaced, 'occurrence')} in ${plural(replacement.files, 'file')}` : 'Nothing replaced';
    this.#show([done, replacement.skipped ? `${plural(replacement.skipped, 'match', 'matches')} changed meanwhile, not replaced` : '', ...refusals(replacement.refused)], !!replacement.replaced);
  }

  dispose(): void {
    this.#last?.dispose();
    this.#changed.dispose();
  }

  async #undoLast(): Promise<void> {
    const replacement = this.#last;
    if (!replacement) return;
    this.#last = null;
    const { restored, skipped, refused } = await replacement.undo();
    this.#show([`Restored ${plural(restored, 'occurrence')}`, skipped ? `${plural(skipped, 'replacement')} edited since, left as they are` : '', ...refusals(refused)], false);
  }

  /** Shows `parts` of an outcome (the empty ones left out), with Undo if `undoable`. */
  #show(parts: readonly string[], undoable: boolean): void {
    this.#outcome.textContent = parts.filter(Boolean).join(' · ');
    this.#undo.hidden = !undoable;
    this.notice.hidden = false;
  }
}

export interface ReplaceControlsOptions {
  /** Replaces the matches `files` lists (as `query` found them) with what `query` makes of `replace`. */
  replace(query: TextQuery, files: readonly FileMatches[], replace: string): Promise<Replacement>;
  /** Asks the user whether to go on with `message`, offering the button `action`: whether they chose it. */
  confirm(message: string, action: string): Promise<boolean>;
}

/** A replace of more matches than this (or of more than one file) is confirmed first. */
const CONFIRM_ABOVE = 50;

function refusals(refused: readonly Refusal[]): string[] {
  return refused.map(({ path, reason }) => `${ProjectPath.name(path)}: ${reason}`);
}

function plural(count: number, noun: string, nouns = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nouns}`;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, content?: string): HTMLElementTagNameMap[K] {
  const result = doc.createElement(tag);
  result.className = className;
  if (content !== undefined) result.textContent = content;
  return result;
}
