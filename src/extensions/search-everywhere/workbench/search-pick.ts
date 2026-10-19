// Search everywhere's quick pick. See searchEverywhere in ../search-everywhere.ts.
import { CancellationTokenSource } from '../../../core/cancellation/cancellation';
import { type QuickPick, type QuickPickHighlights, QuickPickItemKind, type QuickPickSeparator, type SearchItem, type SearchProvider, type WindowApi } from '../../../hosts/window/window';
import { fuzzyMatch } from '../model/fuzzy';

/**
 * Search everywhere: one quick pick over everything the search providers find (files, headings, commands, …), a group
 * per provider (`window.getSearchProviders`). `show` opens it (`window.createQuickPick`, at the top of the widget,
 * cancelling an open box). As the text changes every provider is asked (only those whose
 * prefix it starts with, if any), the previous round cancelled; synchronous results show at once, async ones as they
 * come (a progress line meanwhile). Items a provider did not match itself are matched fuzzily against their label, else
 * their description. Groups follow the providers' `order`. Picking an item closes the search, gives the focus back and
 * runs the item's `accept` right then (still in the user's gesture).
 */
export class SearchPick {
  #pick: QuickPick<Row> | null = null;
  #round: CancellationTokenSource | null = null;

  constructor(private readonly window: Pick<WindowApi, 'createQuickPick' | 'getSearchProviders'>) {}

  /** Opens the search with `value` in its field (e.g. a prefix: `#`). */
  show(value = ''): void {
    const pick = this.window.createQuickPick<Row>();
    pick.title = 'Search everywhere';
    pick.placeholder = 'Search files, headings, labels, commands, text…';
    pick.prompt = this.#hint();
    pick.onDidChangeValue((text) => this.#search(text));
    pick.onDidAccept(() => {
      const [row] = pick.selectedItems;
      pick.hide();
      if (row) accept(row.item);
    });
    pick.onDidHide(() => {
      if (this.#pick === pick) {
        this.#round?.cancel();
        this.#pick = null;
      }
      pick.dispose();
    });
    this.#pick?.hide();
    this.#pick = pick;
    pick.show();
    pick.value = value;
  }

  dispose(): void {
    this.#pick?.hide();
  }

  /** Asks the providers for `text`, showing what they found as it comes. */
  #search(text: string): void {
    this.#round?.cancel();
    const round = (this.#round = new CancellationTokenSource());
    const { providers, query, narrowed } = this.#narrow(text);
    const results = new Map<SearchProvider, Ranked>();
    let pending = 0;
    const render = () => {
      if (round.token.isCancellationRequested) return;
      if (!this.#pick) return;
      this.#pick.items = rows(providers, results, narrowed);
      this.#pick.busy = pending > 0;
    };
    for (const provider of providers) {
      const found = provided(provider, query, round);
      if (!(found instanceof Promise)) {
        results.set(provider, rank(found, query));
        continue;
      }
      pending++;
      void found.then((items) => {
        pending--;
        results.set(provider, rank(items, query));
        render();
      });
    }
    render();
  }

  /** The providers `text` asks (those of its prefix, the longest that matches; else all) and the query after the prefix. */
  #narrow(text: string): { providers: SearchProvider[]; query: string; narrowed: boolean } {
    const all = [...this.window.getSearchProviders()].sort(byOrder);
    const prefix = all
      .map((provider) => provider.prefix)
      .filter((candidate): candidate is string => !!candidate && text.startsWith(candidate))
      .sort((a, b) => b.length - a.length)[0];
    if (prefix === undefined) return { providers: all, query: text.trim(), narrowed: false };
    return { providers: all.filter((provider) => provider.prefix === prefix), query: text.slice(prefix.length).trim(), narrowed: true };
  }

  /** The line below the list: how to narrow the search (a prefix several providers share by the first one's label). */
  #hint(): string | undefined {
    const prefixes = new Map<string, string>();
    for (const { prefix, label } of [...this.window.getSearchProviders()].sort(byOrder)) if (prefix && !prefixes.has(prefix)) prefixes.set(prefix, label);
    if (prefixes.size === 0) return undefined;
    return `Narrow with ${[...prefixes].map(([prefix, label]) => `${prefix} ${label}`).join(' · ')}`;
  }
}

/** Runs the item's `accept` now; a failure is logged. */
function accept(item: SearchItem): void {
  const failed = (error: unknown) => console.error(`Search item ${item.label} failed:`, error);
  try {
    const result = item.accept();
    if (result instanceof Promise) result.catch(failed);
  } catch (error) {
    failed(error);
  }
}

/** A row of the list: what a search item shows, with what to highlight. */
interface Row {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly keybinding?: string;
  readonly highlights?: QuickPickHighlights;
  readonly item: SearchItem;
}

/** A provider's results for the current text: ranked, with what to highlight. */
type Ranked = readonly Row[];

/** A heading per provider with results (those not there yet are left out), then its best items. */
function rows(providers: readonly SearchProvider[], results: ReadonlyMap<SearchProvider, Ranked>, narrowed: boolean): (Row | QuickPickSeparator)[] {
  const limit = narrowed ? NARROWED : PER_GROUP;
  return providers.flatMap((provider) => {
    const ranked = results.get(provider) ?? [];
    if (ranked.length === 0) return [];
    const more = ranked.length - limit;
    const description = more <= 0 ? undefined : `${more} more${!narrowed && provider.prefix ? ` · type ${provider.prefix}` : ''}`;
    return [{ kind: QuickPickItemKind.Separator, label: provider.label, description }, ...ranked.slice(0, limit)];
  });
}

/** Narrowed to one prefix, a group shows up to this many. */
const NARROWED = 100;

/** Without a prefix, each group shows its best this many. */
const PER_GROUP = 5;

/** The provider's items for `query`: a list, or a Promise that resolves to [] once the round is cancelled or fails. */
function provided(provider: SearchProvider, query: string, round: CancellationTokenSource): readonly SearchItem[] | Promise<readonly SearchItem[]> {
  const failed = (error: unknown) => {
    console.error(`Search provider ${provider.id} failed:`, error);
    return [];
  };
  try {
    const items = provider.provideItems(query, round.token);
    if (!(items instanceof Promise)) return items;
    return items.then((list) => (round.token.isCancellationRequested ? [] : list), failed);
  } catch (error) {
    return failed(error);
  }
}

/**
 * The items matching `query`, best first: those with `highlights` as the provider matched them (in its order, first),
 * the others matched fuzzily against their label, else (scoring less) their description.
 */
function rank(items: readonly SearchItem[], query: string): Ranked {
  const scored: { row: Row; score: number }[] = [];
  const row = (item: SearchItem, highlights: QuickPickHighlights): Row => ({ label: item.label, description: item.description, detail: item.detail, keybinding: item.keybinding, highlights, item });
  for (const item of items) {
    if (item.highlights) {
      scored.push({ row: row(item, item.highlights), score: Infinity });
      continue;
    }
    const label = fuzzyMatch(query, item.label);
    const description = label ? null : item.description && fuzzyMatch(query, item.description);
    if (label) scored.push({ row: row(item, { label: label.ranges }), score: label.score });
    else if (description) scored.push({ row: row(item, { description: description.ranges }), score: description.score / 2 });
  }
  // stable: equal scores keep the provider's order
  return scored.sort((a, b) => (a.score === b.score ? 0 : b.score - a.score)).map(({ row }) => row);
}

function byOrder(a: SearchProvider, b: SearchProvider): number {
  return (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER) || a.id.localeCompare(b.id);
}

/** The order of a provider that names none. */
const DEFAULT_ORDER = 100;
