// HTML a word processor put on the clipboard, cleaned for the Visual editor's HTML rules.

/**
 * `html` as a web page would say it, if a word processor wrote it (Microsoft Word, Google Docs, LibreOffice; else as
 * it is): what only the word processor reads goes, what it says by its own means is said in HTML's.
 * - Word's lists, paragraphs styled `mso-list: l1 level2` after a marker glyph (`·`, `o`, `1.`), become `<ul>` and
 *   `<ol>` (numbered where the marker is a number or letter), nested by their level;
 * - Office's own elements (`<o:p>`) and Word's runs of spaces (`mso-spacerun`), Google Docs'
 *   `<b id="docs-internal-guid-…">` around all of it and the `<br>` between its blocks (an empty line) go; so do
 *   empty paragraphs (a `&nbsp;`, a `<br>`);
 * - text in a monospace font (`Courier New`, `Liberation Mono`) is code (`<code>`);
 * - a heading all of whose text is bold is not: the heading is (a word processor's heading style is bold).
 * Bold, italic, underline and strike in styles (`font-weight: 700`) the HTML rules read themselves.
 */
export function wordProcessorHtml(html: string): string {
  if (!WORD_PROCESSOR.test(html)) return html;
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  for (const clean of [withoutOwnMarkup, wordLists, withoutEmptyParagraphs, monospaceAsCode, headingsUnbold]) clean(body);
  return body.innerHTML;
}

/** Microsoft Office's namespace and styles, Google Docs' wrapper, LibreOffice's (OpenOffice's) generator. */
const WORD_PROCESSOR = /urn:schemas-microsoft-com:office|\bmso-|id="docs-internal-guid-|<meta\s+name="?generator"?\s+content="(?:LibreOffice|OpenOffice)/i;

/** A monospace font family (`"Courier New"`, `Consolas`, `Liberation Mono, monospace`). */
const MONOSPACE = /monospace|\bmono\b|courier|consolas|menlo|monaco/i;

/** Word's list paragraph: `mso-list: l0 level2 lfo1`, its list and level. */
const MSO_LIST = /mso-list:\s*(l\d+)\s+level(\d+)/i;

/** A list marker of a numbered list: `1.`, `a)`, `iv.`. */
const NUMBERED = /^\(?[\da-z]{1,4}[.)]$/i;

/** `body` without Office's own elements (`<o:p>`, `<v:shape>`), Word's space runs, Google Docs' wrapper and empty lines. */
function withoutOwnMarkup(body: HTMLElement): void {
  for (const element of body.querySelectorAll('*')) if (element.localName.includes(':')) element.remove();
  for (const wrapper of body.querySelectorAll('b[id^="docs-internal-guid-"]')) wrapper.replaceWith(...wrapper.childNodes);
  for (const space of body.querySelectorAll('span[style*="mso-spacerun"]')) space.replaceWith(' ');
  for (const br of body.querySelectorAll(':scope > br')) br.remove();
}

/**
 * Word's list paragraphs in `body` as lists: consecutive ones (nothing but white space between) of one list, each an
 * item of the list of its level, a deeper one in the item before it; its marker (the `mso-list: Ignore` text, behind
 * conditional comments) says whether the list is numbered.
 */
function wordLists(body: HTMLElement): void {
  for (const paragraph of body.querySelectorAll<HTMLElement>('p[style*="mso-list"]')) {
    const list = paragraph.isConnected ? listOf(paragraph) : null;
    if (list !== null) wordList(paragraph, list);
  }
}

/** The paragraphs of the Word list `list` from `first` on, as lists in its place. */
function wordList(first: Element, list: string): void {
  const open: OpenList[] = [];
  for (let at: Element | null = first, level = listLevel(at, list); at && level !== null; ) {
    const next = nextElement(at);
    listFor(open, at, level).append(listItem(at));
    at = next;
    level = next && listLevel(next, list);
  }
}

/** A list made of Word's list paragraphs, still open for items of its level. */
interface OpenList {
  readonly element: HTMLElement;
  readonly level: number;
}

/**
 * The list the list paragraph `at` of `level` goes into: the open one of that level, else a new one (numbered if its
 * marker is a number) in the item before, at the top in `at`'s place; deeper ones closed (out of `open`).
 */
function listFor(open: OpenList[], at: Element, level: number): HTMLElement {
  while (open.length > 0 && open[open.length - 1].level > level) open.pop();
  const marker = listMarker(at);
  const last = open.at(-1);
  if (last?.level === level) return last.element;
  const element = at.ownerDocument.createElement(NUMBERED.test(marker) ? 'ol' : 'ul');
  if (last) last.element.lastElementChild!.append(element);
  else at.before(element);
  open.push({ element, level });
  return element;
}

/** The Word list `paragraph` is an item of (`l0`); null: none. */
function listOf(paragraph: Element): string | null {
  return MSO_LIST.exec(paragraph.getAttribute('style') ?? '')?.[1] ?? null;
}

/** The level of `element` in the Word list `list` (1 at the top); null: no paragraph of that list. */
function listLevel(element: Element, list: string): number | null {
  const match = MSO_LIST.exec(element.getAttribute('style') ?? '');
  return element.localName === 'p' && match?.[1] === list ? Number(match[2]) : null;
}

/** The marker of a Word list paragraph (`·`, `1.`), removed from it. */
function listMarker(paragraph: Element): string {
  const markers = [...paragraph.querySelectorAll('[style*="mso-list"]')].filter((span) => /mso-list:\s*ignore/i.test(span.getAttribute('style')!));
  for (const marker of markers) marker.remove();
  return (markers[0]?.textContent ?? '').replace(/\s/g, '');
}

/** A list item of the content of `paragraph`, which goes. */
function listItem(paragraph: Element): HTMLLIElement {
  const document = paragraph.ownerDocument;
  const item = document.createElement('li');
  item.append(Object.assign(document.createElement('p'), { innerHTML: paragraph.innerHTML }));
  paragraph.remove();
  return item;
}

/** `body` without paragraphs of nothing but white space (a `&nbsp;`, a `<br>`). */
function withoutEmptyParagraphs(body: HTMLElement): void {
  for (const paragraph of body.querySelectorAll('p')) {
    if (!paragraph.textContent!.trim() && !paragraph.querySelector('img')) paragraph.remove();
  }
}

/** Text in `body` in a monospace font (a span's style, a `<font face>`) as `<code>`. */
function monospaceAsCode(body: HTMLElement): void {
  for (const element of body.querySelectorAll<HTMLElement>('span, font')) {
    const font = element.style.fontFamily || element.getAttribute('face') || '';
    if (MONOSPACE.test(font) && element.textContent!.trim() && !element.closest('pre, code')) {
      element.replaceWith(Object.assign(body.ownerDocument.createElement('code'), { textContent: element.textContent }));
    }
  }
}

/** The headings in `body` all of whose text is bold without bold. */
function headingsUnbold(body: HTMLElement): void {
  for (const heading of body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    if ([...textsIn(heading)].every((text) => isBold(text.parentElement!, heading))) unbold(heading);
  }
}

/** The element after `element`, past white space and comments (Word's conditional `<![endif]>`); null: other content. */
function nextElement(element: Element): Element | null {
  for (let node = element.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
    if (node.nodeType === Node.TEXT_NODE && node.textContent!.trim()) return null;
  }
  return null;
}

/** The text nodes in `root` with more than white space. */
function* textsIn(root: HTMLElement): Generator<Text> {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent!.trim()) yield node as Text;
}

/** A bold `font-weight` (`bold`, `bolder`, `600`–`900`). */
const BOLD_WEIGHT = /^(?:bold(?:er)?|[6-9]\d\d)$/;

/** Whether text in `element` (within `root`) is bold: the nearest element saying a weight says bold. */
function isBold(element: HTMLElement, root: HTMLElement): boolean {
  for (let at: HTMLElement | null = element; at && at !== root; at = at.parentElement) {
    const weight = at.style.fontWeight;
    if (weight) return BOLD_WEIGHT.test(weight);
    if (at.localName === 'b' || at.localName === 'strong') return true;
  }
  return false;
}

/** `root` without its bold: `<b>` and `<strong>` unwrapped, `font-weight` styles dropped. */
function unbold(root: HTMLElement): void {
  for (const element of root.querySelectorAll<HTMLElement>('b, strong')) element.replaceWith(...element.childNodes);
  for (const element of root.querySelectorAll<HTMLElement>('[style]')) element.style.removeProperty('font-weight');
}
