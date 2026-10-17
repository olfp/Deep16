#!/usr/bin/env node
// scripts/ui-shot.mjs - drive the Deep16 IDE in headless Chrome and check it.
//
// Why this exists: the OpenChamber browser panel can only be scripted when
// OpenChamber runs as the desktop application. This harness does not depend on
// that. It serves the repo over http, drives the real page with puppeteer-core,
// saves screenshots, and fails on a page/console error or on a layout that
// clips a control - the class of bug a unit test cannot see.
//
// Usage:
//   npm run ui:shot                       # desktop + mobile -> artifacts/ui-shots
//   npm run ui:shot -- --out=/tmp/shots   # choose the output directory
//   PUPPETEER_EXECUTABLE_PATH=/path/to/chrome npm run ui:shot
//
// puppeteer-core ships no browser, so it needs one. Set
// PUPPETEER_EXECUTABLE_PATH, or have Chrome/Chromium in a standard place; the
// known locations below include the one this repo's tooling already uses
// (book/build pulls a Chromium into /tmp/chromium).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --------------------------------------------------------------------------
// command line
// --------------------------------------------------------------------------
function argValue(name, fallback) {
  const hit = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!hit) return fallback;
  if (hit === name) return true;
  return hit.slice(name.length + 1);
}
const OUT = path.resolve(ROOT, String(argValue('--out', 'artifacts/ui-shots')));

// --------------------------------------------------------------------------
// a browser to drive
// --------------------------------------------------------------------------
function findChrome() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/tmp/chromium/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  // Chrome-for-Testing dropped under the puppeteer cache, if any was ever
  // downloaded (puppeteer-core does not do it for us).
  const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  try {
    for (const dir of fs.readdirSync(cache)) {
      candidates.push(path.join(cache, dir, 'chrome-linux64', 'chrome'));
      candidates.push(path.join(cache, dir, 'chrome-linux', 'chrome'));
    }
  } catch { /* no cache - fine */ }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* keep looking */ }
  }
  throw new Error(
    'no Chrome/Chromium found - set PUPPETEER_EXECUTABLE_PATH to a browser binary');
}

// --------------------------------------------------------------------------
// a static server for the repo
// --------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.fth': 'text/plain; charset=utf-8',
  '.asm': 'text/plain; charset=utf-8',
};

function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      // The browser probes for a favicon even when the page declares an .svg
      // one; answer 204 so it never shows up as a console 404.
      if (urlPath === '/favicon.ico') { res.writeHead(204).end(); return; }
      const file = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// --------------------------------------------------------------------------
// checks
// --------------------------------------------------------------------------
const failures = [];
const notes = [];
function check(cond, message) {
  if (cond) notes.push(`ok   ${message}`);
  else { failures.push(message); notes.push(`FAIL ${message}`); }
}

// Every control in the screen menu must be visible and fully inside the tab.
// On a phone the row is too narrow for the legend and three buttons, and the
// buttons used to run off the right edge and be clipped - the "no button there"
// bug this asserts against.
async function checkMenuFits(page, label) {
  const rows = await page.evaluate(() => {
    const tab = document.getElementById('screen-tab');
    const tabRect = tab ? tab.getBoundingClientRect() : { left: 0, right: 0 };
    return ['file-upload-btn', 'echo-toggle-btn'].map((id) => {
      const el = document.getElementById(id);
      if (!el) return { id, missing: true };
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        id,
        visible: style.display !== 'none' && style.visibility !== 'hidden',
        inside: r.left >= tabRect.left - 1 && r.right <= tabRect.right + 1,
        left: Math.round(r.left), right: Math.round(r.right),
        tabLeft: Math.round(tabRect.left), tabRight: Math.round(tabRect.right),
      };
    });
  });
  for (const r of rows) {
    check(!r.missing, `${label}: #${r.id} exists`);
    if (r.missing) continue;
    check(r.visible, `${label}: #${r.id} is visible`);
    check(r.inside, `${label}: #${r.id} is inside the tab (${r.left}..${r.right} vs ${r.tabLeft}..${r.tabRight})`);
  }
}

// Load the Forth kernel into the editor, assemble it in the current console
// mode, type a line into the UART and run the JS core directly. The IDE's own
// run loop is paced for a person (200 steps per tick) and would take half a
// minute to reach the prompt; stepping the model here is the same machine, just
// not throttled.
async function runForthRepl(page) {
  const source = fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8');
  await page.evaluate((text) => { document.getElementById('editor').value = text; }, source);
  const assembled = await page.evaluate(() => {
    window.deepWebUI.assemble();
    return window.deepWebUI.currentAssemblyResult && window.deepWebUI.currentAssemblyResult.success;
  });
  check(assembled === true, 'desktop: the Forth kernel assembles in terminal mode');
  return page.evaluate(() => {
    const ui = window.deepWebUI;
    for (const ch of '3 4 + .\n') ui.kbdPushCode(ch === '\n' ? 13 : ch.charCodeAt(0));
    ui.simulator.running = true;
    for (let i = 0; i < 800000 && ui.simulator.running; i++) {
      ui.simulator.step();
      if (ui.simulator.uartTx.length) ui.pumpConsole();
    }
    ui.screenUI.updateScreenDisplay();
    const rows = ui.screenUI.terminal.text().map((r) => r.replace(/\s+$/, ''));
    return { mode: ui.consoleMode(), row0: rows[0], row1: rows[1], row2: rows[2] };
  });
}

// --------------------------------------------------------------------------
// one pass over one viewport
// --------------------------------------------------------------------------
async function runView(browser, base, { name, viewport, isMobile }) {
  // A fresh context per view, so localStorage (the persisted console mode, core
  // selection) does not leak from one viewport's run into the next.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const loc = typeof m.location === 'function' ? m.location() : null;
    const url = (loc && loc.url) || '';
    if (text.includes('favicon.ico') || url.includes('favicon.ico')) return;   // the browser's own probe
    pageErrors.push(`console: ${text}${url ? ' @ ' + url : ''}`);
  });

  await page.setViewport({ ...viewport, isMobile, hasTouch: !!isMobile, deviceScaleFactor: isMobile ? 2 : 1 });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));

  await page.click('[data-tab="screen"]').catch(() => {});
  await new Promise((r) => setTimeout(r, 400));

  const before = await page.$eval('#console-mode-btn', (el) => el.textContent.trim()).catch(() => null);
  check(before === 'Console: Screen', `${name}: the console mode starts on the screen buffer`);
  const headerVisible = await page.$eval('#console-mode-btn',
    (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
              return s.display !== 'none' && r.width > 0 && r.left >= 0 && r.right <= innerWidth; })
    .catch(() => false);
  check(headerVisible, `${name}: the Console: button is visible in the header`);
  await checkMenuFits(page, name);
  await page.screenshot({ path: path.join(OUT, `${name}-screen.png`) });

  // Flip to the terminal and feed it a stream through the real render path.
  await page.click('#console-mode-btn').catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.$eval('#console-mode-btn', (el) => el.textContent.trim()).catch(() => null);
  check(after === 'Console: Terminal', `${name}: the button flips to the terminal`);

  const rendered = await page.evaluate(() => {
    const ui = window.deepWebUI;
    if (!ui || !ui.screenUI || !ui.screenUI.terminal) return null;
    const text = 'Hello from UART\r\n> 3 4 + . 7  ok\r\n>';
    ui.simulator.uartTx.push(...text.split('').map((c) => c.charCodeAt(0)));
    ui.pumpConsole();
    ui.screenUI.updateScreenDisplay();
    const rows = ui.screenUI.terminal.text();
    const cell = document.getElementById('screen-char-0');
    return { mode: ui.screenUI.mode, row0: rows[0].slice(0, 15), cell0: cell ? cell.textContent : null };
  });
  check(rendered && rendered.mode === 'terminal', `${name}: the view is in terminal mode`);
  check(rendered && rendered.row0 === 'Hello from UART', `${name}: the terminal renders the stream`);
  check(rendered && rendered.cell0 === 'H', `${name}: the grid cell follows the stream`);
  await page.screenshot({ path: path.join(OUT, `${name}-terminal.png`) });

  // The real thing, on the desktop pass only (it is the slow part): assemble
  // the serial kernel and read a live REPL off the terminal.
  if (!isMobile) {
    const repl = await runForthRepl(page);
    check(repl.mode === 'terminal', 'desktop: the mode is terminal for the REPL');
    check(repl.row0 === 'Hello DeepForth!',
      `desktop: the serial kernel boots to the banner (got ${JSON.stringify(repl.row0)})`);
    check(repl.row1 === '> 3 4 + . 7  ok',
      `desktop: a line evaluates over the UART (got ${JSON.stringify(repl.row1)})`);
    await page.screenshot({ path: path.join(OUT, 'desktop-repl.png') });
  }

  check(pageErrors.length === 0, `${name}: no page or console errors${pageErrors.length ? ' - ' + pageErrors.join('; ') : ''}`);
  await page.close();
  await context.close();
}

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await startServer(ROOT);
  const base = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    await runView(browser, base, { name: 'desktop', viewport: { width: 1400, height: 950 }, isMobile: false });
    await runView(browser, base, { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true });
  } finally {
    await browser.close();
    server.close();
  }

  for (const n of notes) console.log(n);
  console.log(`\nscreenshots -> ${path.relative(ROOT, OUT)}`);
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
