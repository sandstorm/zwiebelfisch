// Tests for navigation-history.ts.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceRange } from '../../../core/typst-document/typst-document';
import { HISTORY_LIMIT, NavigationHistory } from './navigation-history';

const path = ProjectPath.of;
const at = (name: string, from = 0) => ({ path: path(name), selection: SourceRange.of({ from, to: from }) });

/** A history that went main.typ → a.typ → b.typ, leaving each at offset 1, 2. */
function visited() {
  const history = new NavigationHistory(path('/main.typ'));
  history.open(at('/main.typ', 1), path('/a.typ'));
  history.open(at('/a.typ', 2), path('/b.typ'));
  return history;
}

describe('NavigationHistory', () => {
  it('has nowhere to go at the start; opening the same file again is no step', () => {
    const history = new NavigationHistory(path('/main.typ'));
    history.open(at('/main.typ'), path('/main.typ'));
    expect([history.back, history.forward]).toEqual([undefined, undefined]);
    expect(history.goBack(at('/main.typ'))).toBeUndefined();
  });

  it('goes back to where the user left each file, and forward to where they left it going back', () => {
    const history = visited();
    expect(history.back).toEqual(at('/a.typ', 2));
    expect(history.goBack(at('/b.typ', 7))).toEqual(at('/a.typ', 2));
    expect(history.goBack(at('/a.typ', 3))).toEqual(at('/main.typ', 1));
    expect(history.back).toBeUndefined();
    expect(history.forward).toEqual(at('/a.typ', 3));
    expect(history.goForward(at('/main.typ', 1))).toEqual(at('/a.typ', 3));
    expect(history.goForward(at('/a.typ', 3))).toEqual(at('/b.typ', 7));
    expect(history.goForward(at('/b.typ', 7))).toBeUndefined();
  });

  it('drops the way forward when another file is opened after going back', () => {
    const history = visited();
    history.goBack(at('/b.typ'));
    history.open(at('/a.typ'), path('/c.typ'));
    expect(history.forward).toBeUndefined();
    expect(history.back?.path).toBe('/a.typ');
  });

  it(`keeps the last ${HISTORY_LIMIT} files`, () => {
    const history = new NavigationHistory(path('/0.typ'));
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) history.open(at(`/${i - 1}.typ`), path(`/${i}.typ`));
    let oldest = '';
    while (history.back) oldest = history.goBack(at('/x.typ'))!.path;
    expect(oldest).toBe(`/${5 + 1}.typ`);
  });

  it('follows a rename, and a renamed shown file is one place', () => {
    const history = visited();
    history.followFileChange({ kind: 'rename', from: path('/a.typ'), path: path('/chapters/a.typ') });
    expect(history.back).toEqual(at('/chapters/a.typ', 2));
    // the workbench shows the shown file under its new name: recorded as an open, merged with the rename
    history.open(at('/b.typ', 4), path('/c.typ'));
    history.followFileChange({ kind: 'rename', from: path('/b.typ'), path: path('/c.typ') });
    expect(history.back).toEqual(at('/chapters/a.typ', 2));
  });

  it('drops a deleted file; the same file twice in a row is one place', () => {
    const history = visited();
    history.open(at('/b.typ'), path('/a.typ'));
    // main, a, b, a (shown)
    history.followFileChange({ kind: 'delete', path: path('/b.typ') });
    expect(history.back?.path).toBe('/main.typ');
    expect(history.goBack(at('/a.typ'))?.path).toBe('/main.typ');
    expect(history.forward?.path).toBe('/a.typ');
  });

  it('keeps the shown place when its file is deleted (the workbench shows another, recorded as an open)', () => {
    const history = visited();
    history.open(at('/b.typ'), path('/main.typ'));
    history.followFileChange({ kind: 'delete', path: path('/b.typ') });
    expect(history.back?.path).toBe('/a.typ');
    history.followFileChange({ kind: 'delete', path: path('/main.typ') });
    expect(history.back?.path).toBe('/a.typ');
  });
});
