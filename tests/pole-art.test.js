// Milestone-3 checks for the Pole art pipeline.
//
// The art is the source of truth for what the board shows: the tile bank, the
// sprite bank and the palettes. The board has no rectangles and no scaler,
// so the shapes have to exist in the FiT's own formats, and the slice has to
// carry them and copy them into the banks before the first frame.
//
// These checks tie the art to the renderer: the model's sprite groups have to
// match the groups the art draws, and the copy routine has to put the art
// where the hardware looks for it - without touching the console font or the
// bird sprite, which the bitstream owns.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadBrowserScripts, ROOT } from './helpers.js';
import { assemblePoleBoard } from '../scripts/pole_program.mjs';
import { buildPole, checkPole } from '../scripts/make_showcase.mjs';
import {
  TILE, SCALES, PLAYER_GROUP, PLAYER_GROUP_RIGHT, MODEL_GROUPS,
  widePlayerGrid, WIDE_CAR_H,
  ART_OFFSETS, ART_DESTINATIONS,
  TILE_COLORS, SPRITE_COLORS, TILE_PALETTE, SPRITE_PALETTE,
  poleTileGrids, poleSpriteGrids, poleTileWords, poleSpriteWords, polePaletteWords,
  tileWords, spriteWords, carGrid, scaleGrid,
} from '../scripts/make_pole_art.mjs';

loadBrowserScripts('js/deep16_simulator.js', 'js/deep16_pole_model.js');

const Sim = globalThis.Deep16Simulator;
const Model = globalThis.Deep16PoleModel;

// The segment the board program is loaded into. 0x7000 is free in the D16D
// segment map (MEMMAP.md).
const SEG = 0x7000;
const BASE = SEG << 4;

// The hardware windows the art lands in.
const TILE_BANK = 0xF3000;
const SPRITE_BANK = 0xF4000;
const PALETTE = 0xF6080;

// Run the board program on the JS core with the art in the slice.
function runBoard() {
  const res = assemblePoleBoard({ POLE_FAST: 1 });
  assert.equal(res.success, true, res.errors.join('; '));
  const memory = new Array(1048576).fill(0xFFFF);
  for (const change of res.memoryChanges) {
    memory[BASE + change.address] = change.value & 0xFFFF;
  }
  // The slice carries the art: the build puts it at the same offsets.
  const blocks = [
    [ART_OFFSETS.TILE, poleTileWords()],
    [ART_OFFSETS.SPRITE, poleSpriteWords()],
    [ART_OFFSETS.PALETTE, polePaletteWords()],
  ];
  for (const [base, words] of blocks) {
    for (let i = 0; i < words.length; i++) memory[BASE + base + i] = words[i] & 0xFFFF;
  }
  const sim = new Sim();
  sim.loadProgram(memory);
  sim.d16nano = true;
  sim.segmentRegisters.CS = SEG;
  sim.segmentRegisters.DS = SEG;
  sim.registers[10] = 0x0000;
  sim.registers[11] = 0x07F0;
  sim.registers[15] = 0x0000;
  sim.running = true;
  // The harness restores the saved lowercase font before it returns to the
  // console, which overwrites the art tiles again. Stop at the restore so the
  // copy can be inspected.
  const restore = res.symbols.pole_font_restore;
  let steps = 0;
  let stoppedAtRestore = false;
  while (sim.running && steps < 8000000) {
    if (restore !== undefined && sim.segmentRegisters.CS === SEG
        && sim.registers[15] === restore) {
      stoppedAtRestore = true;
      break;
    }
    sim.step();
    steps++;
  }
  assert.ok(stoppedAtRestore || !sim.running,
    `the board program did not halt or reach the restore (${steps} steps)`);
  return { sim, steps };
}

test('the tile art fills the 64 art slots in bank order', () => {
  const grids = poleTileGrids();
  assert.equal(grids.length, 64, 'the art area is 64 tiles');
  grids.forEach((tile, i) => {
    assert.equal(tile.index, TILE.SKY + i,
      `tile ${i} is slot ${tile.index}, the bank order has to be the slot order`);
  });
  const words = poleTileWords();
  assert.equal(words.length, 64 * 32, '64 tiles of 32 words');
  // The words have to decode back into the grids they came from.
  grids.forEach((tile, i) => {
    assert.deepEqual(words.slice(i * 32, i * 32 + 32), tileWords(tile.grid),
      `tile ${tile.index} does not round-trip`);
  });
});

test('the sprite art covers the player and the four models', () => {
  const groups = poleSpriteGrids();
  assert.equal(groups.length, 18, 'two player halves plus four models of four bins');
  assert.equal(groups[0].group, PLAYER_GROUP, 'the player left half is group 0');
  assert.equal(groups[17].group, PLAYER_GROUP_RIGHT, 'the player right half is group 17');
  groups.forEach((entry, i) => {
    assert.equal(entry.group, i, 'the groups have to be contiguous from 0');
  });
  const words = poleSpriteWords();
  assert.equal(words.length, 18 * 256, '18 groups of 256 words');
  groups.forEach((entry, i) => {
    assert.deepEqual(words.slice(i * 256, i * 256 + 256), spriteWords(entry.grid),
      `group ${entry.group} does not round-trip`);
  });
});

test('the model and the art agree on the sprite groups', () => {
  // The renderer asks for a group by model and scale bin, so the model's
  // table and the art's layout have to be the same numbers.
  assert.deepEqual([...Model.SPRITE_GROUPS], [...MODEL_GROUPS],
    'the model and the art disagree about the sprite groups');
  assert.equal(Model.SPRITE_GROUPS.length, 4, 'four car models');
  // Every model owns four scale bins and they must not overlap.
  const used = new Set();
  Model.SPRITE_GROUPS.forEach((base, model) => {
    for (let bin = 0; bin < SCALES.length; bin++) {
      const group = base + bin;
      assert.ok(!used.has(group), `group ${group} is used twice`);
      used.add(group);
      assert.ok(group > 0, 'group 0 belongs to the player');
    }
  });
  assert.equal(used.size, 16, 'the models own 16 groups');
});

test('the player car is two halves of one 64x32 grid', () => {
  const wide = widePlayerGrid();
  assert.equal(wide.length, WIDE_CAR_H, '32 rows');
  assert.equal(wide[0].length, 64, '64 columns');
  const groups = poleSpriteGrids();
  const left = groups.find((g) => g.group === PLAYER_GROUP).grid;
  const right = groups.find((g) => g.group === PLAYER_GROUP_RIGHT).grid;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      assert.equal(left[y][x], wide[y][x], `left half ${x},${y}`);
      assert.equal(right[y][x], wide[y][32 + x], `right half ${x},${y}`);
    }
  }
  // The painted car fills most of the 56-pixel content box, so the two
  // sprites read as one wide car rather than two floating halves.
  let min = 64;
  let max = -1;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 64; x++) {
      if (wide[y][x] === SPRITE_COLORS.TRANSPARENT) continue;
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
  }
  assert.ok(min <= 4 && max >= 59, `the car spans x ${min}..${max}`);
});

test('the scale bins are the sizes the renderer places the cars at', () => {
  assert.deepEqual([...Model.SPRITE_W], SCALES.map((s) => s.width));
  assert.deepEqual([...Model.SPRITE_H], SCALES.map((s) => s.height));
});

test('the palette is three banks of sixteen entries', () => {
  const words = polePaletteWords();
  assert.equal(words.length, 48, 'the text, art and sprite banks');
  // The text bank: the background and the text colour.
  assert.ok(words[0] !== 0, 'the text background is not black');
  assert.ok(words[1] !== 0, 'the text colour is not black');
  for (let i = 2; i < 16; i++) assert.equal(words[i], 0, 'the spare text entries are clear');
  assert.deepEqual(words.slice(16, 32), [...TILE_PALETTE]);
  assert.deepEqual(words.slice(32, 48), [...SPRITE_PALETTE]);
});

test('the car art fits its box and keeps its shape when it is scaled', () => {
  const car = carGrid({ body: 1, shade: 2, glass: 5 }, true);
  // The car is 28x22 in the top-left corner of the 32x32 group.
  let painted = 0;
  for (let y = 0; y < 22; y++) {
    for (let x = 0; x < 28; x++) {
      if (car[y][x] !== SPRITE_COLORS.TRANSPARENT) painted++;
    }
  }
  assert.ok(painted > 28 * 10, 'the car is too thin to read');
  for (let y = 22; y < 32; y++) {
    for (let x = 0; x < 32; x++) assert.equal(car[y][x], SPRITE_COLORS.TRANSPARENT);
  }
  // The player's stripe is on the car.
  assert.equal(car[10][13], SPRITE_COLORS.WHITE);
  // Every scale bin keeps its art inside the box.
  for (const scale of SCALES) {
    const small = scaleGrid(car, scale.width, scale.height);
    for (let y = scale.height; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        assert.equal(small[y][x], SPRITE_COLORS.TRANSPARENT,
          `the ${scale.width}x${scale.height} car spills out of its box`);
      }
    }
    for (let y = 0; y < scale.height; y++) {
      for (let x = scale.width; x < 32; x++) {
        assert.equal(small[y][x], SPRITE_COLORS.TRANSPARENT,
          `the ${scale.width}x${scale.height} car spills out of its box`);
      }
    }
  }
});

test('the slice carries the art at the offsets the copy routine reads', () => {
  const pole = buildPole();
  checkPole(pole);
  const at = (address) => pole.words.find(([a]) => a === address)?.[1];
  const tileWords = poleTileWords();
  assert.equal(at(ART_OFFSETS.TILE), tileWords[0] & 0xFFFF);
  assert.equal(at(ART_OFFSETS.TILE + tileWords.length - 1),
               tileWords[tileWords.length - 1] & 0xFFFF);
  const spriteWords = poleSpriteWords();
  assert.equal(at(ART_OFFSETS.SPRITE), spriteWords[0] & 0xFFFF);
  assert.equal(at(ART_OFFSETS.SPRITE + spriteWords.length - 1),
               spriteWords[spriteWords.length - 1] & 0xFFFF);
  const palette = polePaletteWords();
  assert.equal(at(ART_OFFSETS.PALETTE), palette[0] & 0xFFFF);
  // The art copy has to be in the image, at the address the driver calls.
  assert.ok(fs.existsSync(path.join(ROOT, 'asm/pole/pole_art.asm')));
});

test('the copy routine puts the art where the hardware looks for it', () => {
  const { sim } = runBoard();
  const check = (destination, words, name) => {
    for (let i = 0; i < words.length; i++) {
      const got = sim.memory[destination + i] & 0xFFFF;
      assert.equal(got, words[i] & 0xFFFF, `${name} word ${i} is wrong`);
    }
  };
  check(ART_DESTINATIONS.TILE, poleTileWords(), 'the tile bank');
  check(ART_DESTINATIONS.SPRITE, poleSpriteWords(), 'the sprite bank');
  check(ART_DESTINATIONS.PALETTE, polePaletteWords(), 'the palette');

  // The destinations are the ones the renderer and the OAM use.
  assert.equal(ART_DESTINATIONS.TILE, TILE_BANK + TILE.SKY * 32,
    'the art tiles have to start at tile 64');
  assert.equal(ART_DESTINATIONS.SPRITE, SPRITE_BANK, 'the groups start at 0');
  assert.equal(ART_DESTINATIONS.PALETTE, PALETTE, 'the palettes start at set 0, bank 0');
});

test('the copy leaves the console font and the bird sprite alone', () => {
  const { sim } = runBoard();
  // The console font is baked into the bitstream in tiles 0..63; the art
  // overwrites 64..127 and saves/restores 64..95.
  for (let i = 0; i < TILE.SKY * 32; i++) {
    assert.equal(sim.memory[TILE_BANK + i] & 0xFFFF, 0xFFFF,
      `the copy wrote into the font at word ${i}`);
  }
  // The bird sprite is baked in at group 24.
  for (let i = 0; i < 256; i++) {
    assert.equal(sim.memory[SPRITE_BANK + 24 * 256 + i] & 0xFFFF, 0xFFFF,
      `the copy wrote into the bird sprite at word ${i}`);
  }
});

test('the renderer points at the art the slice carries', () => {
  // Every tile the model writes has to be one of the art tiles, or the
  // screen shows whatever was in the bank before.
  const state = Model.defaultState('curve');
  const frame = Model.render(state);
  const artTiles = new Set(poleTileGrids().map((t) => t.index));
  const seen = new Set();
  for (const cell of frame.cells) {
    const tile = (cell >> 5) & 0x7F;
    seen.add(tile);
  }
  for (const tile of seen) {
    assert.ok(artTiles.has(tile), `the renderer uses tile ${tile}, which the art does not draw`);
  }
  // The opponents point at groups the art draws.
  const artGroups = new Set(poleSpriteGrids().map((g) => g.group));
  for (let i = 0; i < 16; i += 2) {
    const w1 = frame.oam[i + 1];
    if (w1 === 0) continue;                     // a disabled sprite
    const group = (w1 >> 11) & 0x1F;
    assert.ok(artGroups.has(group), `the renderer uses sprite group ${group}, which the art does not draw`);
  }
});
