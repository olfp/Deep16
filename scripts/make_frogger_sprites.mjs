#!/usr/bin/env node
// scripts/make_frogger_sprites.mjs - the game's 32x32 sprite frames as a pack
// carried in its config-flash slice.
//
// A pack sits at SPR_PACK_OFFSET in the game's segment:
//   word 0  SPR_MAGIC
//   word 1  group count
//   then per group: the sprite-bank group index, followed by its 256 words
//   (16 8x8 patterns: tile = (row >> 3) * 4 + (col >> 3), 16 words each).
//
// The frames come from the same sheet as the tiles; sprite index 0 is the
// transparent colour, so every pixel is drawn in the shared art palette.
import { decodePng } from './lib_png.mjs';
import { fitArt } from './make_frogger_art.mjs';

export const SPR_PACK_OFFSET = 0x2000;
export const SPR_MAGIC = 0x0a58;

const SHEET = new URL('../assets/art/frogger/sprites-sheet.png', import.meta.url);

// The sheet's frog poses, top to bottom: crouched idle, arms up, full stretch,
// and a spread landing. The fly is the insect from the same sheet.  Groups 0/2
// face up the screen; 1/3 are the same poses rotated to face right (the OAM
// H flip gives left), and the squash, home frog and fly follow.
const FRAMES = [
  { group: 0, box: [1, 31, 51, 36] },               // idle, faces up
  { group: 1, box: [1, 31, 51, 36], side: true },   // idle, faces right
  { group: 2, box: [230, 2, 54, 74] },              // hop, faces up
  { group: 3, box: [230, 2, 54, 74], side: true },  // hop, faces right
  { group: 4, box: [54, 29, 58, 41] },              // squash / landing
  { group: 5, box: [344, 31, 51, 36] },             // home frog
  { group: 6, box: [84, 172, 43, 47] },             // fly
];

// The upright 30x28 art: the sheet draws every frog with its head toward the
// bottom of the box, so the grid is flipped vertically to face up.
function upright(img, [x, y, w, h]) {
  const art = fitArt(img, { x0: x, y0: y, w, h }, 30, 28, 0);
  return Array.from({ length: 28 }, (_, row) => art[27 - row]);
}

// Rotate the upright art 90 degrees clockwise (head to the right), then
// resample it into the same 30x28 footprint so both facings sit identically.
function side(art) {
  const turned = [];
  for (let y = 0; y < 30; y++) {
    const row = [];
    for (let x = 0; x < 28; x++) row.push(art[27 - x][y]);
    turned.push(row);
  }
  const out = [];
  for (let y = 0; y < 28; y++) {
    const row = [];
    for (let x = 0; x < 30; x++) {
      row.push(turned[Math.min(29, Math.floor((y * 30) / 28))]
        [Math.min(27, Math.floor((x * 28) / 30))]);
    }
    out.push(row);
  }
  return out;
}

// One 32x32 indexed frame: 30x28 of art centred with a one-pixel margin.
function frame(img, box, sideways = false) {
  const art = sideways ? side(upright(img, box)) : upright(img, box);
  const grid = [];
  for (let gy = 0; gy < 32; gy++) {
    const row = [];
    for (let gx = 0; gx < 32; gx++) {
      const u = gx - 1;
      const v = gy - 2;
      row.push(u >= 0 && v >= 0 && u < 30 && v < 28 ? art[v][u] : 0);
    }
    grid.push(row);
  }
  return grid;
}

function frameWords(grid) {
  const words = [];
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      for (let row = 0; row < 8; row++) {
        for (let half = 0; half < 2; half++) {
          let w = 0;
          for (let n = 0; n < 4; n++) {
            const x = tx * 8 + half * 4 + n;
            const y = ty * 8 + row;
            w |= (grid[y][x] & 0xf) << (n * 4);
          }
          words.push(w & 0xffff);
        }
      }
    }
  }
  return words;
}

export function froggerSpriteFrames() {
  const img = decodePng(SHEET);
  return FRAMES.map(({ group, box, side: sideways }) => ({ group, grid: frame(img, box, sideways) }));
}

export function froggerSpritePack() {
  const frames = froggerSpriteFrames();
  const words = [SPR_MAGIC, frames.length];
  for (const { group, grid } of frames) {
    words.push(group & 0xffff);
    words.push(...frameWords(grid));
  }
  return words;
}
