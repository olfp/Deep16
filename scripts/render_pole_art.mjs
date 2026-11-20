#!/usr/bin/env node
// scripts/render_pole_art.mjs - preview the real Pole art on the real model.
//
// The milestone-1 prototype drew the scene with floating point rectangles.
// This script draws the *hardware* picture: the integer model
// (js/deep16_pole_model.js) produces the map cells and the OAM words, the art
// comes from scripts/make_pole_art.mjs in the FiT's tile and sprite formats,
// and the frame is composited by the behavioural tile engine. What comes out
// is what the board shows, down to the last pixel.
//
// Usage:
//   npm run render:pole:art
//   npm run render:pole:art -- --frames=3 --scale=2 --out=artifacts/pole
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePng } from './lib_png.mjs';
import {
  TILE, SCALES, PLAYER_GROUP, PLAYER_GROUP_RIGHT, MODEL_GROUPS,
  poleTileGrids, poleSpriteGrids, tileWords, spriteWords,
  TILE_PALETTE, SPRITE_PALETTE, TEXT_PALETTE,
} from './make_pole_art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let loaded = null;

function loadScripts() {
  if (loaded) return loaded;
  globalThis.window = globalThis.window || {};
  for (const file of ['js/deep16_tile_engine.js', 'js/deep16_pole_model.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  }
  loaded = {
    Engine: vm.runInThisContext('Deep16TileEngine'),
    Model: vm.runInThisContext('Deep16PoleModel'),
  };
  return loaded;
}

// The palette windows: set 0, bank 0 is the text, bank 1 the tiles and bank 2
// the sprites.
const PAL_TEXT = 0xF6080;
const PAL_TILE = 0xF6090;
const PAL_SPRITE = 0xF60A0;

export function loadArtInto(engine) {
  for (const tile of poleTileGrids()) {
    const words = tileWords(tile.grid);
    for (let i = 0; i < words.length; i++) {
      engine.write(0xF3000 + tile.index * 32 + i, words[i]);
    }
  }
  for (const entry of poleSpriteGrids()) {
    const words = spriteWords(entry.grid);
    for (let i = 0; i < words.length; i++) {
      engine.write(0xF4000 + entry.group * 256 + i, words[i]);
    }
  }
  for (let i = 0; i < TEXT_PALETTE.length; i++) engine.write(PAL_TEXT + i, TEXT_PALETTE[i]);
  for (let i = 0; i < TILE_PALETTE.length; i++) engine.write(PAL_TILE + i, TILE_PALETTE[i]);
  for (let i = 0; i < SPRITE_PALETTE.length; i++) engine.write(PAL_SPRITE + i, SPRITE_PALETTE[i]);
  // The cursor would blink over the road.
  engine.write(0xF2000, 0);
}

// Draw one model frame into the engine and return the raw 640x360 pixels.
export function renderModelFrame(engine, state) {
  const { Model } = loadScripts();
  const frame = Model.render(state);
  // The renderer writes the back bank and asks for the swap at the end.
  const back = frame.bank;
  engine.write(0xF2008, back);
  for (let row = 0; row < Model.ROWS; row++) {
    for (let col = 0; col < Model.COLS; col++) {
      engine.write(0xF1000 + row * Model.MAP_COLS + col, frame.cells[row * Model.COLS + col]);
    }
  }
  for (let i = 0; i < frame.oam.length; i++) engine.write(0xF6000 + i, frame.oam[i]);
  engine.write(0xF2008, back | (back << 1));
  engine.tick();
  return engine.render();
}

// Crop a rectangle out of the frame and scale it up. The crop is in source
// pixels; the output is nearest-neighbour, so the pixels stay crisp.
export function cropScale(rgba, srcWidth, crop, scale) {
  const rect = crop || { x: 0, y: 0, w: srcWidth, h: 360 };
  const width = rect.w * scale;
  const height = rect.h * scale;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = ((rect.y + Math.floor(y / scale)) * srcWidth +
                   (rect.x + Math.floor(x / scale))) * 4;
      const dst = (y * width + x) * 4;
      out[dst] = rgba[src];
      out[dst + 1] = rgba[src + 1];
      out[dst + 2] = rgba[src + 2];
      out[dst + 3] = rgba[src + 3];
    }
  }
  return out;
}

export function renderPoleArt(frames = 1, scale = 2, crop = null) {
  const { Engine, Model } = loadScripts();
  const engine = new Engine();
  loadArtInto(engine);
  const state = Model.defaultState('curve');
  const images = [];
  let width = engine.WIDTH;
  let height = engine.HEIGHT;
  for (let frame = 0; frame < frames; frame++) {
    if (frame > 0) Model.advance(state);
    const rgba = renderModelFrame(engine, state);
    images.push(cropScale(rgba, engine.WIDTH, crop, scale));
  }
  const rect = crop || { x: 0, y: 0, w: engine.WIDTH, h: engine.HEIGHT };
  width = rect.w * scale;
  height = rect.h * scale;
  return { engine, state, images, width, height };
}

function parseArgs(argv) {
  const opts = {
    frames: 1,
    scale: 2,
    crop: null,
    out: path.join(ROOT, 'artifacts', 'pole'),
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--frames=')) opts.frames = Number(arg.slice(9));
    else if (arg.startsWith('--scale=')) opts.scale = Number(arg.slice(8));
    else if (arg.startsWith('--crop=')) {
      const [x, y, w, h] = arg.slice(7).split(',').map(Number);
      opts.crop = { x, y, w, h };
    } else if (arg.startsWith('--out=')) opts.out = path.resolve(ROOT, arg.slice(6));
  }
  if (!Number.isInteger(opts.frames) || opts.frames < 1) throw new Error('--frames must be positive');
  if (!Number.isInteger(opts.scale) || opts.scale < 1) throw new Error('--scale must be positive');
  return opts;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('usage: node scripts/render_pole_art.mjs [--frames=N] [--scale=N] ' +
                '[--crop=x,y,w,h] [--out=DIR]');
    process.exit(0);
  }
  fs.mkdirSync(opts.out, { recursive: true });
  const result = renderPoleArt(opts.frames, opts.scale, opts.crop);
  for (let frame = 0; frame < result.images.length; frame++) {
    const file = path.join(opts.out, `art-${frame}.png`);
    writePng(file, result.width, result.height, result.images[frame]);
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }
  console.log(`tiles ${TILE.SKY}..${TILE.CENTER + 7}, player groups ${PLAYER_GROUP}+${PLAYER_GROUP_RIGHT}, ` +
              `model groups ${MODEL_GROUPS.join(',')}, scales ` +
              `${SCALES.map((s) => `${s.width}x${s.height}`).join(' ')}`);
}
