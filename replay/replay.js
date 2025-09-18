#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

function readJson(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const text = fs.readFileSync(abs, 'utf-8');
  return JSON.parse(text);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForVisible(page, selector, timeout = 15000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}

async function clickFirstWorking(page, selectors, button) {
  for (const sel of selectors) {
    try {
      await waitForVisible(page, sel);
      await page.click(sel, { button });
      return true;
    } catch (_) {}
  }
  throw new Error(`None of the selectors worked for click: ${selectors.join(' | ')}`);
}

async function fillFirstWorking(page, selectors, value) {
  for (const sel of selectors) {
    try {
      await waitForVisible(page, sel);
      const tagName = await page.$eval(sel, (el) => el.tagName.toLowerCase());
      if (tagName === 'input' || tagName === 'textarea') {
        await page.fill(sel, String(value ?? ''));
      } else {
        await page.click(sel);
        await page.keyboard.type(String(value ?? ''));
      }
      return true;
    } catch (_) {}
  }
  throw new Error(`None of the selectors worked for fill: ${selectors.join(' | ')}`);
}

async function focusFirstWorking(page, selectors) {
  for (const sel of selectors) {
    try {
      await waitForVisible(page, sel);
      await page.click(sel);
      return true;
    } catch (_) {}
  }
  return false;
}

async function applyViewport(page, event) {
  if (event.width && event.height) {
    await page.setViewportSize({ width: event.width, height: event.height });
  }
}

async function navigate(page, url) {
  await page.goto(url, { waitUntil: 'load' });
}

async function replayEvent(page, event) {
  switch (event.type) {
    case 'viewport':
      await applyViewport(page, event);
      break;
    case 'navigate':
      if (event.url) {
        await navigate(page, event.url);
      }
      break;
    case 'scroll': {
      const x = Number(event.x) || 0;
      const y = Number(event.y) || 0;
      await page.evaluate(([sx, sy]) => window.scrollTo(sx, sy), [x, y]);
      break;
    }
    case 'click': {
      const selectors = event.selectors && event.selectors.length ? event.selectors : [event.selector];
      const button = event.button || 'left';
      await clickFirstWorking(page, selectors, button);
      break;
    }
    case 'fill': {
      const selectors = event.selectors && event.selectors.length ? event.selectors : [event.selector];
      await fillFirstWorking(page, selectors, event.value);
      break;
    }
    case 'press': {
      const key = event.key;
      const selectors = event.selectors && event.selectors.length ? event.selectors : (event.selector ? [event.selector] : []);
      if (selectors.length > 0) {
        await focusFirstWorking(page, selectors);
      }
      await page.keyboard.press(key);
      break;
    }
    default:
      console.warn('Unknown event type:', event.type);
  }
}

async function main() {
  const tracePath = process.argv[2] || 'traces/chatgpt-trace.json';
  const slowMo = Number(process.env.SLOWMO || 0);
  const doTrace = process.env.TRACE === '1';
  const useCdp = process.env.CDP === '1';
  const cdpUrl = process.env.CDP_URL || 'http://localhost:9222';
  const events = readJson(tracePath);

  let browser;
  let context;
  if (useCdp) {
    // Connect to an existing Chrome instance started with --remote-debugging-port
    browser = await chromium.connectOverCDP(cdpUrl);
    context = browser.contexts()[0] || (await browser.newContext());
  } else {
    browser = await chromium.launch({ headless: false, slowMo: slowMo > 0 ? slowMo : undefined });
    context = await browser.newContext();
  }

  if (doTrace) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  }
  const page = await context.newPage();

  // If the trace does not start with a navigate, we won't auto-navigate
  for (const event of events) {
    await replayEvent(page, event);
    await sleep(200); // small delay for stability
  }

  if (doTrace) {
    await context.tracing.stop({ path: 'playwright-trace.zip' });
    console.log('Saved trace to playwright-trace.zip');
  }
  console.log('Replay complete. Close browser to exit.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


