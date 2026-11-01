#!/usr/bin/env node
// scripts/render_tile.mjs - deterministic headless frames from the FiT engine.
//
// The scenes start at the showcase entries, drive 0xF0066 at a fixed number of
// instructions per frame, tick the engine and write PNGs. Graphics come from
// the flash asset blob, not a video ROM.
//
// Usage:
//   npm run render:tile                         # menu, 1 frame
//   npm run render:tile -- --scene=flappy --frames=6
//   npm run render:tile -- --scene=console --frames=1
//   npm run render:tile -- --scale=2 --out=artifacts/tile
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodePng, writePng } from './lib_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOWCASE_BASE = 0x4A00;
const G_START_MODE = 0x4D5;
const RET_PC = 0x0777;
const DEFAULT_STEPS = 0x1000;

let mods = null;

function loadModules() {
  if (mods) return mods;
  globalThis.window = globalThis.window || {};
  const files = [
    'js/deep16_assembler.js',
    'js/deep16_simulator.js',
    'js/deep16_flash_assets.js',
    'js/deep16_gfx_loader.js',
    'js/deep16_tile_engine.js',
    'js/deep16_d16d_image.js',
  ];
  for (const f of files) {
    const file = path.join(ROOT, f);
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: f });
  }
  mods = {
    Assembler: vm.runInThisContext('Deep16Assembler'),
    Simulator: vm.runInThisContext('Deep16Simulator'),
    Engine: vm.runInThisContext('Deep16TileEngine'),
    Assets: vm.runInThisContext('Deep16FlashAssets'),
    Loader: vm.runInThisContext('Deep16GfxLoader'),
    Builder: vm.runInThisContext('Deep16D16DImage'),
  };
  return mods;
}

function readSources() {
  return {
    kernel: fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
    showcase: fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'showcase.asm'), 'utf8'),
    flappy: fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'flappy_game.asm'), 'utf8'),
  };
}

// Start a scene. menu/flappy start at the showcase entries; console boots the
// nano kernel with its baked script disabled, exactly like the existing tests.
function boot(scene) {
  const { Assembler, Simulator, Engine, Assets, Loader, Builder } = loadModules();
  const src = readSources();
  const image = Builder.build({
    kernel: src.kernel,
    showcase: src.showcase,
    flappy: src.flappy,
    defines: scene === 'console' ? { D16SEG: 0 } : {},
  });
  const symbols = new Assembler().assemble(`${src.showcase}\n${src.flappy}`).symbols;

  const sim = new Simulator();
  sim.loadProgram(image.words);
  sim.d16nano = true;
  const engine = new Engine();
  Loader.load(engine, sim, Assets);
  sim.tileEngine = engine;
  sim.memory[0xF0066] = 0;
  sim.cycleCount = 0;

  if (scene === 'console') {
    sim.memory[image.symbols.boot_ptr] = 0;    // no baked Forth script
    sim.segmentRegisters = { CS: 0xFFFF, DS: 0, SS: 0, ES: 0 };
    sim.registers[15] = 0;
  } else {
    sim.segmentRegisters = { CS: 0x04A0, DS: 0x04A0, SS: 0, ES: 0 };
    sim.registers[12] = RET_PC;
    sim.memory[G_START_MODE] = scene === 'flappy' ? 1 : 0;
    sim.registers[15] = scene === 'flappy' ? symbols.start_play : symbols.menu_entry;
  }
  sim.running = true;
  return { sim, engine, symbols, image };
}

function scalePixels(rgba, width, height, scale) {
  if (scale === 1) return rgba;
  const out = new Uint8ClampedArray(width * scale * height * scale * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const dst = (((y * scale + dy) * width * scale) + x * scale + dx) * 4;
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

// Render one scene. Returns copies of the RGBA buffers; the engine's own buffer
// is reused, so callers can keep every frame.
export function renderScene({
  scene = 'menu',
  frames = scene === 'flappy' ? 4 : 1,
  stepsPerFrame = DEFAULT_STEPS,
  keys = [],
  warmup = null,
} = {}) {
  if (!['console', 'menu', 'flappy'].includes(scene)) throw new Error(`unknown scene: ${scene}`);
  const { sim, engine } = boot(scene);
  if (warmup === null) {
    warmup = scene === 'menu' ? 0x4000 : scene === 'console' ? 200000 : 0;
  }

  if (warmup > 0) {
    for (let i = 0; i < warmup && sim.running; i++) sim.step();
  }

  const out = [];
  for (let f = 0; f < frames; f++) {
    const status = ((f & 1) ? 2 : 0) | (keys[f] ? 8 : 0);
    sim.memory[0xF0066] = status;
    if (keys[f]) sim.uartRxPush(keys[f] & 0xFF);
    for (let i = 0; i < stepsPerFrame && sim.running; i++) sim.step();
    engine.tick();
    out.push(new Uint8ClampedArray(engine.render()));
  }
  return { scene, width: engine.WIDTH, height: engine.HEIGHT, frames: out, sim, engine };
}

function parseArgs(argv) {
  const opts = {
    scene: 'menu',
    frames: null,
    steps: DEFAULT_STEPS,
    scale: 1,
    out: path.join(ROOT, 'artifacts', 'tile'),
    keys: [],
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--scene=')) opts.scene = arg.slice(8);
    else if (arg.startsWith('--frames=')) opts.frames = Number(arg.slice(9));
    else if (arg.startsWith('--steps=')) opts.steps = Number(arg.slice(8));
    else if (arg.startsWith('--scale=')) opts.scale = Number(arg.slice(8));
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6);
    else if (arg.startsWith('--key=')) opts.keys.push(Number(arg.slice(6)) & 0xFF);
    else if (arg === '--help') opts.help = true;
  }
  return opts;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('usage: node scripts/render_tile.mjs [--scene=menu|flappy|console] [--frames=N] [--steps=N] [--scale=N] [--key=BYTE] [--out=DIR]');
    process.exit(0);
  }
  const frames = opts.frames ?? (opts.scene === 'flappy' ? 4 : 1);
  const result = renderScene({
    scene: opts.scene,
    frames,
    stepsPerFrame: opts.steps,
    keys: opts.keys,
    warmup: opts.scene === 'console' ? 200000 : null,
  });
  fs.mkdirSync(opts.out, { recursive: true });
  for (let f = 0; f < result.frames.length; f++) {
    const rgba = scalePixels(result.frames[f], result.width, result.height, opts.scale);
    const file = path.join(opts.out, `${result.scene}-${f}.png`);
    writePng(file, result.width * opts.scale, result.height * opts.scale, rgba);
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }
  console.log(`scene ${result.scene}: ${result.frames.length} frame(s), ${result.width}x${result.height}`);
}

export { encodePng, writePng, scalePixels, DEFAULT_STEPS, SHOWCASE_BASE };
