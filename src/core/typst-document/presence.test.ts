// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { caretElement, flagTextColor, initials } from './presence';

describe('presence helpers', () => {
  it('picks the flag text color with the better contrast', () => {
    expect(flagTextColor('#000080')).toBe('#ffffff');
    expect(flagTextColor('#dc322f')).toBe('#ffffff');
    expect(flagTextColor('#b58900')).toBe('#000000');
    expect(flagTextColor('#859900')).toBe('#000000');
    expect(flagTextColor('#ff0')).toBe('#000000');
    expect(flagTextColor('rebeccapurple')).toBe('#ffffff');
  });

  it('shortens names to at most two initials', () => {
    expect(initials('Ann')).toBe('A');
    expect(initials('ann lee')).toBe('AL');
    expect(initials('  Bob  van  Dam ')).toBe('BV');
    expect(initials('')).toBe('?');
  });

  it('builds a caret: a bar in the user color with a name flag', () => {
    const caret = caretElement(document, { name: 'Ann', color: '#b58900' });
    expect(caret.className).toBe('typst-remote-caret');
    expect(caret.dataset.user).toBe('Ann');
    expect(caret.style.getPropertyValue('--typst-remote-color')).toBe('#b58900');
    expect(caret.style.getPropertyValue('--typst-remote-text')).toBe('#000000');
    expect(caret.querySelector('.typst-remote-caret__flag')!.textContent).toBe('Ann');
  });
});
