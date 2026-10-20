// darkThemeVariables: IronCalc's workbook UI in the dark, made from the widget's color tokens. Pure: no DOM. Used by
// ../window/color-scheme.ts while the widget is dark. See spreadsheets in ../spreadsheets.ts.

/**
 * IronCalc's theme variables (the custom properties `--palette-*` its CSS and its grid canvas read) for a dark
 * widget, from the widget's tokens as `color` resolves them. The canvas cannot resolve CSS, so `color` must give
 * plain colors (`rgb(..)`), not `light-dark(..)` or `var(..)`.
 *
 * Only the neutrals change: backgrounds, borders, text, the grid and its headers. IronCalc's own accent (the
 * orange selection), its status colors and the colors a file sets on cells stay as they are in light mode;
 * the light tint around a cell being edited is mixed into the background.
 */
export function darkThemeVariables(color: (token: ColorToken) => string): Record<`--palette-${string}`, string> {
  return {
    '--palette-common-white': color('bg'),
    '--palette-common-black': color('text'),
    // IronCalc's grey ladder runs from hover backgrounds (50) to headings (900)
    '--palette-grey-50': color('hover'),
    '--palette-grey-100': color('hover'),
    '--palette-grey-200': color('chip'),
    '--palette-grey-300': color('border'),
    '--palette-grey-400': color('faint'),
    '--palette-grey-500': color('muted-2'),
    '--palette-grey-600': color('muted'),
    '--palette-grey-700': color('text-2'),
    '--palette-grey-800': color('text-2'),
    '--palette-grey-900': color('text'),
    '--palette-grey-a100': color('hover'),
    '--palette-grey-a200': color('chip'),
    '--palette-grey-a400': color('faint'),
    '--palette-grey-a700': color('text-2'),
    '--palette-sheet-header-corner-background': color('subtle'),
    '--palette-sheet-header-background': color('subtle'),
    '--palette-sheet-header-text-color': color('muted'),
    '--palette-sheet-header-global-selector-color': color('control'),
    '--palette-sheet-header-selected-background': color('hover'),
    '--palette-sheet-header-full-selected-background': color('control'),
    '--palette-sheet-header-selected-color': color('text'),
    '--palette-sheet-header-border-color': color('border'),
    '--palette-sheet-grid-color': color('divider'),
    '--palette-sheet-grid-separator-color': color('border'),
    '--palette-sheet-default-text-color': color('text'),
    '--palette-sheet-outline-editing-color': `color-mix(in srgb, var(--palette-sheet-outline-color) 35%, ${color('bg')})`,
  };
}

/** The widget's color tokens (`--zwf-<name>`, editor.css) the dark workbook is made of. */
export type ColorToken =
  | 'bg'
  | 'subtle'
  | 'hover'
  | 'chip'
  | 'divider'
  | 'control'
  | 'border'
  | 'text'
  | 'text-2'
  | 'muted'
  | 'muted-2'
  | 'faint';
