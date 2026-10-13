// The editors' own ways a paste of Typst can go in. See clipboard.ts.
import type { DocumentPasteEdit, DocumentPasteEditProvider } from '../languages/languages';
import { escapeTypst } from '../prosemirror-typst/prosemirror-typst';

/**
 * The ways a paste of text into Typst can go in, as the Visual and the Source editor offer them themselves: the
 * clipboard's text as Typst (`typst`); code of another language as a code block of it (`typst.code`, first); the text
 * as plain characters, escaped, a paragraph per line (`text.plain`, last). As Typst, it is the text `readTypst` reads,
 * first unless the clipboard has other HTML (a web page's), whose kind (`typst.html`) it yields to.
 */
class TypstPasteEditProvider implements DocumentPasteEditProvider {
  /** Reads the clipboard `data` alone. */
  provideDocumentPasteEdits(_document: unknown, _ranges: unknown, data: DataTransfer): DocumentPasteEdit[] {
    const text = lines(data.getData(TYPST) || data.getData('text/plain'));
    if (!text) return [];
    const read = readTypst(data);
    return [
      ...(read !== null && read !== text ? [{ kind: 'typst.code', title: 'Code block', insertText: read }] : []),
      { kind: 'typst', title: 'Typst', insertText: text, yieldTo: read === null ? ['typst.code', 'typst.html'] : ['typst.code'] },
      { kind: 'text.plain', title: 'Plain text', insertText: escapeTypst(text.split(/\n+/).join('\n\n')), yieldTo: ['typst'] },
    ];
  }
}

/** The editors' own paste edits of Typst. */
export const typstPasteEdits = new TypstPasteEditProvider();

/**
 * The Typst source to paste from the clipboard `data`; null: nothing to read as Typst (HTML of a web page or a word
 * processor, for the Visual editor's schema's HTML rules). First match wins:
 * - Typst a Visual editor copied (`text/x-typst`);
 * - text VS Code copied (`vscode-editor-data`), by its language mode: Typst and plain text as they are, another
 *   language as a code block of that language (```` ```python ````);
 * - plain text without HTML;
 * - text whose HTML is code only (every text in `<pre>`, `<code>`, an editor's line, or styled `white-space: pre` or
 *   in a monospace font: GitHub, documentation sites, a part of a highlighted block, web code editors): with no
 *   language or Typst's as it is, another language as a code block of that language.
 * Line breaks are `\n`.
 */
function readTypst(data: DataTransfer): string | null {
  const typst = data.getData(TYPST);
  if (typst) return lines(typst);
  const text = lines(data.getData('text/plain'));
  if (!text) return null;
  const mode = editorMode(data.getData('vscode-editor-data'));
  if (mode !== undefined) return asCode(text, mode);
  const html = data.getData('text/html');
  if (!html) return text;
  const language = codeLanguage(html);
  return language === undefined ? null : asCode(text, language);
}

/**
 * The type of the Typst a Visual editor copied, next to the same text as `text/plain`: what a paste reads as Typst
 * although HTML comes along (ProseMirror's HTML leaves out what is never rendered, as raw boxes' source).
 */
export const TYPST = 'text/x-typst';

/** `text` with its line breaks `\n`. */
function lines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** The language mode of VS Code's clipboard data (`{ "mode": "python", … }`); undefined: none. */
function editorMode(json: string): string | null | undefined {
  if (!json) return undefined;
  try {
    const mode: unknown = JSON.parse(json)?.mode;
    return typeof mode === 'string' ? mode : null;
  } catch {
    return undefined;
  }
}

/** Elements whose text is code: preformatted and code elements, CodeMirror's and Monaco's lines. */
const CODE_ELEMENTS = 'pre, code, kbd, samp, tt, .cm-line, .cm-content, .view-line, .view-lines';

/** A monospace font family (`ui-monospace, "SF Mono", Menlo, Consolas, monospace`; `"Fira Code"`, `Courier New`). */
const MONOSPACE = /monospace|\bmono\b|\bcode\b|courier|consolas|menlo|monaco/i;

/**
 * The language of `html` if all its text is code (see `readTypst`): a class `language-X`, `lang-X`,
 * `highlight-source-X` (GitHub) or an attribute `data-lang`, `data-language` on any element; null: code of no
 * language; undefined: not code only, or no text.
 */
function codeLanguage(html: string): string | null | undefined {
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  const texts = [...textNodes(body)].filter((node) => node.textContent!.trim() !== '');
  if (texts.length === 0 || !texts.every((node) => inCode(node.parentElement!))) return undefined;
  for (const element of [body, ...body.querySelectorAll('*')]) {
    const classes = [...element.classList].map((name) => /^(?:language|lang|highlight-(?:source|text))-([^-]+)/.exec(name)?.[1]);
    const language = element.getAttribute('data-lang') || element.getAttribute('data-language') || classes.find(Boolean);
    if (language) return language;
  }
  return null;
}

/** The text nodes in `root`. */
function* textNodes(root: HTMLElement): Generator<Node> {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) yield node;
}

/** Whether text in `element` is code: it or an element around it is a code element or styled as code. */
function inCode(element: HTMLElement): boolean {
  if (element.closest(CODE_ELEMENTS)) return true;
  for (let at: HTMLElement | null = element; at; at = at.parentElement) {
    if (at.style.whiteSpace === 'pre' || MONOSPACE.test(at.style.fontFamily)) return true;
  }
  return false;
}

/** Languages whose text is read as Typst: Typst's and plain text's. */
const TYPST_LANGUAGES = new Set(['typ', 'typst', 'plaintext', 'plain', 'text', 'txt', 'none']);

/** Language names (VS Code's modes) that Typst's code blocks know by another tag. */
const LANGUAGE_TAGS: Record<string, string> = { shellscript: 'sh', csharp: 'cs', typescriptreact: 'tsx', javascriptreact: 'jsx', 'objective-c': 'objc' };

/** `text`, code of `language`: Typst as it is; another language a code block of it, its fence longer than any backticks inside. */
function asCode(text: string, language: string | null): string {
  const name = language?.toLowerCase() ?? '';
  if (name === '' || TYPST_LANGUAGES.has(name)) return text;
  const tag = /^[\p{ID_Start}_][\p{ID_Continue}-]*/u.exec(LANGUAGE_TAGS[name] ?? name)?.[0] ?? '';
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${tag}\n${text.replace(/\n$/, '')}\n${fence}`;
}
