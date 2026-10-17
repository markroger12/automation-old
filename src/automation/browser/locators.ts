import type { Frame, Locator, Page } from 'playwright';

export type Scope = Page | Frame | Locator;

/**
 * The worker runs through tsx/esbuild with `keepNames`, which wraps named inner functions in a
 * `__name(fn, "name")` helper. Functions passed to page.evaluate() are serialized into the browser,
 * where that helper does not exist — so every page and frame gets a no-op implementation.
 */
export const EVALUATE_HELPERS_INIT_SCRIPT = 'globalThis.__name = globalThis.__name || function (fn) { return fn; };';

export type SelectorMap = Record<string, string[]>;

/** Prepends user-supplied selector overrides (Settings → selectorOverrides) to the defaults. */
export function mergeSelectors<T extends SelectorMap>(defaults: T, overrides?: Record<string, string[]>): T {
  if (!overrides) return defaults;
  const merged = { ...defaults } as SelectorMap;
  for (const [key, list] of Object.entries(overrides)) {
    if (!Array.isArray(list) || !list.length) continue;
    merged[key] = Array.from(new Set([...list, ...(defaults[key] ?? [])]));
  }
  return merged as T;
}

/** A locator matching any of the selectors (Playwright `or`). */
export function anyOf(scope: Scope, selectors: string[]): Locator {
  if (!selectors.length) throw new Error('anyOf requires at least one selector');
  let loc = scope.locator(selectors[0]);
  for (const s of selectors.slice(1)) loc = loc.or(scope.locator(s));
  return loc;
}

export async function waitForVisible(scope: Scope, selectors: string[], timeout: number): Promise<Locator | null> {
  // Filter before .first(): otherwise a hidden earlier match (e.g. a wrapper) would be waited on forever.
  const loc = anyOf(scope, selectors).filter({ visible: true }).first();
  try {
    await loc.waitFor({ state: 'visible', timeout });
    return loc;
  } catch {
    return null;
  }
}

export async function firstVisible(scope: Scope, selectors: string[]): Promise<Locator | null> {
  for (const s of selectors) {
    const loc = scope.locator(s).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

/**
 * Unchecks every checkbox in `boxes` except `keep` (an article gets exactly one WordPress category).
 * Returns how many were unchecked.
 */
export async function keepOnlyChecked(boxes: Locator, keep: Locator): Promise<number> {
  const keepHandle = await keep.elementHandle().catch(() => null);
  if (!keepHandle) return 0;
  let removed = 0;
  const count = await boxes.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    if (!(await box.isChecked().catch(() => false))) continue;
    const handle = await box.elementHandle().catch(() => null);
    if (handle && (await handle.evaluate((el, other) => el === other, keepHandle).catch(() => false))) continue;
    if (await box.uncheck({ timeout: 8000 }).then(() => true).catch(() => false)) removed++;
  }
  return removed;
}

export async function isAnyVisible(scope: Scope, selectors: string[]): Promise<boolean> {
  return (await firstVisible(scope, selectors)) !== null;
}

export async function clickFirstVisible(scope: Scope, selectors: string[], timeout = 5000): Promise<boolean> {
  const loc = await firstVisible(scope, selectors);
  if (!loc) return false;
  try {
    await loc.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

export async function countAll(scope: Scope, selectors: string[]): Promise<number> {
  return anyOf(scope, selectors).count();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls a condition until it is true or the timeout elapses. Used instead of fixed sleeps:
 * the loop exits as soon as the page reaches the expected state.
 */
export async function waitUntil(
  condition: () => Promise<boolean>,
  options: { timeout: number; interval?: number; shouldAbort?: () => Promise<boolean> | boolean },
): Promise<boolean> {
  const deadline = Date.now() + options.timeout;
  const interval = options.interval ?? 500;
  while (Date.now() < deadline) {
    if (await condition().catch(() => false)) return true;
    if (options.shouldAbort && (await options.shouldAbort())) return false;
    await sleep(interval);
  }
  return condition().catch(() => false);
}

export { sleep };
