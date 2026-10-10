// Tests for dark-theme.ts.
import { describe, expect, it } from 'vitest';
import { darkThemeVariables } from './dark-theme';

const variables = darkThemeVariables((token) => `<${token}>`);

describe('darkThemeVariables', () => {
  it('makes the grid canvas of the widget tokens: cells, grid lines, headers, default text', () => {
    expect(variables).toMatchObject({
      '--palette-common-white': '<bg>',
      '--palette-sheet-grid-color': '<divider>',
      '--palette-sheet-header-background': '<subtle>',
      '--palette-sheet-header-text-color': '<muted>',
      '--palette-sheet-header-border-color': '<border>',
      '--palette-sheet-default-text-color': '<text>',
    });
  });

  it('turns the grey ladder around: light backgrounds become dark ones, dark text light', () => {
    expect(variables['--palette-common-black']).toBe('<text>');
    expect(variables['--palette-grey-50']).toBe('<hover>');
    expect(variables['--palette-grey-300']).toBe('<border>');
    expect(variables['--palette-grey-900']).toBe('<text>');
  });

  it("keeps IronCalc's accent and status colors, and mixes the editing tint into the background", () => {
    for (const kind of ['primary', 'secondary', 'error', 'warning', 'info', 'success']) {
      expect(Object.keys(variables).filter((name) => name.startsWith(`--palette-${kind}-`))).toEqual([]);
    }
    expect(variables).not.toHaveProperty('--palette-sheet-outline-color');
    expect(variables['--palette-sheet-outline-editing-color']).toBe(
      'color-mix(in srgb, var(--palette-sheet-outline-color) 35%, <bg>)',
    );
  });

  it('names only variables IronCalc has, all colors', () => {
    for (const [name, value] of Object.entries(variables)) {
      expect(name).toMatch(/^--palette-(common|grey|sheet)-/);
      expect(value).toMatch(/<[a-z0-9-]+>/);
    }
  });
});
