// Tests for text-language.ts: the language tag of a Typst text's first `set text(lang: ..)` rule.
import { describe, expect, it } from 'vitest';
import { textLanguage } from './text-language';

describe('textLanguage', () => {
  it('reads lang, with the region of the same rule', () => {
    expect(textLanguage('#set text(lang: "de")\nHallo')).toBe('de');
    expect(textLanguage('#set page(a4)\n#set text(font: "X", lang: "de", region: "at")\nServus')).toBe('de-AT');
  });

  it('takes the first rule that sets lang, also inside a function or show rule', () => {
    expect(textLanguage('#set text(size: 9pt)\n#let t(body) = { set text(lang: "fr"); body }\n#set text(lang: "en")')).toBe('fr');
    expect(textLanguage('#show: set text(lang: "it")')).toBe('it');
  });

  it('is null without such a rule, in raw text, or for values that are no plain codes', () => {
    expect(textLanguage('Hello')).toBeNull();
    expect(textLanguage('#set text(size: 12pt)\nlang: here')).toBeNull();
    expect(textLanguage('`#set text(lang: "de")`')).toBeNull();
    expect(textLanguage('#set par(lang: "de")')).toBeNull();
    expect(textLanguage('#set text(lang: language)')).toBeNull();
    expect(textLanguage('#set text(lang: "german")')).toBeNull();
    expect(textLanguage('#set text(lang: "de", region: "Austria")')).toBe('de');
  });
});
