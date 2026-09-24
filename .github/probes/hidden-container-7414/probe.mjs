// Fork-only causal characterization. A green job means the expected bug matrix
// was reproduced, NOT that the product is fixed. No provider or model calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(path.resolve('examples/e2e/package.json'));
const { chromium, expect } = require('@playwright/test');
const variant = process.argv[2];
assert(['baseline', 'alignment-only'].includes(variant));
const output = path.resolve('artifacts/7414', variant);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const receipts = [];
// Diagnostic stacks add overhead; this is not a latency benchmark.
// Set TRACE_SCROLL=0 to repeat the same matrix without instrumentation.
const traceScroll = process.env.TRACE_SCROLL !== '0';

// Browser-realm, fork-only diagnostics; never scrolls or cancels a callback.
function startScrollTrace() {
  const el = window.__probeScroll;
  if (!el?.isConnected) throw new Error('Cannot trace a missing scroll container');
  const events = [];
  const limit = 256;
  let dropped = 0;
  let phase = 'installed';
  let stopped = false;
  const restore = [];
  const record = (kind, fields = {}) => {
    try {
      if (events.length >= limit) { dropped += 1; return; }
      events.push({ kind, phase, at: performance.now(), ...fields });
    } catch { /* Diagnostics must not change native scrolling behavior. */ }
  };
  // Do not coerce arguments or inspect option getters a second time.
  const describe = (value) => value === null || ['number', 'string', 'boolean'].includes(typeof value)
    ? value : `<${typeof value}>`;
  const writes = (kind, args) => record(kind, {
    args: args.map(describe), stack: new Error('scroll write').stack,
  });
  const wrap = (key, descriptor) => {
    const previous = Object.getOwnPropertyDescriptor(el, key);
    Object.defineProperty(el, key, { configurable: true, ...descriptor });
    restore.push(() => previous
      ? Object.defineProperty(el, key, previous)
      : Reflect.deleteProperty(el, key));
  };
  let observer;
  const onScroll = () => record('scroll-event', { scrollTop: el.scrollTop });
  const stop = () => {
    if (!stopped) {
      stopped = true;
      observer?.disconnect();
      el.removeEventListener('scroll', onScroll);
      for (const undo of restore.reverse()) undo();
    }
    return { events, dropped, limit };
  };
  try {
    let owner = el;
    while (owner && !Object.getOwnPropertyDescriptor(owner, 'scrollTop')) owner = Object.getPrototypeOf(owner);
    const original = owner && Object.getOwnPropertyDescriptor(owner, 'scrollTop');
    if (!original?.get || !original?.set) throw new Error('Unsupported scrollTop descriptor');
    wrap('scrollTop', {
      enumerable: original.enumerable,
      get() { return Reflect.apply(original.get, this, []); },
      set(value) {
        if (this === el) writes('scrollTop:set', [value]);
        return Reflect.apply(original.set, this, [value]);
      },
    });
    for (const key of ['scrollTo', 'scrollBy', 'scroll']) {
      const originalMethod = el[key];
      if (typeof originalMethod !== 'function') continue;
      wrap(key, { writable: true, value: function (...args) {
        if (this === el) writes(key, args);
        return Reflect.apply(originalMethod, this, args);
      } });
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) record('resize', { height: entry.contentRect.height });
    });
    observer.observe(el);
    return window.__probeTrace = {
      mark(value) { phase = value; record('mark'); },
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}

async function snapshot(page) {
  return page.evaluate(() => {
    const el = window.__probeScroll;
    if (!el?.isConnected || !el.clientHeight) throw new Error('Scroll container unavailable');
    const viewport = el.getBoundingClientRect();
    const rows = [...el.querySelectorAll('[data-probe-row]')];
    const anchor = rows.find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1;
    });
    if (!anchor) throw new Error('No visible row');
    return {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      fromBottom: el.scrollHeight - el.clientHeight - el.scrollTop,
      anchor: anchor.dataset.probeRow,
      offset: anchor.getBoundingClientRect().top - viewport.top,
      virtualRows: el.querySelectorAll('[data-index]').length,
    };
  });
}

async function settle(page) {
  let previous;
  let stable = 0;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const current = await snapshot(page);
    const same = previous && current.anchor === previous.anchor &&
      Math.abs(current.scrollTop - previous.scrollTop) < 0.5 &&
      Math.abs(current.scrollHeight - previous.scrollHeight) < 0.5 &&
      Math.abs(current.offset - previous.offset) < 0.5;
    stable = same ? stable + 1 : 0;
    if (stable >= 12) return current;
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error('Layout failed to settle; not a valid reproduction');
}

try {
  for (const mode of ['none', 'pin-to-bottom']) {
    for (const operation of ['rerender', 'hide-show']) {
      const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const page = await context.newPage();
      const receipt = { variant, mode, operation, outcome: 'probe_error', browser: browser.version() };
      receipt.scrollTracing = traceScroll;
      const pageErrors = [];
      const blockedRequests = [];
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
          blockedRequests.push(url.origin);
          return route.abort();
        }
        if (url.pathname.startsWith('/__probe_runtime')) {
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ agents: {}, version: 'probe' }) });
        }
        return route.continue();
      });
      try {
        await page.goto(`http://127.0.0.1:6006/iframe.html?id=probes-hiddencontainer7414--default&viewMode=story&probeMode=${mode}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await expect(page.locator('#probe-host [data-index]').first()).toBeVisible({ timeout: 90000 });
        await page.evaluate(() => {
          const row = document.querySelector('#probe-host [data-probe-row]');
          let el = row?.parentElement;
          while (el && !(el.clientHeight > 100 && el.scrollHeight > el.clientHeight + 500 && /auto|scroll/.test(getComputedStyle(el).overflowY))) {
            el = el.parentElement;
          }
          if (!el) throw new Error('Cannot find an actual scrollable container');
          window.__probeScroll = el;
          el.dataset.probeScroll = 'true';
        });
        await settle(page);
        const box = await page.locator('[data-probe-scroll]').boundingBox();
        assert(box);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -4000);
        await expect.poll(async () => (await snapshot(page)).fromBottom, { timeout: 10000 }).toBeGreaterThan(1500);
        const before = await settle(page);
        assert(before.scrollTop > 500, 'Reader must be in the middle, not already at the top');
        assert(before.virtualRows > 0 && before.virtualRows < 80, 'Virtualization must actually be active');
        receipt.before = before;
        if (traceScroll) await page.evaluate(startScrollTrace);
        if (operation === 'hide-show') {
          await page.evaluate(() => window.__probeTrace?.mark('before-hide'));
          await page.getByTestId('hide').click();
          await expect.poll(() => page.evaluate(() => window.__probeScroll.clientHeight)).toBe(0);
          await page.evaluate(() => window.__probeTrace?.mark('while-hidden-rerender'));
          await page.getByTestId('rerender').click();
          await expect(page.locator('#probe-host [data-index]')).toHaveCount(0);
          receipt.zeroHeightObserved = true;
          await page.evaluate(() => window.__probeTrace?.mark('before-show'));
          await page.getByTestId('show').click();
          await expect(page.locator('#probe-host')).toBeVisible();
        }
        await page.evaluate(() => window.__probeTrace?.mark('before-rerender'));
        await page.getByTestId('rerender').click();
        await expect(page.locator('#probe-host [data-index]').first()).toBeVisible();
        assert(await page.evaluate(() => document.querySelector('[data-probe-scroll]') === window.__probeScroll), 'The scroll element must not be replaced');
        const after = await settle(page);
        receipt.after = after;
        assert(after.virtualRows > 0 && after.virtualRows < 80, 'Restored view must still virtualize');
        const preserved = before.anchor === after.anchor && Math.abs(before.offset - after.offset) <= 3;
        const jumpedToBottom = after.fromBottom <= 100 && before.fromBottom > 1500;
        receipt.preserved = preserved;
        receipt.jumpedToBottom = jumpedToBottom;
        receipt.expected = operation === 'rerender' || (variant === 'alignment-only' && mode === 'none') ? 'preserved' : 'jumped_to_bottom';
        receipt.outcome = (receipt.expected === 'preserved' ? preserved : jumpedToBottom) ? 'matches_hypothesis' : 'unexpected_behavior';
        if (pageErrors.length) receipt.outcome = 'probe_error';
      } catch (error) {
        receipt.error = String(error.stack ?? error);
      } finally {
        if (traceScroll && receipt.before) {
          try {
            receipt.scrollTrace = await page.evaluate(() => window.__probeTrace?.stop() ?? null);
            if (!receipt.scrollTrace) throw new Error('Scroll trace was not installed');
          } catch (error) {
            receipt.traceError = String(error);
            receipt.outcome = 'probe_error';
          }
        }
        receipt.pageErrors = pageErrors;
        receipt.blockedOrigins = [...new Set(blockedRequests)];
        receipts.push(receipt);
        await page.screenshot({ path: path.join(output, `${mode}-${operation}.png`), fullPage: true }).catch(() => {});
        await context.tracing.stop({ path: path.join(output, `${mode}-${operation}.zip`) }).catch(() => {});
        await context.close();
        await writeFile(path.join(output, 'receipts.json'), JSON.stringify(receipts, null, 2));
      }
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(receipts, null, 2));
process.exitCode = receipts.length === 4 && receipts.every((r) => r.outcome === 'matches_hypothesis') ? 0 : 1;
