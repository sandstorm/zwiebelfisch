// @vitest-environment jsdom
// Tests for caption-labels.ts, through the image bar's "Caption" (the images and figures built-ins), and the bar's "Label".
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { createVisualEditor, TestPrompts } from '../../../testing/testing';
import { LabelIndex } from '../model/label-index';
import { references } from './visual-editor';

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An editor of `text` with labels; `click` presses a button of the bar above its first image (selected first). */
async function setup(text: string, prompts: TestPrompts) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const project = new Project(ProjectPath.of('/main.typ'), { '/main.typ': text, '/other.typ': '#figure(image("x.png")) <fig:cat-mat>\n' });
  createVisualEditor(parent, doc, { files: { '/cat.png': new Uint8Array([1]) }, prompts, contributions: [references({ labels: new LabelIndex(project), prompts })] });
  await settle();
  const click = async (name: string) => {
    parent.querySelector('img.typst-visual__rendering')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    parent.querySelector<HTMLButtonElement>(`[role="toolbar"][aria-label="Image"] button[aria-label="${name}"]`)!.click();
    await settle();
  };
  return { parent, doc, click };
}

/** Gives the first image the caption `caption` through its "Caption" button. */
async function caption(text: string, captionText: string): Promise<string> {
  const { doc, click } = await setup(text, new TestPrompts().answer(captionText));
  await click('Caption');
  return doc.text;
}

describe('caption labels', () => {
  it('label a figure after the caption written for it, a name no other label of the project has', async () => {
    expect(await caption('#image("cat.png")\n', 'The cat on the mat')).toBe('#figure(image("cat.png"), caption: [The cat on the mat]) <fig:cat-mat-2>\n');
  });

  it('leave an existing label alone', async () => {
    expect(await caption('#figure(image("cat.png")) <cat>\n', 'A cat')).toBe('#figure(image("cat.png"), caption: [A cat]) <cat>\n');
  });

  it('"Label" in the image bar starts a new label, or offers what to do with the existing one', async () => {
    const fresh = await setup('#figure(image("cat.png"), caption: [A])\n', new TestPrompts());
    await fresh.click('Label');
    expect(fresh.parent.querySelector<HTMLInputElement>('input[aria-label="New label"]')?.value).toBe('fig:');
    const prompts = new TestPrompts().answer('Remove label');
    const labelled = await setup('#figure(image("cat.png"), caption: [A]) <cat>\n', prompts);
    await labelled.click('Label');
    expect(prompts.asked[0].options).toMatchObject({ title: 'Label <cat>' });
    expect(labelled.doc.text).toBe('#figure(image("cat.png"), caption: [A])\n');
  });
});
