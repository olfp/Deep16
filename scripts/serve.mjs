#!/usr/bin/env node
// scripts/serve.mjs - a no-cache static server for the IDE.
//
// Why not `python -m http.server`: it sends no Cache-Control, so browsers fall
// back to heuristic freshness and keep serving a stale index.html after a
// change. That is exactly how a newly added control can look "missing" after a
// normal reload - the page in the tab is not the page on disk. This serves the
// repo with `Cache-Control: no-store`, so every reload is the current file.
//
// Usage:
//   npm run serve                 # http://127.0.0.1:8000
//   npm run serve -- --port=9000
//   npm run serve -- --host=0.0.0.0   # reachable from a phone on the LAN
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argValue(name, fallback) {
  const hit = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!hit) return fallback;
  if (hit === name) return true;
  return hit.slice(name.length + 1);
}
const PORT = Number(argValue('--port', 8000));
const HOST = String(argValue('--host', '127.0.0.1'));

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

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/favicon.ico') { res.writeHead(204).end(); return; }
  const file = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Cache-Control': 'no-store' }).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Deep16 IDE on http://${shown}:${PORT}  (no-store: reloads are always current)`);
});
