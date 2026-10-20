// Web and mail addresses as document links. See markup in ../markup.ts.
import type { SyntaxNode } from '@lezer/common';
import { callArguments, calleeName, decodeString, syntaxTree, withHash } from '../../../core/typst-syntax/typst-syntax';
import { SourceRange } from '../../../core/typst-document/typst-document';
import type { DocumentLink, DocumentLinkProvider, TextDocument } from '../../../hosts/languages/languages';

/**
 * Bare URLs (`https://typst.app`) and `#link("https://…")[..]` / `#link("mailto:…")` as document links to their
 * address: following one opens it in a new tab ("Open https://typst.app"). A link to a label or a computed address is
 * none of this provider's.
 */
export const urlLinks: DocumentLinkProvider = {
  provideDocumentLinks(document: TextDocument): DocumentLink[] {
    const { text } = document;
    const links: DocumentLink[] = [];
    const cursor = syntaxTree(document).cursor();
    do {
      const link = linkOf(cursor.node, text);
      if (link) links.push(link);
    } while (cursor.next());
    return links;
  },
};

/** `node` as a link to a web or mail address: a bare URL, or a `link("…")` call with one (with its `#`); else null. */
function linkOf(node: SyntaxNode, text: string): DocumentLink | null {
  const address = node.name === 'Link' ? text.slice(node.from, node.to) : node.name === 'FuncCall' ? linkCallAddress(node, text) : null;
  const target = address === null ? null : external(address);
  return target && { range: node.name === 'Link' ? SourceRange.of(node) : withHash(node), target };
}

/** The address of `link("…")` (a plain string as its first argument), else null. */
function linkCallAddress(call: SyntaxNode, text: string): string | null {
  if (calleeName(call, text) !== 'link') return null;
  const [address] = callArguments(call);
  return address?.name === 'Str' ? decodeString(text.slice(address.from, address.to)) : null;
}

/** `address` as a URL, if it is a web or mail address. */
function external(address: string): URL | null {
  if (!/^(?:https?:\/\/|mailto:)/i.test(address)) return null;
  try {
    return new URL(address);
  } catch {
    return null;
  }
}
