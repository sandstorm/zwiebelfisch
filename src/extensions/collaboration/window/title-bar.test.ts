// @vitest-environment jsdom
// Tests for title-bar.ts.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { ParticipantsView, roomTitle } from './title-bar';

describe('roomTitle', () => {
  it("names a GitLab room's project and branch, and its folder in a room of one folder", () => {
    const parts = (element: HTMLElement) => [...element.children].map((child) => [child.className, child.textContent]);
    expect(parts(roomTitle(document, { project: 'demo/report', branch: 'main', folder: null }))).toEqual([
      ['zwf-collaboration__project', 'demo/report'],
      ['zwf-collaboration__branch', 'main'],
    ]);
    const folder = roomTitle(document, { project: 'demo/report', branch: 'main', folder: ProjectPath.of('/chapters') });
    expect(parts(folder).at(-1)).toEqual(['zwf-collaboration__folder', '/chapters']);
    expect(folder.title).toBe('GitLab project demo/report, branch main, folder /chapters');
  });
});

describe('ParticipantsView', () => {
  const person = (id: string, name: string, color = '#268bd2') => ({ id, user: { name, color } });

  it("shows everyone else's initials in their color, one badge per name, at most five and +N; hidden while nobody is there", () => {
    const view = new ParticipantsView(document);
    const badges = () => [...view.element.children].map((badge) => [badge.textContent, (badge as HTMLElement).title]);
    expect(view.element.hidden).toBe(true);
    view.show([person('1', 'Ann Lee', '#b58900'), person('2', 'Bob'), person('3', 'Ann Lee', '#b58900')]);
    expect(view.element.hidden).toBe(false);
    expect(badges()).toEqual([['AL', 'Ann Lee'], ['B', 'Bob']]);
    expect((view.element.firstElementChild as HTMLElement).style.getPropertyValue('--zwf-remote-color')).toBe('#b58900');
    view.show(['Ann', 'Bob', 'Cleo', 'Dan', 'Eve', 'Fay', 'Gus'].map((name, index) => person(String(index), name)));
    expect(badges().slice(5)).toEqual([['+2', 'Fay, Gus']]);
    view.show([]);
    expect(view.element.hidden).toBe(true);
  });
});
