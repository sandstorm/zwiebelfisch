// See FollowableLink in languages.ts and linkExtension in link-extension.ts.

/** A link under the pointer, as `hoverLink` shows it. */
export interface HoveredLink {
  /** Which link: hovering the same one at the same `element` again changes nothing. */
  readonly link: object;
  /** The element under the pointer that shows the link: the hint goes above it (below, without room above). */
  readonly element: Element;
  /**
   * The element that takes the link look (`zwf-link--mod`) while the modifier is held and is described by the hint
   * (`aria-describedby`); default `element`. A CodeMirror editor owns its text's DOM: its link marks are not touched.
   */
  readonly marked?: Element;
  /** Whether following it goes somewhere: only then the modifier shows it as a link. */
  readonly followable: boolean;
  /** The hint: what following it does and how; null: none. */
  hint(): HTMLElement | null;
}

/**
 * The pointer moved (`event`): over `hovered`, or over no link (null; also when it left one). Every editor shows a
 * hovered link the same: after the hover delay its hint (`.zwf-link-hint`, role=tooltip), and while the modifier is
 * held (⌘ on Mac, else Ctrl) the link look. The hint stays while the pointer moves into it (it may offer buttons); a
 * click, a key other than a modifier, the wheel, a scroll that takes the link from under the pointer, or the link's
 * element leaving the page ends it (a scroll that leaves it there, e.g. a pane scrolling it into view as the pointer
 * arrives, places the hint again). One link per document is hovered: the first to see an event takes it, so a link
 * inside another's element (a raw box's code in the Visual editor) wins over the outer one.
 */
export function hoverLink(event: MouseEvent, hovered: HoveredLink | null): void {
  const doc = (event.target as Node | null)?.ownerDocument ?? document;
  let hover = hovers.get(doc);
  if (!hover) hovers.set(doc, (hover = new LinkHover(doc)));
  hover.move(event, hovered);
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Whether `event`'s modifiers make a click follow a link: ⌘ on Mac, else Ctrl. */
export function isMod(event: MouseEvent | KeyboardEvent): boolean {
  return MAC ? event.metaKey : event.ctrlKey;
}

/** How to follow a link, as people read it: the modifier that turns a click into "follow", or the key. */
export const FOLLOW_HINT = `(${MAC ? '⌘+click' : 'Ctrl+click'} or Alt+Enter)`;

/** How long the pointer rests on a link before its hint shows (as CodeMirror's hover tooltips). */
const HOVER_DELAY = 300;
/** How long the hint stays after the pointer left its link, to move into the hint. */
const LEAVE_GRACE = 200;

const hovers = new WeakMap<Document, LinkHover>();
let hints = 0;

/** The hovered link of one document, its hint and its link look. */
class LinkHover {
  #hovered: HoveredLink | null = null;
  #hint: HTMLElement | null = null;
  #showing: ReturnType<typeof setTimeout> | undefined;
  #leaving: ReturnType<typeof setTimeout> | undefined;
  /** The last event a link took: outer elements see it after. */
  #taken: Event | null = null;
  /** Where the pointer is over the hovered link (client coordinates). */
  #pointer = { x: 0, y: 0 };
  readonly #key = (event: Event) => (event instanceof KeyboardEvent && MODIFIERS.has(event.key) ? this.#showMod(event) : this.end());
  readonly #end = (event: Event) => {
    if (!(event.target instanceof Node && this.#hint?.contains(event.target))) this.end();
  };
  /** Something scrolled: the hover ends unless the link is still under the pointer (its hint then follows it). */
  readonly #scroll = (event: Event) => {
    const hovered = this.#hovered;
    const under = this.doc.elementFromPoint?.(this.#pointer.x, this.#pointer.y);
    if (!hovered || !under || !(hovered.element.contains(under) || this.#hint?.contains(under))) return this.#end(event);
    if (this.#hint) place(this.#hint, hovered.element.getBoundingClientRect());
  };
  /** The link's element went (its editor or box was closed, a remote edit): its hint goes as the pointer moves. */
  readonly #gone = () => {
    if (this.#hovered && !this.#hovered.element.isConnected) this.end();
  };

  constructor(private readonly doc: Document) {}

  move(event: MouseEvent, hovered: HoveredLink | null): void {
    if (event === this.#taken) return;
    if (hovered) {
      this.#taken = event;
      this.#pointer = { x: event.clientX, y: event.clientY };
    }
    const current = this.#hovered;
    if (hovered && current && hovered.link === current.link && hovered.element === current.element) {
      clearTimeout(this.#leaving);
      this.#showMod(event);
    } else if (hovered) {
      this.end();
      this.#start(hovered, event);
    } else if (current) {
      this.#leave();
    }
  }

  end(): void {
    clearTimeout(this.#showing);
    clearTimeout(this.#leaving);
    const hovered = this.#hovered;
    if (!hovered) return;
    const marked = hovered.marked ?? hovered.element;
    marked.classList.remove('zwf-link--mod');
    if (this.#hint) removeToken(marked, 'aria-describedby', this.#hint.id);
    this.#hint?.remove();
    this.#hint = null;
    this.#hovered = null;
    this.#listen(false);
  }

  #start(hovered: HoveredLink, event: MouseEvent): void {
    this.#hovered = hovered;
    this.#listen(true);
    this.#showMod(event);
    this.#showing = setTimeout(() => this.#show(hovered), HOVER_DELAY);
  }

  /** The pointer left the link: the hint goes, unless the pointer gets into it in time. */
  #leave(): void {
    if (!this.#hint) return this.end();
    clearTimeout(this.#leaving);
    this.#leaving = setTimeout(() => this.end(), LEAVE_GRACE);
  }

  #show(hovered: HoveredLink): void {
    const content = hovered.element.isConnected ? hovered.hint() : null;
    if (!content) return;
    const hint = this.doc.createElement('div');
    hint.className = 'zwf-link-hint';
    hint.id = `zwf-link-hint-${++hints}`;
    hint.setAttribute('role', 'tooltip');
    hint.append(content);
    hint.addEventListener('mouseenter', () => clearTimeout(this.#leaving));
    hint.addEventListener('mouseleave', () => this.#leave());
    (hovered.element.closest('[data-scheme]') ?? this.doc.body).append(hint);
    place(hint, hovered.element.getBoundingClientRect());
    addToken(hovered.marked ?? hovered.element, 'aria-describedby', hint.id);
    this.#hint = hint;
  }

  #showMod(event: MouseEvent | KeyboardEvent): void {
    const hovered = this.#hovered;
    if (hovered) (hovered.marked ?? hovered.element).classList.toggle('zwf-link--mod', hovered.followable && isMod(event));
  }

  /** While a link is hovered: the modifier pressed or let go (the keys go to the document), and what ends the hover. */
  #listen(on: boolean): void {
    const listeners: [string, (event: Event) => void][] = [
      ['keydown', this.#key],
      ['keyup', this.#key],
      ['mousedown', this.#end],
      ['scroll', this.#scroll],
      ['wheel', this.#end],
      ['mousemove', this.#gone],
    ];
    for (const [type, listener] of listeners) {
      if (on) this.doc.addEventListener(type, listener, true);
      else this.doc.removeEventListener(type, listener, true);
    }
  }
}

const MODIFIERS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'OS']);

/** Puts `hint` (fixed: no layout shifts) above `rect`, or below it without room above, inside the window's width. */
function place(hint: HTMLElement, rect: DOMRect): void {
  const own = hint.getBoundingClientRect();
  const width = hint.ownerDocument.documentElement.clientWidth || Infinity;
  const above = rect.top - own.height >= 0;
  hint.style.top = `${above ? rect.top - own.height : rect.bottom}px`;
  hint.style.left = `${Math.max(0, Math.min(rect.left, width - own.width))}px`;
}

function addToken(element: Element, attribute: string, token: string): void {
  const tokens = (element.getAttribute(attribute) ?? '').split(' ').filter(Boolean);
  element.setAttribute(attribute, [...tokens, token].join(' '));
}

function removeToken(element: Element, attribute: string, token: string): void {
  const tokens = (element.getAttribute(attribute) ?? '').split(' ').filter((t) => t && t !== token);
  if (tokens.length) element.setAttribute(attribute, tokens.join(' '));
  else element.removeAttribute(attribute);
}
