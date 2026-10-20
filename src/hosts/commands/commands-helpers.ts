// Stateless helpers of the commands host: keys as people read them. See commands.ts.
import type { Platform } from './commands';

/**
 * `key` (modifiers and a key, joined by `+`: a binding's `Mod+Alt+KeyM`, or a toolbar's `Mod+B`) as people read it:
 * on the Mac `⌘⌥M`, else `Ctrl+Alt+M`. `mac`: default as the browser says. For tooltips and menus naming a key.
 *
 * @helper Stateless: no registry, no per-widget state.
 */
export function keyLabel(key: string, mac = IS_MAC): string {
  const labels = mac ? MAC_LABELS : LABELS;
  // a modifier tapped twice (`Shift Shift`): each press by itself
  if (DOUBLE_TAP.test(key)) return key.split(' ').map((modifier) => labels[modifier]).join(' ');
  const parts = key.split('+');
  const name = parts.pop()!;
  const keyName = KEY_NAMES[name] ?? name.replace(/^(Key|Digit)(?=.)/, '');
  return [...parts.map((modifier) => labels[modifier] ?? modifier), keyName].join(mac ? '' : '+');
}

/** The system the browser runs on; `CommandsHost`'s default. */
export const PLATFORM: Platform = typeof navigator === 'undefined' ? 'linux' : /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : /Win/.test(navigator.platform) ? 'win' : 'linux';

const IS_MAC = PLATFORM === 'mac';

/** A modifier tapped twice (`Shift Shift`). */
export const DOUBLE_TAP = /^(Mod|Ctrl|Meta|Alt|Shift) \1$/;

/** The modifiers as people read them, outside the Mac and on it. */
export const LABELS: Record<string, string> = { Mod: 'Ctrl', Ctrl: 'Ctrl', Meta: 'Meta', Alt: 'Alt', Shift: 'Shift' };

const MAC_LABELS: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧' };

/** Keys (`KeyboardEvent.code`) whose name is not what people read; `KeyM` and `Digit1` lose their prefix. */
const KEY_NAMES: Record<string, string> = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`' };
