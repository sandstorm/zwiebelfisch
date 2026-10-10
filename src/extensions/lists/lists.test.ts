// Tests for lists.ts: task lists win over bullet lists by priority, not by registration order.
import { describe, expect, it } from 'vitest';
import { print, project } from '../../hosts/visual-view/visual-view';
import { schemaOf } from '../../testing/testing';
import { lists } from './lists';

const SOURCE = '- [ ] open\n- [x] done\n\n- plain\n';

describe('lists', () => {
  it('registers bullet lists before task lists, and a `- [ ] ..` item still is a task (priority 110 over 100)', () => {
    const doc = project(SOURCE, schemaOf([lists]));
    expect([doc.child(0).type.name, doc.child(1).type.name]).toEqual(['taskList', 'bulletList']);
    expect(doc.child(0).child(1).attrs.checked).toBe(true);
    expect(print(doc)).toBe(SOURCE);
  });
});
