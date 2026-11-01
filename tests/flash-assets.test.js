// FiT graphics flash assets: the blob is generated from the art pipeline and
// the loader writes it through the CPU windows. There is no engine ROM here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ASSET_BASE,
  PALETTE_WORDS,
  SPRITE_WORDS,
  TILE_WORDS,
  buildAssetBlob,
  buildAssetScript,
  buildAssetWords,
} from '../scripts/make_flash_assets.mjs';
import { ROOT } from './helpers.js';

const assetFile = path.join(ROOT, 'js', 'deep16_flash_assets.js');
vm.runInThisContext(fs.readFileSync(assetFile, 'utf8'), { filename: 'deep16_flash_assets.js' });
const assets = vm.runInThisContext('Deep16FlashAssets');

const loaderFile = path.join(ROOT, 'js', 'deep16_gfx_loader.js');
vm.runInThisContext(fs.readFileSync(loaderFile, 'utf8'), { filename: 'deep16_gfx_loader.js' });
const loader = vm.runInThisContext('Deep16GfxLoader');

function fakeSim() {
  return {
    spiFlash: { mem: new Uint8Array(4 * 1024 * 1024).fill(0xFF) },
    memory: new Array(1048576).fill(0xFFFF),
  };
}

test('the generated words have the expected sizes', () => {
  const words = buildAssetWords();
  assert.equal(words.tiles.length, TILE_WORDS);
  assert.equal(words.sprites.length, SPRITE_WORDS);
  assert.equal(words.palette.length, PALETTE_WORDS);
  assert.deepEqual(words.palette.slice(0, 16), words.palette.slice(16, 32));
  assert.deepEqual(words.palette.slice(16, 32), words.palette.slice(32, 48));
});

test('the committed flash image is current', () => {
  execFileSync(process.execPath,
               [path.join(ROOT, 'scripts', 'make_flash_assets.mjs'), '--check'],
               { cwd: ROOT, stdio: 'pipe' });
  assert.equal(assets.base, ASSET_BASE);
  assert.equal(assets.magic, 'D16G');
  assert.equal(assets.version, 1);
  assert.equal(assets.tileWords, TILE_WORDS);
  assert.equal(assets.spriteWords, SPRITE_WORDS);
  assert.equal(assets.paletteWords, PALETTE_WORDS);
});

test('the committed blob is the generated blob, word for word', () => {
  const expected = buildAssetBlob();
  const actual = Buffer.from(assets.bytes, 'base64');
  assert.deepEqual(actual, expected);
  assert.equal(actual.toString('ascii', 0, 4), 'D16G');
  assert.equal(actual.readUInt16LE(6), TILE_WORDS);
  assert.equal(actual.readUInt16LE(8), SPRITE_WORDS);
  assert.equal(actual.readUInt16LE(10), PALETTE_WORDS);
});

test('the loader parses the blob back to the generated words', () => {
  const generated = buildAssetWords();
  const parsed = loader.parse(assets);
  assert.deepEqual(Array.from(parsed.tiles), generated.tiles);
  assert.deepEqual(Array.from(parsed.sprites), generated.sprites);
  assert.deepEqual(Array.from(parsed.palette), generated.palette);
});

test('the loader copies the blob into the simulated config flash', () => {
  const sim = fakeSim();
  const info = loader.installFlash(sim, assets);
  assert.equal(info.base, ASSET_BASE);
  assert.equal(info.length, Buffer.byteLength(assets.bytes, 'base64'));
  const expected = Buffer.from(assets.bytes, 'base64');
  assert.deepEqual(Buffer.from(sim.spiFlash.mem.slice(ASSET_BASE, ASSET_BASE + expected.length)),
                   expected);
  assert.equal(sim.spiFlash.mem[ASSET_BASE - 1], 0xFF, 'nothing written below the blob');
});

test('the loader writes tiles, sprite pages and palettes through the CPU windows', () => {
  const sim = fakeSim();
  const engine = { writes: [], write(addr, value) { this.writes.push([addr, value & 0xFFFF]); } };
  const parsed = loader.parse(assets);
  const counts = loader.writeGraphics(engine, sim, parsed);

  assert.deepEqual(counts, { tiles: TILE_WORDS, sprites: SPRITE_WORDS, palettes: PALETTE_WORDS, pages: 3 });

  // All 128 tile slots, including the 32 the current RTL leaves read-only.
  for (const i of [0, 96 * 32, 127 * 32 + 31]) {
    assert.equal(sim.memory[0xF3000 + i], parsed.tiles[i]);
  }
  assert.equal(engine.writes.filter(([a]) => a >= 0xF3000 && a <= 0xF3FFF).length, TILE_WORDS);

  // The sprite bank is written one 8-group page at a time.
  const pageWrites = engine.writes.filter(([a]) => a === 0xF200A).map(([, v]) => v);
  assert.deepEqual(pageWrites.slice(0, 3), [0, 1, 2]);
  assert.equal(pageWrites[pageWrites.length - 1], 0, 'page returns to 0');

  // Replay the writes with the page register to prove each group landed on its
  // own page, not just that the last page survived in memory.
  let page = -1;
  const landed = [];
  for (const [addr, value] of engine.writes) {
    if (addr === 0xF200A) page = value;
    else if (addr >= 0xF4000 && addr <= 0xF47FF) landed.push([page, addr - 0xF4000, value]);
  }
  assert.equal(landed.length, SPRITE_WORDS);
  for (const [p, off, value] of landed) {
    assert.equal(value, parsed.sprites[p * 2048 + off], `sprite page ${p} offset ${off}`);
  }
  // Only page 2 remains in the flat JS memory after the load.
  for (const i of [4096, 6143]) {
    assert.equal(sim.memory[0xF4000 + (i % 2048)], parsed.sprites[i]);
  }

  // Three palette banks are contiguous at 0xF5080..0xF50AF.
  for (let i = 0; i < PALETTE_WORDS; i++) {
    assert.equal(sim.memory[0xF5080 + i], parsed.palette[i]);
  }
});

test('writeGraphics works without an engine (memory-only tests)', () => {
  const sim = fakeSim();
  const parsed = loader.parse(assets);
  const counts = loader.writeGraphics(null, sim, parsed);
  assert.equal(counts.tiles, TILE_WORDS);
  assert.equal(sim.memory[0xF3000 + 4095], parsed.tiles[4095]);
  assert.equal(sim.memory[0xF50AF], parsed.palette[47]);
});

test('load runs flash install and the CPU-window load together', () => {
  const sim = fakeSim();
  const engine = { writes: 0, write() { this.writes++; } };
  const { parsed, counts } = loader.load(engine, sim, assets);
  assert.equal(counts.tiles, parsed.tiles.length);
  assert.equal(engine.writes, TILE_WORDS + SPRITE_WORDS + 3 + 1 + PALETTE_WORDS);
  assert.deepEqual(Buffer.from(sim.spiFlash.mem.slice(ASSET_BASE, ASSET_BASE + 4)).toString('ascii'), 'D16G');
});

test('buildAssetScript carries the counts and base', () => {
  const script = buildAssetScript();
  assert.match(script, /const Deep16FlashAssets/);
  assert.match(script, /base: 0x300000/);
  assert.match(script, /tileWords: 4096/);
  assert.match(script, /spriteWords: 6144/);
  assert.match(script, /paletteWords: 48/);
});
