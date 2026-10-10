// File links in Typst code: paths in #import / #include / image(..) / read(..) / data calls open their file
// (Mod+click, Alt+Enter, hover tooltip). Used by the Source view and the Visual view's raw boxes. See
// source-view.ts and ARCHITECTURE.md, "File links".
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, hoverTooltip, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { describeLink, type FileLinks, findPathReferences, pathReferenceAt } from '../../core/project/project';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** The modifier that turns a click on a path into "open", as people read it. */
const MOD_CLICK = MAC ? '⌘+click' : 'Ctrl+click';
const pathMark = Decoration.mark({ class: 'typst-source__path' });

/**
 * Makes the file paths in the code navigable, like IntelliJ: while the
 * modifier is held, a hovered path shows as a link; Mod+click or Alt+Enter on
 * one opens its file, and the hover tooltip offers "Open …" or, for a
 * missing Typst file, "Create …".
 */
export function fileLinks(links: FileLinks): Extension {
  return [
    pathDecorations,
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (event.button !== 0 || !isMod(event)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null || !follow(view.state, pos, links)) return false;
        event.preventDefault();
        return true;
      },
      keydown: (event, view) => trackMod(view, event),
      keyup: (event, view) => trackMod(view, event),
      mousemove: (event, view) => trackMod(view, event),
      blur: (_event, view) => trackMod(view, null),
    }),
    keymap.of([{ key: 'Alt-Enter', run: (view) => follow(view.state, view.state.selection.main.head, links) }]),
    hoverTooltip((view, pos) => {
      const reference = pathReferenceAt(view.state.doc.toString(), pos, syntaxTree(view.state));
      const dom = reference && linkInfo(view.dom.ownerDocument, links, reference.path);
      return dom ? { pos: reference.from, end: reference.to, above: true, create: () => ({ dom }) } : null;
    }),
  ];
}

/**
 * What a link to `reference` offers, as a small piece of DOM: an "Open …"
 * button (with the Mod+click hint, if `hint`), or "… is not in the project"
 * and, for a Typst file, a "Create …" button that shows why it was refused.
 * Null when the path leaves the project.
 */
export function linkInfo(doc: Document, links: FileLinks, reference: string, { hint = true } = {}): HTMLElement | null {
  const target = describeLink(links, reference);
  if (!target) return null;
  const info = doc.createElement('span');
  info.className = 'typst-file-link';
  if (target.exists) {
    info.append(button(doc, `Open ${target.name}`, () => links.open(target.path)));
    if (hint) info.append(note(doc, `(${MOD_CLICK} or Alt+Enter)`));
    return info;
  }
  info.append(note(doc, `${target.name} is not in the project`));
  if (target.creatable) {
    const error = note(doc, '');
    error.classList.add('typst-file-link__error');
    error.setAttribute('role', 'alert');
    info.append(button(doc, `Create ${target.name}`, async () => (error.textContent = (await links.create(target.path)) ?? '')), error);
  }
  return info;
}

/** Opens the existing file whose path holds `pos`; false when there is none. */
function follow(state: EditorState, pos: number, links: FileLinks): boolean {
  const reference = pathReferenceAt(state.doc.toString(), pos, syntaxTree(state));
  const target = reference && describeLink(links, reference.path);
  if (!target?.exists) return false;
  links.open(target.path);
  return true;
}

/** Underlines the paths in the visible part of the code. */
const pathDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = decorate(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    for (const reference of findPathReferences(text, { tree, from, to })) {
      if (reference.from < reference.to) builder.add(reference.from, reference.to, pathMark);
    }
  }
  return builder.finish();
}

function isMod(event: MouseEvent | KeyboardEvent): boolean {
  return MAC ? event.metaKey : event.ctrlKey;
}

/** `typst-source--mod` on the editor while the modifier is held: paths show the pointer. */
function trackMod(view: EditorView, event: MouseEvent | KeyboardEvent | null): boolean {
  view.dom.classList.toggle('typst-source--mod', event !== null && isMod(event));
  return false;
}

function button(doc: Document, label: string, onClick: () => void): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.className = 'typst-file-link__button';
  element.textContent = label;
  // Keep the editor's focus and selection; act on click.
  element.addEventListener('mousedown', (event) => event.preventDefault());
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return element;
}

function note(doc: Document, text: string): HTMLElement {
  const element = doc.createElement('span');
  element.className = 'typst-file-link__note';
  element.textContent = text;
  return element;
}
