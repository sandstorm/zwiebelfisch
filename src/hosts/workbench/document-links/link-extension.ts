// linkExtension: the document links of a CodeMirror editor's text (a Source view, a raw box's code), like IntelliJ:
// marked, Mod+click / Alt+Enter follow them, the hover offers "Open …" or what the link's command does. See
// document-links.ts.
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, hoverTooltip, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { ProjectPath } from '../../../core/paths/paths';
import type { DocumentLink, TextDocument } from '../workbench';

/** What an editor's links come from, and where following one goes. */
export interface LinkedText {
  /** The file the editor's text is in, now (null: none; the text has no links). */
  path(): ProjectPath | null;
  provideDocumentLinks(document: TextDocument): readonly DocumentLink[];
  resolveDocumentLink(link: DocumentLink): DocumentLink;
  /** Shows a link's target. */
  open(target: ProjectPath): void;
  /** Runs a link's command (`Workbench.executeCommand`). */
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** The modifier that turns a click on a link into "follow", as people read it. */
const MOD_CLICK = MAC ? '⌘+click' : 'Ctrl+click';
const linkMark = Decoration.mark({ class: 'typst-source__path' });

/**
 * Makes the links of the editor's text navigable: while the modifier is held, a hovered link shows as one; Mod+click
 * or Alt+Enter on it opens its target, and the hover tooltip offers "Open …", or says what the link's tooltip says
 * and offers its command (e.g. "Create chapter.typ").
 */
export function linkExtension(text: LinkedText): Extension {
  const links = ViewPlugin.fromClass(
    class {
      links: readonly DocumentLink[];
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.links = linksOf(view.state, text);
        this.decorations = decorate(this.links);
      }
      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        this.links = linksOf(update.state, text);
        this.decorations = decorate(this.links);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
  const linkAt = (view: EditorView, pos: number) => view.plugin(links)?.links.find((link) => link.range.from <= pos && pos <= link.range.to) ?? null;
  const follow = (view: EditorView, pos: number) => {
    const link = linkAt(view, pos);
    const target = link && text.resolveDocumentLink(link).target;
    if (target) text.open(target);
    return Boolean(target);
  };
  return [
    links,
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (event.button !== 0 || !isMod(event)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null || !follow(view, pos)) return false;
        event.preventDefault();
        return true;
      },
      keydown: (event, view) => trackMod(view, event),
      keyup: (event, view) => trackMod(view, event),
      mousemove: (event, view) => trackMod(view, event),
      blur: (_event, view) => trackMod(view, null),
    }),
    keymap.of([{ key: 'Alt-Enter', run: (view) => follow(view, view.state.selection.main.head) }]),
    hoverTooltip((view, pos) => {
      const link = linkAt(view, pos);
      const dom = link && linkInfo(view.dom.ownerDocument, text.resolveDocumentLink(link), text);
      return dom && link ? { pos: link.range.from, end: link.range.to, above: true, create: () => ({ dom }) } : null;
    }),
  ];
}

/**
 * What a (resolved) link offers, as a small piece of DOM: "Open …" for its target (with the Mod+click hint, if
 * `hint`), its tooltip, and a button for its command that shows the error's message when the command rejects. Null
 * when it offers nothing.
 */
export function linkInfo(
  doc: Document,
  link: DocumentLink,
  actions: Pick<LinkedText, 'open' | 'executeCommand'>,
  { hint = true } = {},
): HTMLElement | null {
  const { target, tooltip, command } = link;
  if (!target && !tooltip && !command) return null;
  const info = doc.createElement('span');
  info.className = 'typst-file-link';
  if (target) {
    info.append(button(doc, `Open ${ProjectPath.displayName(target)}`, () => actions.open(target)));
    if (hint) info.append(note(doc, `(${MOD_CLICK} or Alt+Enter)`));
  }
  if (tooltip) info.append(note(doc, tooltip));
  if (command) {
    const error = note(doc, '');
    error.classList.add('typst-file-link__error');
    error.setAttribute('role', 'alert');
    const run = () => {
      error.textContent = '';
      actions.executeCommand(command.command, ...(command.arguments ?? [])).catch((failure: unknown) => {
        error.textContent = failure instanceof Error ? failure.message : String(failure);
      });
    };
    info.append(button(doc, command.title, run), error);
  }
  return info;
}

function linksOf(state: EditorState, text: LinkedText): readonly DocumentLink[] {
  const path = text.path();
  return path ? text.provideDocumentLinks({ path, text: state.doc.toString() }).filter((link) => link.range.to <= state.doc.length) : [];
}

function decorate(links: readonly DocumentLink[]): DecorationSet {
  const ranges: Range<Decoration>[] = links.flatMap(({ range }) => (range.from < range.to ? [linkMark.range(range.from, range.to)] : []));
  return Decoration.set(ranges, true);
}

function isMod(event: MouseEvent | KeyboardEvent): boolean {
  return MAC ? event.metaKey : event.ctrlKey;
}

/** `typst-source--mod` on the editor while the modifier is held: links show the pointer. */
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
