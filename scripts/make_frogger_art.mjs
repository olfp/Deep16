#!/usr/bin/env node
// scripts/make_frogger_art.mjs - the Frogger backdrop's tile art.
//
// The backdrop draws 24x30 game cells, i.e. three 8x15 tiles wide and two tile
// rows tall.  The objects come from the single sprite sheet in
// assets/art/frogger/sprites-sheet.png: each is cropped to its box, area
// filtered down to at most 24 px wide (so a car or truck leaves room in its
// lane), mirrored when the lane runs left, and centred in the cell.  The water,
// road, ground and bar tiles are composed from the same 16-colour palette.
//
// Tiles live in the free font gap 57..95 plus 126/127; the demo installs the
// palette in palette set 2's art bank at run time.
import { decodePng } from './lib_png.mjs';

// Palette set 2, art bank (16 RGB332 entries).  Entry 0 is the panel colour
// the blank tile 0 shows.
export const FROGGER_PALETTE = [
  0x49, // 0  panel
  0x00, // 1  black
  0xFF, // 2  white
  0xFE, // 3  cream
  0xD8, // 4  light grey
  0xE0, // 5  red
  0xCC, // 6  orange
  0x60, // 7  dark brown
  0x84, // 8  mid brown
  0xF8, // 9  yellow
  0x92, // 10 mid grey
  0x10, // 11 green (grass)
  0x0C, // 12 dark green
  0x3F, // 13 aqua (water)
  0x0A, // 14 blue
  0x33, // 15 light blue
];

const I = {
  panel: 0, black: 1, white: 2, cream: 3, lightGrey: 4, red: 5, orange: 6,
  darkBrown: 7, midBrown: 8, yellow: 9, midGrey: 10, green: 11,
  darkGreen: 12, aqua: 13, blue: 14, lightBlue: 15,
};

// Tile slots.  57..95 is the free font gap (Pac-Man keeps 49..56, Flappy
// 96..109 and Pac-Man 110..125); 126/127 are the last two baked slots.
export const FROGGER_TILES = {
  water: 57,
  road: 58,
  roadLine: 59,
  log: 60,
  turtle: 66,
  carBlue: 72,
  carYellow: 78,
  fireTruck: 84,
  truck: 90,
  grass: 126,
  bar: 127,
};

const SHEET = new URL('../assets/art/frogger/sprites-sheet.png', import.meta.url);

// RGB332 byte -> the RGB the engine draws.
const expand = (v) => {
  const r3 = (v >> 5) & 7, g3 = (v >> 2) & 7, b2 = v & 3;
  return [(r3 << 5) | (r3 << 2) | (r3 & 3), (g3 << 5) | (g3 << 2) | (g3 & 3), b2 * 0x55];
};
const PAL = FROGGER_PALETTE.map(expand);

function nearest(r, g, b) {
  let best = 1, bestD = Infinity;
  for (let i = 1; i < PAL.length; i++) {
    const [pr, pg, pb] = PAL[i];
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Area-filter a source box down to w x h and map it onto the palette.  Pixels
// whose average coverage is under half become `bg`.
function sample(img, box, w, h, bg, mirror = false) {
  const grid = [];
  for (let dy = 0; dy < h; dy++) {
    const row = [];
    const y0 = box.y + (dy * box.h) / h;
    const y1 = box.y + ((dy + 1) * box.h) / h;
    for (let dx = 0; dx < w; dx++) {
      const sx = mirror ? w - 1 - dx : dx;
      const x0 = box.x + (sx * box.w) / w;
      const x1 = box.x + ((sx + 1) * box.w) / w;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const o = (y * img.width + x) * 4;
          const alpha = img.rgba[o + 3] / 255;
          r += img.rgba[o] * alpha;
          g += img.rgba[o + 1] * alpha;
          b += img.rgba[o + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      if (!n || a / n < 0.4) row.push(bg);
      else row.push(nearest(r / a, g / a, b / a));
    }
    grid.push(row);
  }
  return grid;
}

// A w x h grid centred in the 24x30 object cell.
function inCell(grid, w, h, bg) {
  const ox = Math.floor((24 - w) / 2);
  const oy = Math.floor((30 - h) / 2);
  const cell = [];
  for (let y = 0; y < 30; y++) {
    const row = [];
    for (let x = 0; x < 24; x++) {
      const u = x - ox, v = y - oy;
      row.push(u >= 0 && v >= 0 && u < w && v < h ? grid[v][u] : bg);
    }
    cell.push(row);
  }
  return cell;
}

// 24x30 -> six 8x15 tiles: 0..2 are the top row, 3..5 the bottom row.
function sliceTiles(cell) {
  const tiles = [];
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 3; tx++) {
      const tile = [];
      for (let y = 0; y < 15; y++) tile.push(cell[ty * 15 + y].slice(tx * 8, tx * 8 + 8));
      tiles.push(tile);
    }
  }
  return tiles;
}

function waterTile() {
  const dashes = [[2, 1, 4], [7, 4, 3], [12, 0, 5]];
  const grid = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) {
      const wave = dashes.some(([wy, wx, len]) => y === wy && x >= wx && x < wx + len);
      row.push(wave ? I.white : I.aqua);
    }
    grid.push(row);
  }
  return grid;
}

const GRIT = [[2, 4], [6, 10]];
function roadTile(line) {
  const grid = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) {
      let p = GRIT.some(([gx, gy]) => gx === x && gy === y) ? I.midGrey : I.black;
      if (line && y === 14) p = x < 4 ? I.white : I.black;
      row.push(p);
    }
    grid.push(row);
  }
  return grid;
}

function grassTile() {
  const grid = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) {
      const dark = ((x * 3 + y * 5) % 11) === 0 || ((x + y * 2) % 17) === 0;
      row.push(dark ? I.darkGreen : I.green);
    }
    grid.push(row);
  }
  return grid;
}

function barTile() {
  const grid = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) row.push(y === 0 ? I.white : y === 14 ? I.red : I.yellow);
    grid.push(row);
  }
  return grid;
}

export function froggerArtTiles() {
  const img = decodePng(SHEET);
  const box = (x, y, w, h) => ({ x, y, w, h });
  const obj = (boxed, w, h, bg, mirror = false) =>
    sliceTiles(inCell(sample(img, boxed, w, h, bg, mirror), w, h, bg));

  const LOG_CAP = box(14, 258, 60, 59);        // rounded end of the long log
  const TURTLE = box(403, 11, 71, 56);
  const CAR_BLUE = box(12, 484, 127, 67);
  const CAR_YELLOW = box(305, 483, 134, 70);
  const FIRE = box(9, 407, 178, 65);
  const TRUCK = box(353, 406, 133, 66);        // cab plus the trailer's tail

  // A log whose two ends are the pack's rounded cap, mirrored.
  const cap = sample(img, LOG_CAP, 12, 12, I.aqua);
  const log = cap.map((row) => [...row, ...[...row].reverse()]);

  const entries = [
    [FROGGER_TILES.water, waterTile()],
    [FROGGER_TILES.road, roadTile(false)],
    [FROGGER_TILES.roadLine, roadTile(true)],
    [FROGGER_TILES.grass, grassTile()],
    [FROGGER_TILES.bar, barTile()],
    ...sliceTiles(inCell(log, 24, 12, I.aqua)).map((grid, i) => [FROGGER_TILES.log + i, grid]),
    ...obj(TURTLE, 24, 19, I.aqua, true).map((grid, i) => [FROGGER_TILES.turtle + i, grid]),
    ...obj(CAR_BLUE, 24, 13, I.black).map((grid, i) => [FROGGER_TILES.carBlue + i, grid]),
    ...obj(CAR_YELLOW, 24, 13, I.black).map((grid, i) => [FROGGER_TILES.carYellow + i, grid]),
    ...obj(FIRE, 24, 9, I.black, true).map((grid, i) => [FROGGER_TILES.fireTruck + i, grid]),
    ...obj(TRUCK, 24, 12, I.black, true).map((grid, i) => [FROGGER_TILES.truck + i, grid]),
  ];
  return entries.map(([index, grid]) => ({ index, grid }));
}
