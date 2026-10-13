// What a paste can go in as: Typst read from the clipboard, code as a code block, the text as plain characters, the
// HTML. See clipboard.ts.
import { escapeTypst } from '../prosemirror-typst/prosemirror-typst';

/** A way a paste can go in: its kind (VS Code's paste edit kinds), its name in the "Paste as" choice, its Typst. */
export interface PasteKind {
  /** `typst`, `typst.code` (a code block), `text.plain` (plain characters), `typst.html` (the HTML). */
  readonly kind: string;
  readonly title: string;
  /** The Typst it puts in; null: the HTML, read with the schema's HTML rules (ProseMirror's paste). */
  readonly typst: string | null;
}

/**
 * The ways the clipboard `data` can go in, the one it goes in as first: as plain characters after Mod+Shift+V
 * (`literal`); else as the Typst `readTypst` reads (a code block for code of another language); else, for other HTML,
 * as that HTML. The others follow in the order of `PasteKind.kind`'s list, without those that put in the same Typst
 * as one before (a line of prose without markup characters is Typst and text alike). As text, each line is a paragraph
 * (as ProseMirror pastes plain text). Empty: nothing to paste (files).
 */
export function pasteKinds(data: DataTransfer, literal: boolean): PasteKind[] {
  const own = data.getData(TYPST);
  const text = lines(own || data.getData('text/plain'));
  const read = readTypst(data);
  const html = own || literal ? '' : data.getData('text/html');
  const kinds: PasteKind[] = [
    ...(read !== null && read !== text ? [{ kind: 'typst.code', title: 'Code block', typst: read }] : []),
    ...(text ? [{ kind: 'typst', title: 'Typst', typst: text }, { kind: 'text.plain', title: 'Text', typst: escapeTypst(text.split(/\n+/).join('\n\n')) }] : []),
    ...(html ? [{ kind: 'typst.html', title: 'HTML', typst: null }] : []),
  ];
  const preferred = literal ? 'text.plain' : preferredKind(read, text, html);
  const ordered = [...kinds.filter(({ kind }) => kind === preferred), ...kinds.filter(({ kind }) => kind !== preferred)];
  return ordered.filter((each, i) => each.typst === null || !ordered.slice(0, i).some((before) => before.typst === each.typst));
}

/** The kind a paste goes in as, but for Mod+Shift+V: as Typst (or code) where `readTypst` reads it, else as HTML. */
function preferredKind(read: string | null, text: string, html: string): string {
  if (read !== null) return read === text ? 'typst' : 'typst.code';
  return html ? 'typst.html' : 'typst';
}

/**
 * The Typst source to paste from the clipboard `data`; null: nothing to read as Typst (HTML of a web page or a word
 * processor, for ProseMirror's paste and the schema's HTML rules). First match wins:
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
 * The language of `html` if all its text is code (see `pastedTypst`): a class `language-X`, `lang-X`,
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
