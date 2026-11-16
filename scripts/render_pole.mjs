#!/usr/bin/env node
// scripts/render_pole.mjs - deterministic milestone-1 Pole renderer frames.
//
// The scene is rendered through the behavioral FiT engine, so the PNG shows
// the real 640x360 tile/sprite/palette rules rather than an unrelated 2D
// approximation.
//
// Usage:
//   npm run render:pole
//   npm run render:pole -- --scene=curve --frames=3 --scale=2
//   npm run render:pole -- --scene=all --out=artifacts/pole
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePng } from './lib_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let classes = null;

function loadClasses() {
  if (classes) return classes;
  globalThis.window = globalThis.window || {};
  for (const file of ['js/deep16_tile_engine.js', 'js/deep16_pole_renderer.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  }
  classes = {
    Engine: vm.runInThisContext('Deep16TileEngine'),
    Pole: vm.runInThisContext('Deep16PoleRenderer'),
  };
  return classes;
}

export function scalePixels(rgba, width, height, scale) {
  if (scale === 1) return rgba;
  const out = new Uint8ClampedArray(width * scale * height * scale * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const dst = ((y * scale + dy) * width * scale + x * scale + dx) * 4;
          out[dst] = rgba[src];
          out[dst + 1] = rgba[src + 1];
          out[dst + 2] = rgba[src + 2];
          out[dst + 3] = rgba[src + 3];
        }
      }
    }
  }
  return out;
}

export function renderPoleScene(scene = 'curve', frames = 1, scale = 2) {
  const { Engine, Pole } = loadClasses();
  if (!Object.prototype.hasOwnProperty.call(Pole.scenes, scene)) {
    throw new Error(`unknown Pole scene: ${scene}`);
  }
  const engine = new Engine();
  const renderer = new Pole(engine, { scene });
  const images = [];
  for (let frame = 0; frame < frames; frame++) {
    if (frame > 0) renderer.advance(1 / 60);
    const rgba = renderer.renderFrame();
    images.push(scalePixels(rgba, engine.WIDTH, engine.HEIGHT, scale));
  }
  return {
    scene,
    width: engine.WIDTH * scale,
    height: engine.HEIGHT * scale,
    images,
    renderer,
    engine,
  };
}

function parseArgs(argv) {
  const opts = {
    scene: 'curve',
    frames: 1,
    scale: 2,
    out: path.join(ROOT, 'artifacts', 'pole'),
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--scene=')) opts.scene = arg.slice(8);
    else if (arg.startsWith('--frames=')) opts.frames = Number(arg.slice(9));
    else if (arg.startsWith('--scale=')) opts.scale = Number(arg.slice(8));
    else if (arg.startsWith('--out=')) opts.out = path.resolve(ROOT, arg.slice(6));
  }
  if (!Number.isInteger(opts.frames) || opts.frames < 1) throw new Error('--frames must be positive');
  if (!Number.isInteger(opts.scale) || opts.scale < 1) throw new Error('--scale must be positive');
  return opts;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('usage: node scripts/render_pole.mjs [--scene=straight|curve|hill|width|all] [--frames=N] [--scale=N] [--out=DIR]');
    process.exit(0);
  }
  const scenes = opts.scene === 'all' ? Object.keys(loadClasses().Pole.scenes) : [opts.scene];
  fs.mkdirSync(opts.out, { recursive: true });
  for (const scene of scenes) {
    const result = renderPoleScene(scene, opts.frames, opts.scale);
    for (let frame = 0; frame < result.images.length; frame++) {
      const file = path.join(opts.out, `${scene}-${frame}.png`);
      writePng(file, result.width, result.height, result.images[frame]);
      console.log(`wrote ${path.relative(ROOT, file)}`);
    }
    const state = result.renderer.state();
    console.log(`${scene}: ${state.stats.roadRows} road rows, horizon ${state.horizon.y.toFixed(1)}px, ` +
                `${state.stats.visibleOpponents} opponents, ${state.stats.changedCells}/${state.stats.tileWrites} cells changed`);
  }
}
