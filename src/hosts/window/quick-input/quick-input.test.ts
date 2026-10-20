// @vitest-environment jsdom
// Tests for quick-input.ts: showInputBox, showQuickPick and createQuickPick.
import { afterEach, describe, expect, it } from 'vitest';
import { QuickPickItemKind } from '../window';
import { QuickInput } from './quick-input';

afterEach(() => document.body.replaceChildren());

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const button = host.appendChild(document.createElement('button'));
  const quickInput = new QuickInput(host);
  const box = () => host.querySelector<HTMLElement>('.zwf-quick-input');
  const key = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return { host, button, quickInput, box, key, type };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('showInputBox', () => {
  it('asks with title, prompt, value (selected) and placeholder, and resolves to the text on Enter', async () => {
    const { quickInput, box } = setup();
    const answer = quickInput.showInputBox({ title: 'Rename', prompt: 'New name', value: 'intro.typ', valueSelection: [0, 5], placeHolder: 'name' });
    const form = box() as HTMLFormElement;
    expect(form.getAttribute('aria-label')).toBe('Rename');
    const input = form.querySelector('input')!;
    expect(input.getAttribute('aria-label')).toBe('New name');
    expect([input.value, input.placeholder, input.selectionStart, input.selectionEnd]).toEqual(['intro.typ', 'name', 0, 5]);
    expect(document.activeElement).toBe(input);
    input.value = 'outro.typ';
    form.requestSubmit();
    expect(await answer).toBe('outro.typ');
    expect(box()).toBeNull();
  });

  it('shows what validateInput says while typing, and does not accept while it says something', async () => {
    const { quickInput, box, type } = setup();
    const answer = quickInput.showInputBox({ validateInput: async (value) => (value.includes('/') ? 'No slashes' : null) });
    const form = box() as HTMLFormElement;
    const input = form.querySelector('input')!;
    const message = form.querySelector('[role=alert]')!;
    type(input, 'a/b');
    await tick();
    expect(message.textContent).toBe('No slashes');
    form.requestSubmit();
    await tick();
    expect(box()).not.toBeNull();
    type(input, 'ab');
    await tick();
    expect(message.textContent).toBe('');
    form.requestSubmit();
    expect(await answer).toBe('ab');
  });

  it('resolves undefined on Escape and on a press elsewhere, and gives the focus back', async () => {
    const { button, quickInput, box, key } = setup();
    button.focus();
    const first = quickInput.showInputBox();
    key(box()!.querySelector('input')!, 'Escape');
    expect(await first).toBeUndefined();
    expect(document.activeElement).toBe(button);
    const second = quickInput.showInputBox();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(await second).toBeUndefined();
  });

  it("gives an editor its caret back with the focus (focusing it again would put the caret at its start, as Chromium does)", async () => {
    const { host, quickInput, box } = setup();
    const editable = host.appendChild(document.createElement('div'));
    editable.contentEditable = 'true';
    editable.tabIndex = 0; // focusable in jsdom
    editable.innerHTML = '<p>Results</p><p>The runs:</p>';
    const text = editable.lastChild!.firstChild!;
    const focus = editable.focus.bind(editable);
    editable.focus = () => {
      focus();
      document.getSelection()!.collapse(editable.firstChild!.firstChild!, 0);
    };
    editable.focus();
    document.getSelection()!.collapse(text, 9);
    const answer = quickInput.showInputBox();
    (box() as HTMLFormElement).requestSubmit();
    await answer;
    expect(document.activeElement).toBe(editable);
    expect([document.getSelection()!.anchorNode, document.getSelection()!.anchorOffset]).toEqual([text, 9]);
  });

  it('cancels the open box when another one opens', async () => {
    const { host, quickInput } = setup();
    const first = quickInput.showInputBox({ title: 'First' });
    void quickInput.showInputBox({ title: 'Second' });
    expect(await first).toBeUndefined();
    expect([...host.querySelectorAll('.zwf-quick-input')].map((box) => box.getAttribute('aria-label'))).toEqual(['Second']);
  });

  it('is placed below what the user pressed last', () => {
    const { host, button, quickInput, box } = setup();
    host.getBoundingClientRect = () => new DOMRect(10, 20, 600, 400);
    Object.defineProperties(host, { clientWidth: { value: 600 }, clientHeight: { value: 400 } });
    button.getBoundingClientRect = () => new DOMRect(110, 60, 40, 20);
    button.getClientRects = () => [button.getBoundingClientRect()] as unknown as DOMRectList;
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    void quickInput.showInputBox();
    // jsdom has no layout: the box has no size, so it fits anywhere
    expect([box()!.style.left, box()!.style.top]).toEqual(['100px', '64px']);
  });

  it('is placed below a button pressed inside an editor, not at the selection', () => {
    const { host, button, quickInput, box } = setup();
    const editor = host.appendChild(document.createElement('div'));
    editor.contentEditable = 'true';
    editor.setAttribute('contenteditable', 'true');
    editor.append(button);
    editor.append('Some text');
    const range = document.createRange();
    range.selectNodeContents(editor.lastChild!);
    range.getClientRects = () => [new DOMRect(300, 300, 50, 16)] as unknown as DOMRectList;
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    host.getBoundingClientRect = () => new DOMRect(10, 20, 600, 400);
    Object.defineProperties(host, { clientWidth: { value: 600 }, clientHeight: { value: 400 } });
    button.getBoundingClientRect = () => new DOMRect(110, 60, 40, 20);
    button.getClientRects = () => [button.getBoundingClientRect()] as unknown as DOMRectList;
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    void quickInput.showInputBox();
    expect([box()!.style.left, box()!.style.top]).toEqual(['100px', '64px']);
  });
});

describe('showQuickPick', () => {
  it('filters as the user types, moves with the arrow keys and picks with Enter', async () => {
    const { quickInput, box, key, type } = setup();
    const items = [{ label: 'Rename…' }, { label: 'Remove label', description: '<intro>' }, { label: 'Rename only the label…' }];
    const answer = quickInput.showQuickPick(items, { title: 'Label', placeHolder: 'What to do' });
    const dialog = box()!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    const input = dialog.querySelector('input')!;
    const options = () => [...dialog.querySelectorAll<HTMLElement>('[role=option]')].filter((option) => !option.hidden);
    expect(options().map((option) => option.textContent)).toEqual(['Rename…', 'Remove label <intro>', 'Rename only the label…']);
    type(input, 'ren');
    expect(options().map((option) => option.querySelector('.zwf-quick-pick__label')!.textContent)).toEqual(['Rename…', 'Rename only the label…']);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[1].id);
    key(input, 'Enter');
    expect(await answer).toBe(items[2]);
  });

  it('picks a string item with a click', async () => {
    const { quickInput, box } = setup();
    const answer = quickInput.showQuickPick(Promise.resolve(['a.png', 'b.png']));
    await tick();
    box()!.querySelectorAll<HTMLElement>('[role=option]')[1].click();
    expect(await answer).toBe('b.png');
  });
});

describe('createQuickPick', () => {
  it('shows the items its owner sets (headings, marks, keys), tells the text and the item picked, and stays until hidden', () => {
    const { host, button, quickInput, key, type } = setup();
    button.focus();
    const pick = quickInput.createQuickPick<{ label: string; keybinding?: string; highlights?: { label: [number, number][] } }>();
    pick.title = 'Find';
    pick.prompt = 'Narrow with #';
    const values: string[] = [];
    const accepted: string[] = [];
    let hidden = 0;
    pick.onDidChangeValue((value) => {
      values.push(value);
      pick.items = [{ kind: QuickPickItemKind.Separator, label: 'Files', description: '2 more' }, { label: `${value}.typ`, keybinding: '⌘P', highlights: { label: [[0, value.length]] } }];
    });
    pick.onDidAccept(() => accepted.push(pick.selectedItems[0].label));
    pick.onDidHide(() => hidden++);
    pick.show();
    pick.value = 'a';
    const field = host.querySelector<HTMLInputElement>('.zwf-quick-pick--wide input')!;
    expect([document.activeElement, field.getAttribute('aria-label'), host.querySelector('.zwf-quick-pick__hint')!.textContent]).toEqual([field, 'Find', 'Narrow with #']);
    type(field, 'intro');
    expect(values).toEqual(['a', 'intro']);
    expect(host.querySelector('.zwf-quick-pick__heading')!.textContent).toBe('Files 2 more');
    expect([host.querySelector('[role=option]')!.textContent, host.querySelector('mark')!.textContent]).toEqual(['intro.typ ⌘P', 'intro']);
    pick.busy = true;
    expect(host.querySelector<HTMLElement>('.zwf-quick-pick__progress')!.hidden).toBe(false);
    key(field, 'Enter');
    expect([accepted, hidden, host.querySelector('.zwf-quick-pick') !== null]).toEqual([['intro.typ'], 0, true]);
    pick.hide();
    expect([hidden, host.querySelector('.zwf-quick-pick'), document.activeElement]).toEqual([1, null, button]);
    pick.show();
    key(field, 'Escape');
    expect(hidden).toBe(2);
  });
  it("gives each box's ids their own name: two windows' quick picks on one page do not collide", () => {
    const picks = [setup(), setup()].map(({ host, quickInput }) => {
      const pick = quickInput.createQuickPick<{ label: string }>();
      pick.prompt = 'Narrow';
      pick.items = [{ label: 'one' }];
      pick.show();
      const field = host.querySelector<HTMLInputElement>('.zwf-quick-pick--wide input')!;
      const listbox = host.querySelector('[role=listbox]')!;
      expect([field.getAttribute('aria-controls'), field.getAttribute('aria-describedby')]).toEqual([listbox.id, host.querySelector('.zwf-quick-pick__hint')!.id]);
      return [listbox.id, field.getAttribute('aria-describedby'), host.querySelector('[role=option]')!.id];
    });
    const ids = picks.flat();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.map((id) => document.querySelectorAll(`[id="${id}"]`).length)).toEqual(ids.map(() => 1));
  });
});
