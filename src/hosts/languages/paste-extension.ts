// See Languages in languages.ts.
import { undo } from '@codemirror/commands';
import { EditorSelection, EditorState, StateEffect, StateField, type ChangeSpec, type Extension, type TransactionSpec } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, showTooltip, type Tooltip } from '@codemirror/view';
import type { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';
import { sortPasteEdits, type DocumentPasteEditProvider, type LanguagesHost, type PasteChoice, type PasteChoices, type TextDocument } from './languages';

/** The editor's own ways a paste can go in, and where its choice shows (see `pasteExtension`). */
export interface PasteOptions {
  /** The editor's own edits (the Source editor's: Typst, code, plain text), after the registered providers'. */
  readonly provider: DocumentPasteEditProvider;
  /** Kinds a paste goes in as first where offered (`sortPasteEdits`). */
  readonly preferences?: readonly string[];
  readonly choices: PasteChoices;
}

/**
 * Runs the paste edit providers around copy, cut and paste in a CodeMirror editor. A copy or cut adds to the clipboard
 * after CodeMirror's own handler (on the content, inside the outer element listened to) has set the text. A paste:
 * CodeMirror's transaction (`input.paste`) is replaced by one (a transaction filter) that puts in the first of the
 * edits of `options.provider` and the registered providers (`sortPasteEdits`; none: CodeMirror's text), as they
 * resolve it, with its additional edits, so one undo takes back all. A paste of different texts at several cursors (a
 * line each) stays as it is. `languageId`: the text's language; `path`: the file it is in, now (null: none, no
 * providers). Where there are other edits, its choice opens (`options.choices`): a chip above its end ("Paste as:
 * Typst ▾") whose click (or Mod+.) asks which kind; changing it undoes the paste and pastes that edit, so one undo
 * still takes all back. It closes on the next edit, a selection outside the pasted text, or Escape.
 */
export function pasteExtension(
  host: Pick<LanguagesHost, 'prepareDocumentPaste' | 'provideDocumentPasteEdits' | 'resolveDocumentPasteEdit'>,
  languageId: string,
  path: () => ProjectPath | null,
  options: PasteOptions,
): Extension {
  const documentOf = (state: EditorState): TextDocument | null => {
    const file = path();
    return file === null ? null : { path: file, languageId, text: state.doc.toString() };
  };
  // the clipboard of the paste being dispatched; null: no paste
  let pasted: DataTransfer | null = null;
  return [
    ViewPlugin.define((view) => {
      const copy = (event: ClipboardEvent) => {
        const data = event.clipboardData;
        const copied = data?.getData('text/plain') ?? '';
        const document = documentOf(view.state);
        if (data && document && copied !== '') host.prepareDocumentPaste(document, copied, data);
      };
      view.dom.addEventListener('copy', copy);
      view.dom.addEventListener('cut', copy);
      return {
        destroy: () => {
          view.dom.removeEventListener('copy', copy);
          view.dom.removeEventListener('cut', copy);
        },
      };
    }),
    EditorView.domEventHandlers({
      paste: (event) => {
        pasted = event.clipboardData;
        return false;
      },
    }),
    EditorState.transactionFilter.of((tr) => {
      const data = pasted;
      if (data === null || !tr.docChanged || !tr.isUserEvent('input.paste')) return tr;
      pasted = null;
      const document = documentOf(tr.startState);
      const ranges: SourceRange[] = [];
      const texts = new Set<string>();
      tr.changes.iterChangedRanges((from, to, fromB, toB) => {
        ranges.push(SourceRange.of({ from, to }));
        texts.add(tr.newDoc.sliceString(fromB, toB));
      });
      if (document === null || texts.size !== 1) return tr;
      const pastes = pastesOf(host, options, { document, ranges, text: [...texts][0], data });
      return pasteAs(tr.startState, { ranges, pastes, mainIndex: tr.selection?.mainIndex ?? 0 }, pastes[0]);
    }),
    pasteChoice(options.choices),
  ];
}

/**
 * The ways a paste of `text` (CodeMirror's) with the clipboard `data` into `document` in place of `ranges` goes in, the
 * first first: the edits of `options.provider` and `host`'s providers (none: `text` as it is), as they resolve them.
 */
function pastesOf(
  host: Pick<LanguagesHost, 'provideDocumentPasteEdits' | 'resolveDocumentPasteEdit'>,
  { provider, preferences }: PasteOptions,
  { document, ranges, text, data }: { document: TextDocument; ranges: readonly SourceRange[]; text: string; data: DataTransfer },
): Paste[] {
  const offered = [...host.provideDocumentPasteEdits(document, ranges, data), ...(provider.provideDocumentPasteEdits?.(document, ranges, data) ?? [])];
  const edits = offered.length > 0 ? sortPasteEdits(offered, preferences) : [{ kind: '', title: '', insertText: text }];
  return edits.map((edit) => {
    const { kind, title, insertText, additionalEdit = [] } = host.resolveDocumentPasteEdit(edit, document, ranges, data);
    return { kind, title, changes: [...additionalEdit, ...ranges.map(({ from, to }) => ({ from, to, insert: insertText }))] };
  });
}

/** A way a paste goes in: its kind and name, and its changes of the text before it. */
interface Paste {
  readonly kind: string;
  readonly title: string;
  readonly changes: readonly ChangeSpec[];
}

/** A paste: in place of which ranges, the ways it may go in, which cursor is the main one after it. */
interface Pasting {
  readonly ranges: readonly SourceRange[];
  readonly pastes: readonly Paste[];
  readonly mainIndex: number;
}

/** The open choice: the pasted text, and the way it went in as. */
interface Pasted extends Pasting {
  readonly from: number;
  readonly to: number;
  readonly paste: Paste;
}

/** Opens a choice (or, null, closes it). */
const setPasted = StateEffect.define<Pasted | null>();

/** `pasting` into `state` as `paste`, the cursors after it; opens the choice if there is one. */
function pasteAs(state: EditorState, pasting: Pasting, paste: Paste): TransactionSpec {
  const { ranges, pastes, mainIndex } = pasting;
  const changes = state.changes(paste.changes);
  const cursors = ranges.map(({ to }) => EditorSelection.cursor(changes.mapPos(to, 1)));
  const open = pastes.length > 1 && !changes.empty;
  const from = changes.mapPos(ranges[0].from, -1);
  const to = cursors.at(-1)!.head;
  return {
    changes,
    selection: EditorSelection.create(cursors, Math.min(mainIndex, cursors.length - 1)),
    userEvent: 'input.paste',
    scrollIntoView: true,
    effects: open ? setPasted.of({ ...pasting, from, to, paste }) : [],
  };
}

/** The open choice; closed by the next edit, a selection outside the pasted text, or Escape. */
const pastedField = StateField.define<Pasted | null>({
  create: () => null,
  update(pasted, tr) {
    for (const effect of tr.effects) if (effect.is(setPasted)) return effect.value;
    if (!pasted || tr.docChanged) return null;
    const { main } = tr.state.selection;
    return main.from < pasted.from || main.to > pasted.to ? null : pasted;
  },
});

/** The choice of an editor, told to `choices`, with its chip and keys. */
function pasteChoice(choices: PasteChoices): Extension {
  const reporter = ViewPlugin.define((view) => new ChoiceReporter(view, choices));
  const pick = (view: EditorView) => {
    const choice = view.plugin(reporter)?.choice;
    if (choice) choices.pickPasteKind(choice);
    return Boolean(choice);
  };
  const close = (view: EditorView) => {
    if (view.state.field(pastedField)) view.dispatch({ effects: setPasted.of(null) });
    return false;
  };
  return [
    pastedField,
    reporter,
    showTooltip.compute([pastedField], (state) => {
      const pasted = state.field(pastedField);
      return pasted && chipTooltip(pasted, pick);
    }),
    keymap.of([{ key: 'Mod-.', run: pick }, { key: 'Escape', run: close }]),
  ];
}

/** Keeps the `PasteChoice` of the open choice and tells `choices` when one opens or closes. */
class ChoiceReporter {
  /** The open choice as others see it; null: none. */
  choice: PasteChoice | null = null;
  private paste: Paste | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly choices: PasteChoices,
  ) {}

  update(): void {
    const pasted = this.view.state.field(pastedField);
    if (pasted?.paste === this.paste) return;
    if (this.choice) this.choices.closePasteChoice(this.choice);
    this.paste = pasted?.paste ?? null;
    this.choice = pasted ? this.choiceOf(pasted) : null;
    if (this.choice) this.choices.openPasteChoice(this.choice);
  }

  destroy(): void {
    if (this.choice) this.choices.closePasteChoice(this.choice);
  }

  private choiceOf(pasted: Pasted): PasteChoice {
    const { view } = this;
    const choice: PasteChoice = {
      kinds: pasted.pastes.map(({ kind, title }) => ({ kind, title })),
      kind: pasted.paste.kind,
      change: (kind) => {
        const paste = pasted.pastes.find((each) => each.kind === kind);
        // only while open: undone, its last change is the paste
        if (this.choice !== choice || !paste || paste === pasted.paste) return;
        undo(view);
        view.dispatch(pasteAs(view.state, pasted, paste));
        view.focus();
      },
    };
    return choice;
  }
}

/** The chip above the end of the paste: the kind it went in as ("Paste as: Typst ▾"); a click asks for another. */
function chipTooltip(pasted: Pasted, pick: (view: EditorView) => void): Tooltip {
  return {
    pos: pasted.to,
    above: true,
    create: (view) => {
      const dom = view.dom.ownerDocument.createElement('button');
      dom.type = 'button';
      dom.className = 'typst-paste-chip';
      dom.textContent = `Paste as: ${pasted.paste.title} ▾`;
      dom.setAttribute('aria-label', `Pasted as ${pasted.paste.title}: paste as…`);
      dom.title = `Pasted as ${pasted.paste.title}: paste as… (Mod+.)`;
      // the focus stays in the text
      dom.addEventListener('mousedown', (event) => event.preventDefault());
      dom.addEventListener('click', () => pick(view));
      return { dom };
    },
  };
}
