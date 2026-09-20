// Renders the real browser panels to PNG so the Unity client can draw the
// same UI instead of a second hand-built one. Playwright is optional: without
// it the service reports unavailable and Unity keeps its own panels.
import { createRequire } from 'node:module';

// "workspace" is the whole three-column grid. Streaming it as one image keeps
// the browser's layout intact instead of rebuilding it from separate panels.
const SELECTORS = { workspace: '#studio-page', rail: 'aside.rail.panel', passport: 'aside.passport.panel' };
export const PANEL_NAMES = Object.keys(SELECTORS);

let browser = null, launching = null;
const pages = new Map(), cache = new Map();

async function launch() {
  if (browser) return browser;
  if (!launching) launching = (async () => {
    const { chromium } = createRequire(import.meta.url)('playwright');
    const options = { headless: true, args: ['--disable-dev-shm-usage'] };
    // Prefer Playwright's own build; fall back to an installed Chrome so a
    // machine without downloaded browsers still renders panels.
    browser = await chromium.launch(options).catch(() => chromium.launch({ ...options, channel: 'chrome' }));
    browser.on('disconnected', () => { browser = null; launching = null; pages.clear(); cache.clear(); });
    return browser;
  })().catch(e => { launching = null; throw e; });
  return launching;
}

async function pageFor(sessionId, origin) {
  const existing = pages.get(sessionId);
  if (existing && !existing.isClosed()) return existing;
  // Sized to the Unity canvas so the AR layout is laid out at its real aspect.
  const context = await (await launch()).newContext({ viewport: { width: 1520, height: 930 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${origin}/?view=ar#session=${sessionId}`, { waitUntil: 'domcontentloaded' });
  // The page joins the session over SSE, so it keeps mirroring state on its own.
  await page.waitForSelector(SELECTORS.rail, { timeout: 15000 });
  pages.set(sessionId, page);
  return page;
}

export async function renderPanel(sessionId, name, revision, origin) {
  const selector = SELECTORS[name];
  if (!selector) return null;
  const key = `${sessionId}:${name}:${revision}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const page = await pageFor(sessionId, origin);
  const element = await page.waitForSelector(selector, { timeout: 10000 });
  const png = await element.screenshot({ type: 'png' });
  // Unity draws its live camera over the fitting column, so it needs that box
  // measured in the shot rather than hard-coded from the grid template.
  const fitting = name !== 'workspace' ? null : await page.evaluate(() => {
    const outer = document.querySelector('#studio-page'), inner = document.querySelector('.fitting.panel');
    if (!outer || !inner) return null;
    const o = outer.getBoundingClientRect(), i = inner.getBoundingClientRect();
    return { x: (i.left - o.left) / o.width, y: (i.top - o.top) / o.height, w: i.width / o.width, h: i.height / o.height };
  }).catch(() => null);
  Object.defineProperty(png, 'fitting', { value: fitting, enumerable: false });
  cache.set(key, png);
  // One entry per panel for the previous revision is enough to absorb races.
  for (const k of cache.keys()) { if (cache.size <= PANEL_NAMES.length * 2) break; cache.delete(k); }
  return png;
}

export async function releaseSession(sessionId) {
  const page = pages.get(sessionId);
  pages.delete(sessionId);
  for (const k of [...cache.keys()]) if (k.startsWith(sessionId + ':')) cache.delete(k);
  if (page && !page.isClosed()) await page.context().close().catch(() => {});
}

export async function shutdownPanels() {
  pages.clear(); cache.clear();
  if (browser) await browser.close().catch(() => {});
  browser = null; launching = null;
}
