// Counts the layout reads of the measured code by caller: what forces a browser to lay out again. See typing.perf.ts.

/**
 * jsdom has no layout, so a read of a layout value costs nothing here. In a browser, a read after a DOM change forces
 * a synchronous layout of the page (a reflow). Counting the reads per caller shows where that would happen.
 */
export class LayoutReads {
  private readonly counts = new Map<string, number>();
  private counting = false;

  constructor(private readonly root: string) {
    for (const [owner, name] of LAYOUT_METHODS) this.wrapMethod(owner, name);
    for (const [owner, name] of LAYOUT_GETTERS) this.wrapGetter(owner, name);
    this.wrapMethod(globalThis as unknown as Record<string, unknown>, 'getComputedStyle');
  }

  start(): void {
    this.counts.clear();
    this.counting = true;
  }

  /** The reads since `start`, by API and the innermost caller of ours, most first. */
  stop(): [string, number][] {
    this.counting = false;
    return [...this.counts].sort((a, b) => b[1] - a[1]);
  }

  private record(api: string): void {
    if (!this.counting) return;
    const caller = new Error().stack!.split('\n').find((line) => line.includes(this.root) && !line.includes('node_modules') && !line.includes('tests/perf/layout-reads'));
    const where = caller?.slice(caller.indexOf(this.root) + this.root.length).replace(/\?[^:]*/, '').replace(/\)$/, '') ?? '(library)';
    const key = `${api} ← ${where}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  private wrapMethod(owner: Record<string, unknown>, name: string): void {
    const original = owner[name] as (...args: unknown[]) => unknown;
    if (typeof original !== 'function') return;
    const reads = this;
    owner[name] = function (this: unknown, ...args: unknown[]) {
      reads.record(name);
      return original.apply(this, args);
    };
  }

  private wrapGetter(owner: object, name: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (!descriptor?.get) return;
    const get = descriptor.get;
    const reads = this;
    Object.defineProperty(owner, name, {
      ...descriptor,
      get(this: unknown) {
        reads.record(name);
        return get.call(this);
      },
    });
  }
}

const LAYOUT_METHODS: [Record<string, unknown>, string][] = [
  [Element.prototype as unknown as Record<string, unknown>, 'getBoundingClientRect'],
  [Element.prototype as unknown as Record<string, unknown>, 'getClientRects'],
  [Range.prototype as unknown as Record<string, unknown>, 'getBoundingClientRect'],
  [Range.prototype as unknown as Record<string, unknown>, 'getClientRects'],
  [Document.prototype as unknown as Record<string, unknown>, 'elementFromPoint'],
];

const LAYOUT_GETTERS: [object, string][] = [
  ...['offsetHeight', 'offsetWidth', 'offsetTop', 'offsetLeft'].map((name): [object, string] => [HTMLElement.prototype, name]),
  ...['clientHeight', 'clientWidth', 'scrollHeight', 'scrollWidth', 'scrollTop', 'scrollLeft'].map((name): [object, string] => [Element.prototype, name]),
];
