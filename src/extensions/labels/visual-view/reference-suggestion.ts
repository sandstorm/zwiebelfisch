// The @ suggestion list: typing `@` offers the project's labels; choosing one inserts a reference chip.
// See visual-view.ts.
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { describeLabel, labelChoices } from '../model/label-choices';
import { LABEL_CHAR } from '../model/reference-syntax';
import type { LabelInfo, ProjectLabels } from '../model/label-index';
import { insertReference } from './label-edits';

/** The `@query` being typed: from the `@` to the cursor. */
export interface ReferenceQuery {
  from: number;
  to: number;
  query: string;
}

/** `@` after the start of the text, a space or an opening bracket, then label characters up to the cursor. */
const TYPED_REFERENCE = new RegExp(`(?:^|[\\s([{\\u00a0])@(${LABEL_CHAR}*)$`, 'u');

/** The `@query` right before the cursor, if one is being typed in prose (not in code). */
function referenceQuery(state: EditorState): ReferenceQuery | null {
  const { selection, schema } = state;
  const $pos = selection.$from;
  if (!selection.empty || !$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;
  const before = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 80), $pos.parentOffset, undefined, '\ufffc');
  const match = TYPED_REFERENCE.exec(before);
  if (!match) return null;
  const from = $pos.pos - match[1].length - 1;
  if (state.doc.rangeHasMark(from, from + 1, schema.marks.code)) return null;
  return { from, to: $pos.pos, query: match[1] };
}

/** Typed after `@name` (a label's whole name), these make it a reference, too: `@intro ` like choosing `intro`. */
const ENDS_REFERENCE = /^[\s,;!?)\].:]$/;

interface SuggestionState {
  /** The `from` of a query closed with Escape: not offered again until another one is typed. */
  dismissed: number | null;
}

const key = new PluginKey<SuggestionState>('typstReferenceSuggestion');

/**
 * Typing `@` in the text opens a list of the project's labels below it,
 * filtered by what follows the `@` (`labelChoices`). Arrow keys move the
 * choice, Enter or Tab inserts the reference chip in place of `@query`, a
 * click does too, Escape closes the list (the text stays). Typing a space or
 * punctuation right after the whole name of a label (`@intro `) inserts the
 * chip as well.
 */
export function referenceSuggestion(labels: ProjectLabels): Plugin {
  const session = new Session(labels);
  return new Plugin<SuggestionState>({
    key,
    state: {
      init: () => ({ dismissed: null }),
      apply: (tr, value, _old, state) => {
        if (tr.getMeta(key) === 'dismiss') return { dismissed: referenceQuery(state)?.from ?? null };
        const dismissed = value.dismissed === null ? null : tr.mapping.map(value.dismissed);
        return { dismissed: referenceQuery(state)?.from === dismissed ? dismissed : null };
      },
    },
    props: {
      handleKeyDown: (view, event) => session.keyDown(view, event),
      handleTextInput: (view, from, to, text) => session.textInput(view, from, to, text),
    },
    view: (view) => {
      session.mount(view);
      return { update: (v) => session.update(v), destroy: () => session.destroy() };
    },
  });
}

/** The list while it is open: the query, the labels offered, the chosen one, and the popup showing them. */
class Session {
  private query: ReferenceQuery | null = null;
  private choices: LabelInfo[] = [];
  private chosen = 0;
  private popup: HTMLElement | null = null;

  constructor(private readonly labels: ProjectLabels) {}

  mount(view: EditorView): void {
    const container = view.dom.parentElement;
    if (!container) return;
    this.popup = container.appendChild(view.dom.ownerDocument.createElement('div'));
    this.popup.className = 'typst-ref-suggestions';
    this.popup.dataset.testid = 'typst-ref-suggestions';
    this.popup.setAttribute('role', 'listbox');
    this.popup.hidden = true;
    // a click must not move the editor's selection before it inserts
    this.popup.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const option = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
      if (option) this.choose(view, Number(option.dataset.index));
    });
  }

  update(view: EditorView): void {
    const query = openQuery(view.state);
    if (!sameQuery(query, this.query)) this.chosen = 0;
    this.query = query;
    this.choices = query ? labelChoices(this.labels.labels(), query.query) : [];
    this.render(view);
  }

  keyDown(view: EditorView, event: KeyboardEvent): boolean {
    if (!this.query || this.choices.length === 0) return false;
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (move) {
      this.chosen = (this.chosen + move + this.choices.length) % this.choices.length;
      this.render(view);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      this.choose(view, this.chosen);
    } else if (event.key === 'Escape') {
      view.dispatch(view.state.tr.setMeta(key, 'dismiss'));
    } else {
      return false;
    }
    return true;
  }

  /** `@name` + a space or punctuation, `name` a label's whole name: the chip, then what was typed. */
  textInput(view: EditorView, from: number, to: number, text: string): boolean {
    const query = referenceQuery(view.state);
    if (!query || from !== query.to || to !== from || !ENDS_REFERENCE.test(text)) return false;
    const names = this.labels.labels().map((l) => l.name);
    // `.` and `:` may go on with a longer name (`@fig` + `:` → `@fig:x`)
    if (!names.includes(query.query) || names.some((n) => n.startsWith(query.query + text))) return false;
    const tr = insertReference(view.state, query, query.query);
    view.dispatch(tr.insertText(text));
    return true;
  }

  destroy(): void {
    this.popup?.remove();
  }

  private choose(view: EditorView, index: number): void {
    const label = this.choices[index];
    if (!this.query || !label) return;
    view.dispatch(insertReference(view.state, this.query, label.name));
    view.focus();
  }

  private render(view: EditorView): void {
    const popup = this.popup;
    if (!popup) return;
    popup.hidden = !this.query || this.choices.length === 0;
    if (popup.hidden) return;
    popup.replaceChildren(...this.choices.map((label, index) => option(popup.ownerDocument, label, index, index === this.chosen)));
    place(popup, view, this.query!.from);
  }
}

/** The `@query` being typed, unless it was dismissed with Escape. */
function openQuery(state: EditorState): ReferenceQuery | null {
  const query = referenceQuery(state);
  return query && query.from !== key.getState(state)?.dismissed ? query : null;
}

function sameQuery(a: ReferenceQuery | null, b: ReferenceQuery | null): boolean {
  return a?.from === b?.from && a?.query === b?.query;
}

function option(doc: Document, label: LabelInfo, index: number, chosen: boolean): HTMLElement {
  const item = doc.createElement('div');
  item.className = 'typst-ref-suggestions__option';
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(chosen));
  item.dataset.index = String(index);
  const name = item.appendChild(doc.createElement('span'));
  name.className = 'typst-ref-suggestions__name';
  name.textContent = label.name;
  const hint = describeLabel(label);
  if (hint) item.append(Object.assign(doc.createElement('span'), { className: 'typst-ref-suggestions__hint', textContent: hint }));
  return item;
}

/** Puts the popup below the `@` at `pos`, inside its (positioned) container. */
function place(popup: HTMLElement, view: EditorView, pos: number): void {
  const container = popup.parentElement!;
  let coords: { left: number; bottom: number };
  try {
    coords = view.coordsAtPos(pos);
  } catch {
    return; // no layout (e.g. not shown): leave it where it was
  }
  const box = container.getBoundingClientRect();
  popup.style.left = `${coords.left - box.left + container.scrollLeft}px`;
  popup.style.top = `${coords.bottom - box.top + container.scrollTop + 2}px`;
}
