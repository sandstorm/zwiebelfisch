// The language a Typst text is written in, from its set rules. See spellcheck in ../spellcheck.ts.
import type { SyntaxNode } from '@lezer/common';
import { decodeString, namedArgument, syntaxTree } from '../../../core/typst-syntax/typst-syntax';

/**
 * The language tag (BCP 47, as HTML's `lang` takes it) of the first `set text(lang: ..)` rule in `text`, with the
 * region of the same rule if it sets one: `#set text(lang: "de", region: "AT")` → `de-AT`. Null without such a rule,
 * or when its values are no plain codes (a variable, a computed string).
 */
export function textLanguage(text: string): string | null {
  // most texts set no language: no parse for them
  if (!/\blang\s*:/.test(text)) return null;
  let found: string | null | undefined;
  syntaxTree(text).iterate({
    enter: (node) => {
      if (found !== undefined) return false;
      if (node.name !== 'SetRule') return;
      const target = node.node.getChild('Ident');
      if (!target || text.slice(target.from, target.to) !== 'text') return;
      const lang = stringArgument(node.node, 'lang', text);
      if (lang === undefined) return;
      const region = stringArgument(node.node, 'region', text);
      found = lang && LANG.test(lang) ? lang.toLowerCase() + (region && REGION.test(region) ? `-${region.toUpperCase()}` : '') : null;
    },
  });
  return found ?? null;
}

/** ISO 639 codes, as Typst's `lang`; ISO 3166-1 alpha-2, as its `region`. */
const LANG = /^[a-z]{2,3}$/i;
const REGION = /^[a-z]{2}$/i;

/** The string value of the named argument `name` of `rule`: undefined if it has none, null if it is no plain string. */
function stringArgument(rule: SyntaxNode, name: string, text: string): string | null | undefined {
  const value = namedArgument(rule, name, text);
  if (!value) return undefined;
  return value.name === 'Str' ? decodeString(text.slice(value.from, value.to)) : null;
}
