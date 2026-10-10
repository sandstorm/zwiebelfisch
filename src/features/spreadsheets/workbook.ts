// mountWorkbook: IronCalc's workbook UI (React) over a spreadsheet's bytes. Loaded on demand by spreadsheets.ts:
// it brings React, the UI and the 2 MB engine, which nothing else needs.
import { IronCalc, init, Model } from '@ironcalc/workbook';
import styles from '@ironcalc/workbook/style.css?inline';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { sheetValues } from './values';

/** A mounted workbook; edits are reported through the `onEdit` given to `mountWorkbook`. */
export interface MountedWorkbook {
  destroy(): void;
}

/** What an edit produced: the file's new bytes and the sheets' displayed values. */
export interface WorkbookEdit {
  bytes: Uint8Array;
  values: Record<string, string[][]>;
}

const STYLE_ID = 'typst-ironcalc-styles';
/** Quiet time after the last edit before it is reported (typing in a cell is many events). */
const SAVE_DELAY = 300;

let engine: Promise<unknown> | null = null;

/**
 * Shows IronCalc's workbook UI in `container` for the spreadsheet `bytes`
 * (IronCalc's own format; empty: a new workbook named `name`). Its styles go
 * into the container's root (the document, or `<typst-editor>`'s shadow
 * root); its menus open inside the container. After every edit (cells,
 * sheets, formats) `onEdit` gets the new bytes and the computed values.
 */
export async function mountWorkbook(container: HTMLElement, bytes: Uint8Array, name: string, onEdit: (edit: WorkbookEdit) => void): Promise<MountedWorkbook> {
  engine ??= init();
  await engine;
  injectStyles(container);
  const model = bytes.length > 0 ? Model.from_bytes(bytes, 'en') : new Model(name, 'en', 'UTC', 'en');
  if (bytes.length === 0) onEdit({ bytes: model.toBytes(), values: sheetValues(model) });
  const root = createRoot(container);
  root.render(createElement(IronCalc, { model, rootContainer: container }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The UI changes the model directly; every change also queues a diff (meant for collaboration).
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (model.flushSendQueue().length === 0) return;
      onEdit({ bytes: model.toBytes(), values: sheetValues(model) });
    }, SAVE_DELAY);
  };
  const events = ['keyup', 'pointerup', 'paste', 'cut', 'drop', 'change', 'focusout'];
  for (const type of events) container.addEventListener(type, check, true);
  return {
    destroy: () => {
      clearTimeout(timer);
      for (const type of events) container.removeEventListener(type, check, true);
      root.unmount();
      model.free();
    },
  };
}

function injectStyles(container: HTMLElement): void {
  const root = container.getRootNode();
  const target = root instanceof ShadowRoot ? root : container.ownerDocument.head;
  if (target.querySelector(`#${STYLE_ID}`)) return;
  const style = container.ownerDocument.createElement('style');
  style.id = STYLE_ID;
  style.textContent = styles;
  target.append(style);
}
