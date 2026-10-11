// Typst numbering patterns, formatted the way Typst does, for heading numbers. See HeadingCounter in heading-numbering.ts.
/**
 * Typst numbering patterns (`"1."`, `"1.a)"`, `"I."`, …), applied as Typst
 * applies them (typst-library `NumberingPattern`): the pattern is a prefix,
 * counting symbols each with the text before it, and a suffix. Numbers beyond
 * the symbols repeat the last one, preceded by its own prefix (or, if that is
 * empty, the suffix).
 *
 * Implemented systems: `1`, `a`/`A` (Latin letters), `i`/`I` (Roman), `*`
 * (symbols) and `①` (circled). A pattern using any other of Typst's counting
 * symbols gets no formatter, rather than a wrong one.
 */
export function numberingFormatter(pattern: string): ((numbers: readonly number[]) => string) | null {
  const parsed = parse(pattern);
  if (!parsed) return null;
  const { pieces, suffix } = parsed;
  return (numbers) => {
    let text = '';
    numbers.forEach((n, i) => {
      const [prefix, system] = pieces[Math.min(i, pieces.length - 1)];
      text += i < pieces.length || prefix ? prefix : suffix;
      text += system(n) ?? String(n);
    });
    return text + suffix;
  };
}

function parse(pattern: string): { pieces: [string, NumeralSystem][]; suffix: string } | null {
  const pieces: [string, NumeralSystem][] = [];
  let pending = '';
  for (const char of pattern) {
    if (UNSUPPORTED.has(char)) return null;
    const system = SYSTEMS[char];
    if (system) {
      pieces.push([pending, system]);
      pending = '';
    } else {
      pending += char;
    }
  }
  return pieces.length > 0 ? { pieces, suffix: pending } : null;
}

/** Represents a number in a numeral system; null where the system cannot (Typst then falls back to Arabic). */
type NumeralSystem = (n: number) => string | null;

/** Typst's other counting symbols (Greek, Hebrew, CJK, kana, Hangul, Indic, …). */
const UNSUPPORTED = new Set(Array.from('⓵αΑաԱא一壹あいアイㄱ가١أ۱१༡১ক'));

const SYSTEMS: Record<string, NumeralSystem> = {
  '1': (n) => String(n),
  a: (n) => latin(n)?.toLowerCase() ?? null,
  A: latin,
  i: (n) => roman(n).toLowerCase(),
  I: roman,
  '*': (n) => (n > 0 ? SYMBOLS[(n - 1) % SYMBOLS.length].repeat(Math.floor((n - 1) / SYMBOLS.length) + 1) : null),
  '①': (n) => CIRCLED[n] ?? null,
};

/** Bijective base 26: A … Z, AA, AB, …; no zero. */
function latin(n: number): string | null {
  if (n <= 0) return null;
  let text = '';
  for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) text = String.fromCharCode(65 + ((rest - 1) % 26)) + text;
  return text;
}

/** Roman numerals; zero is N, as in Typst. */
function roman(n: number): string {
  if (n === 0) return 'N';
  let text = '';
  let rest = n;
  for (const [value, letters] of ROMAN) {
    for (; rest >= value; rest -= value) text += letters;
  }
  return text;
}

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

const SYMBOLS = ['*', '†', '‡', '§', '¶', '‖'];
const CIRCLED = Array.from('⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿');
