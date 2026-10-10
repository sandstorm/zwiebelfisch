import type { Diagnostic, Jump, Page, Position } from '../engine/engine';
import type { Request, Response } from './protocol';

export interface PreviewOptions {
  /** Called when the user clicks something in the preview that has a source location. */
  onJump?(jump: Extract<Jump, { kind: 'source' }>): void;
  /** Called after every compilation with its errors and warnings. */
  onDiagnostics?(diagnostics: Diagnostic[]): void;
}

type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never;

/**
 * The live preview: compiles Typst in a worker and shows the pages as SVG.
 *
 * Hides the worker, request coalescing (only the newest pending update is
 * compiled), incremental page swapping, and the px ↔ pt mapping for
 * click-to-source and source-to-preview reveal.
 */
export class Preview {
  private readonly worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<number, (response: Response) => void>();
  private readonly pages: HTMLElement;
  private nextId = 0;
  private compiling = false;
  private queued: { files: Record<string, string>; main: string } | null = null;
  private pageSizes: Page[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly options: PreviewOptions = {},
  ) {
    this.pages = document.createElement('div');
    this.pages.className = 'typst-preview';
    this.pages.dataset.testid = 'typst-preview';
    this.pages.addEventListener('click', (event) => void this.handleClick(event));
    container.append(this.pages);
    this.worker.onmessage = (event: MessageEvent<Response>) => {
      this.pending.get(event.data.id)?.(event.data);
      this.pending.delete(event.data.id);
    };
  }

  /**
   * Shows the given project files (path → Typst source), compiling `main`.
   * Cheap to call on every keystroke: updates arriving while a compilation
   * runs are collapsed into one.
   */
  update(files: Record<string, string>, main = '/main.typ'): void {
    this.queued = { files, main };
    if (!this.compiling) void this.drain();
  }

  /** Scrolls the preview to where the text at `offset` in `path` appears, and flashes it. */
  async reveal(path: string, offset: number): Promise<void> {
    const response = await this.request({ type: 'cursor', path, offset });
    if (response.type !== 'cursor' || response.positions.length === 0) return;
    this.flash(response.positions[0]);
  }

  destroy(): void {
    this.worker.terminate();
    this.pages.remove();
  }

  private async drain(): Promise<void> {
    this.compiling = true;
    while (this.queued) {
      const { files, main } = this.queued;
      this.queued = null;
      const response = await this.request({ type: 'compile', files, main });
      if (response.type !== 'compile') continue;
      // Keep showing the last good pages while the document has errors.
      if (response.result.pages.length > 0) this.render(response.result.pages);
      this.options.onDiagnostics?.(response.result.diagnostics);
    }
    this.compiling = false;
    this.container.dispatchEvent(new CustomEvent('typst-preview-idle', { bubbles: true }));
  }

  private render(pages: Page[]): void {
    pages.forEach((page, index) => {
      let element = this.pages.children[index] as HTMLElement | undefined;
      if (!element) {
        element = document.createElement('div');
        element.className = 'typst-preview__page';
        this.pages.append(element);
      }
      if (element.dataset.hash !== page.hash) {
        element.dataset.hash = page.hash;
        element.innerHTML = page.svg;
      }
    });
    while (this.pages.children.length > pages.length) this.pages.lastElementChild!.remove();
    this.pageSizes = pages;
  }

  private async handleClick(event: MouseEvent): Promise<void> {
    const element = (event.target as Element).closest<HTMLElement>('.typst-preview__page');
    if (!element) return;
    const page = Array.prototype.indexOf.call(this.pages.children, element);
    const size = this.pageSizes[page];
    const rect = element.getBoundingClientRect();
    const scale = size.width / rect.width;
    const x = (event.clientX - rect.left) * scale;
    const y = (event.clientY - rect.top) * scale;
    const response = await this.request({ type: 'click', page, x, y });
    if (response.type === 'click' && response.jump?.kind === 'source') this.options.onJump?.(response.jump);
  }

  private flash({ page, x, y }: Position): void {
    const element = this.pages.children[page] as HTMLElement | undefined;
    const size = this.pageSizes[page];
    if (!element || !size) return;
    const marker = document.createElement('div');
    marker.className = 'typst-preview__flash';
    marker.style.left = `${(x / size.width) * 100}%`;
    marker.style.top = `${(y / size.height) * 100}%`;
    element.append(marker);
    marker.scrollIntoView({ block: 'center', behavior: 'smooth' });
    marker.addEventListener('animationend', () => marker.remove());
  }

  private request(body: RequestBody): Promise<Response> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ ...body, id });
    });
  }
}
