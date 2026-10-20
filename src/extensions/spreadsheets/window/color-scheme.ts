// followColorScheme: IronCalc's workbook UI in the widget's color scheme (dark: model/dark-theme.ts). Used by
// workbook.ts. See spreadsheets in ../spreadsheets.ts.
import { Disposable } from '../../../core/disposable/disposable';
import { type ColorToken, darkThemeVariables } from '../model/dark-theme';

/**
 * Keeps the theme variables of the workbook in `container` (IronCalc's `rootContainer`) in step with the widget's
 * `data-scheme`: while it is `dark`, the dark variables (`darkThemeVariables`) are set on the container, with the
 * widget's tokens resolved to plain colors; in light mode IronCalc's own stay. Applied at once (call it before the
 * workbook renders) and on every change of `data-scheme`, after which `onDidChange` runs: IronCalc's grid reads its
 * colors only when it is built. Outside a widget (no `data-scheme` above) nothing happens.
 */
export function followColorScheme(container: HTMLElement, onDidChange: () => void): Disposable {
  const host = container.closest<HTMLElement>('[data-scheme]');
  if (!host) return new Disposable(() => {});
  let scheme = host.dataset.scheme;
  /** The variables set on the container (empty: light, IronCalc's own). */
  let applied: string[] = [];
  const apply = () => {
    for (const name of applied) container.style.removeProperty(name);
    const variables = scheme === 'dark' ? darkThemeVariables(resolver(host)) : {};
    for (const [name, value] of Object.entries(variables)) container.style.setProperty(name, value);
    applied = Object.keys(variables);
  };
  apply();
  // ColorScheme sets the attribute on every OS change, also to the value it had
  const observer = new MutationObserver(() => {
    if (host.dataset.scheme === scheme) return;
    scheme = host.dataset.scheme;
    apply();
    onDidChange();
  });
  observer.observe(host, { attributes: true, attributeFilter: ['data-scheme'] });
  return new Disposable(() => {
    observer.disconnect();
    for (const name of applied) container.style.removeProperty(name);
  });
}

/**
 * Resolves the widget's tokens (`light-dark(..)` in its stylesheet) to the plain colors `host` shows them in, through
 * a hidden element that is there only while it resolves.
 */
function resolver(host: HTMLElement): (token: ColorToken) => string {
  return (token) => {
    const probe = host.ownerDocument.createElement('span');
    probe.hidden = true;
    probe.style.color = `var(--zwf-${token})`;
    host.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  };
}
