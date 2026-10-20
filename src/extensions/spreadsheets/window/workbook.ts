// mountWorkbook and newWorkbook: IronCalc's workbook UI (React) over a spreadsheet's bytes, and a new spreadsheet with
// the starter table. Imported on demand only, as it brings React, the UI and the 2 MB engine. See spreadsheets in
// ../spreadsheets.ts.
import { IronCalc, init, Model } from '@ironcalc/workbook';
import styles from '@ironcalc/workbook/style.css?inline';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { typeStarterTable } from '../model/sheet-figure';
import { spreadsheetTypst } from '../model/typst-file';
import { followColorScheme } from './color-scheme';

/**
 * Shows IronCalc's workbook UI in `container` for the spreadsheet `bytes`
 * (IronCalc's own format; empty: a new workbook named `name`). Its styles go
 * into the container's root (the document, or `<zwiebelfisch-editor>`'s shadow
 * root); its menus open inside the container. After every edit (cells,
 * sheets, formats, sizes) `onEdit` gets the new bytes and the Typst file;
 * `fileName` (e.g. `budget.ic`) is named in that file's header.
 */
export async function mountWorkbook(
  container: HTMLElement,
  bytes: Uint8Array,
  fileName: string,
  onEdit: (edit: WorkbookEdit) => void,
): Promise<MountedWorkbook> {
  engine ??= init();
  await engine;
  injectStyles(container);
  const model = bytes.length > 0 ? Model.from_bytes(bytes, 'en') : new Model(fileName.replace(/\.ic$/, ''), 'en', 'UTC', 'en');
  const edited = () => onEdit({ bytes: model.toBytes(), typst: spreadsheetTypst(model, fileName) });
  if (bytes.length === 0) edited();
  const scheme = followColorScheme(container, () => redrawGrid(container));
  const root = createRoot(container);
  root.render(createElement(IronCalc, { model, rootContainer: container }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The UI changes the model directly; every change also queues a diff (meant for collaboration).
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (model.flushSendQueue().length === 0) return;
      edited();
    }, SAVE_DELAY);
  };
  const events = ['keyup', 'pointerup', 'paste', 'cut', 'drop', 'change', 'focusout'];
  for (const type of events) container.addEventListener(type, check, true);
  return {
    dispose: () => {
      clearTimeout(timer);
      for (const type of events) container.removeEventListener(type, check, true);
      root.unmount();
      scheme.dispose();
      model.free();
    },
  };
}

/** A mounted workbook; edits are reported through the `onEdit` given to `mountWorkbook`. */
export interface MountedWorkbook {
  dispose(): void;
}

/** What an edit produced: the file's new bytes and its Typst file (see `spreadsheetTypst`). */
export interface WorkbookEdit {
  bytes: Uint8Array;
  typst: string;
}

/** A new spreadsheet: its bytes, its Typst file and the name of its (first) sheet. */
export interface NewWorkbook extends WorkbookEdit {
  sheet: string;
}

/** A new workbook for the file `fileName` (e.g. `table.ic`) with the starter table typed in (`typeStarterTable`). */
export async function newWorkbook(fileName: string): Promise<NewWorkbook> {
  engine ??= init();
  await engine;
  const model = new Model(fileName.replace(/\.ic$/, ''), 'en', 'UTC', 'en');
  try {
    typeStarterTable(model);
    return { bytes: model.toBytes(), typst: spreadsheetTypst(model, fileName), sheet: model.getWorksheetsProperties()[0].name };
  } finally {
    model.free();
  }
}

let engine: Promise<unknown> | null = null;

function injectStyles(container: HTMLElement): void {
  const root = container.getRootNode();
  const target = root instanceof ShadowRoot ? root : container.ownerDocument.head;
  if (target.querySelector(`#${STYLE_ID}`)) return;
  const style = container.ownerDocument.createElement('style');
  style.id = STYLE_ID;
  style.textContent = styles;
  target.append(style);
}

const STYLE_ID = 'zwf-ironcalc-styles';

/**
 * Makes IronCalc's grid take up changed theme variables. The grid canvas reads them only when it is built, and the
 * worksheet builds it anew on every render; a window resize is what makes it render from outside (its own
 * listener), without losing a cell being edited (re-rendering the workbook would).
 */
function redrawGrid(container: HTMLElement): void {
  container.ownerDocument.defaultView?.dispatchEvent(new Event('resize'));
}

/** Quiet time after the last edit before it is reported (typing in a cell is many events). */
const SAVE_DELAY = 300;
