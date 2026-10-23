// @vitest-environment jsdom
// Tests for banners.ts.
import { describe, expect, it } from 'vitest';
import { Banners } from './banners';

describe('Banners', () => {
  it('shows the banners before the tab bar, in registration order, hidden while there is none', () => {
    const area = document.createElement('div');
    const tabs = area.appendChild(document.createElement('div'));
    const banners = new Banners(area);
    const band = area.firstElementChild as HTMLElement;
    expect(band.className).toBe('zwf-editor__banners');
    expect(band.nextElementSibling).toBe(tabs);
    expect(band.hidden).toBe(true);

    const banner = (text: string) => Object.assign(document.createElement('div'), { textContent: text });
    const guest = banners.add(banner('Guest access'));
    const shared = banners.add(banner('Shared with guests'));
    expect(band.hidden).toBe(false);
    expect([...band.children].map((child) => child.textContent)).toEqual(['Guest access', 'Shared with guests']);
    guest.dispose();
    expect([...band.children].map((child) => child.textContent)).toEqual(['Shared with guests']);
    shared.dispose();
    expect(band.hidden).toBe(true);
    banners.dispose();
    expect(area.children).toHaveLength(1);
  });
});
