// morphDocument: a page's new DOM applied to the shown one in place. See previewHtml in ../preview-html.ts.
import { HTML_ELEMENT_ATTRIBUTE } from '../../../core/typst-engine/typst-engine';

/**
 * Makes `target` (the shown document) look like `source` (the new page, parsed) by changing only what differs:
 * elements that stay keep their identity, so the scroll position, a loaded image and a style sheet stay too. Children
 * are matched in order; an element marked with `HTML_ELEMENT_ATTRIBUTE` is matched to the one with the same mark, so a
 * paragraph inserted before others moves nothing after it.
 */
export function morphDocument(target: Document, source: Document): void {
  morphAttributes(target.documentElement, source.documentElement);
  morphChildren(target.head, source.head);
  morphChildren(target.body, source.body);
  morphAttributes(target.body, source.body);
}

function morphChildren(target: Node, source: Node): void {
  const doc = target.ownerDocument!;
  let next = target.firstChild;
  for (const wanted of [...source.childNodes]) {
    const match = next && same(next, wanted) ? next : findKeyed(next, wanted);
    if (match) {
      if (match !== next) target.insertBefore(match, next);
      morphNode(match, wanted);
      next = match.nextSibling;
    } else target.insertBefore(doc.importNode(wanted, true), next);
  }
  while (next) {
    const after: ChildNode | null = next.nextSibling;
    next.remove();
    next = after;
  }
}

function morphNode(target: Node, source: Node): void {
  if (target.nodeType !== Node.ELEMENT_NODE) {
    if (target.nodeValue !== source.nodeValue) target.nodeValue = source.nodeValue;
    return;
  }
  morphAttributes(target as Element, source as Element);
  morphChildren(target, source);
}

function morphAttributes(target: Element, source: Element): void {
  for (const { name } of [...target.attributes]) if (!source.hasAttribute(name)) target.removeAttribute(name);
  for (const { name, value, namespaceURI } of source.attributes) {
    if (target.getAttribute(name) === value) continue;
    if (namespaceURI) target.setAttributeNS(namespaceURI, name, value);
    else target.setAttribute(name, value);
  }
}

/** Whether `target` can become `wanted` in place: the same kind of node, an element with the same tag and mark. */
function same(target: Node, wanted: Node): boolean {
  if (target.nodeType !== wanted.nodeType) return false;
  if (wanted.nodeType !== Node.ELEMENT_NODE) return true;
  const [a, b] = [target as Element, wanted as Element];
  return a.namespaceURI === b.namespaceURI && a.localName === b.localName && key(a) === key(b);
}

/** The later sibling (from `start` on) marked as `wanted` is; null if it has no mark or none is. */
function findKeyed(start: ChildNode | null, wanted: Node): ChildNode | null {
  const wantedKey = wanted.nodeType === Node.ELEMENT_NODE ? key(wanted as Element) : null;
  if (wantedKey === null) return null;
  for (let node = start; node; node = node.nextSibling) if (node.nodeType === Node.ELEMENT_NODE && same(node, wanted)) return node;
  return null;
}

function key(element: Element): string | null {
  return element.getAttribute(HTML_ELEMENT_ATTRIBUTE);
}
