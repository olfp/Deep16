#!/usr/bin/env node
// scripts/make_frogger_art.mjs - the Frogger backdrop's tile art.
//
// The backdrop draws game cells of 32x30 (four 8x15 tiles) for the cars and
// turtle, 48x30 for the fire truck and 64x30 for the truck.  A log is drawn
// from three parts - a two-tile rounded left cap, a one-tile middle and a
// mirrored right cap - so a log of any length costs the same ten tiles.
//
// The objects come from the single sprite sheet in
// assets/art/frogger/sprites-sheet.png: each is cropped to its box, area
// filtered, mirrored when its lane runs left, and centred in its cell.  The
// water, road, ground and bar tiles are composed from the same 16-colour
// palette.
//
// Tiles live in 57..120 plus 126/127, so the last objects take Flappy's art
// tiles and part of Pac-Man's; the demo installs the palette in palette set
// 2's art bank at run time.
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
  0x0F, // 13 blue (water)
  0x0A, // 14 deep blue
  0x33, // 15 light blue
];

const I = {
  panel: 0, black: 1, white: 2, cream: 3, lightGrey: 4, red: 5, orange: 6,
  darkBrown: 7, midBrown: 8, yellow: 9, midGrey: 10, green: 11,
  darkGreen: 12, water: 13, blue: 14, lightBlue: 15,
};

// 57..106 is the free gap plus Flappy's art; the fire truck and the truck
// need more, so they also take Pac-Man's 110..120.  126/127 are the last two
// baked slots.
export const FROGGER_TILES = {
  water: 57,
  road: 58,
  log: 59,
  turtle: 69,
  carBlue: 77,
  carYellow: 85,
  fireTruck: 93,
  truck: 105,
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

function load(name) {
  return decodePng(name instanceof URL ? name : new URL(name, SHEET));
}

// Opaque bounding box of a decoded png.
function opaqueBox(img) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.rgba[(y * img.width + x) * 4 + 3] < 128) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Stretch a box of the sheet to exactly w x h, background `bg`, optionally
// mirrored left to right.
function fit(img, box, w, h, bg, mirror = false) {
  const grid = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    const sy = box.y0 + Math.min(box.h - 1, Math.floor((y * box.h) / h));
    for (let x = 0; x < w; x++) {
      const sx = box.x0 + Math.min(box.w - 1, Math.floor(((mirror ? w - 1 - x : x) * box.w) / w));
      const o = (sy * img.width + sx) * 4;
      row.push(img.rgba[o + 3] < 128 ? bg : nearest(img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]));
    }
    grid.push(row);
  }
  return grid;
}

// Place a w x h grid at (ox, oy) in a cols*8 x 30 cell.
function inCell(grid, w, h, cols, ox, oy, bg) {
  const cell = [];
  for (let y = 0; y < 30; y++) {
    const row = [];
    for (let x = 0; x < cols * 8; x++) {
      const u = x - ox, v = y - oy;
      row.push(u >= 0 && v >= 0 && u < w && v < h ? grid[v][u] : bg);
    }
    cell.push(row);
  }
  return cell;
}

// cols*8 x 30 -> cols*2 8x15 tiles: the first cols are the top row.
function sliceTiles(cell, cols) {
  const tiles = [];
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const tile = [];
      for (let y = 0; y < 15; y++) tile.push(cell[ty * 15 + y].slice(tx * 8, tx * 8 + 8));
      tiles.push(tile);
    }
  }
  return tiles;
}

// One object of `cols` cells, `w` x `h` art centred in the cell.
function objectTiles(img, box, cols, w, h, bg, mirror = false) {
  const art = fit(img, box, w, h, bg, mirror);
  const ox = Math.floor((cols * 8 - w) / 2);
  const oy = Math.floor((30 - h) / 2);
  return sliceTiles(inCell(art, w, h, cols, ox, oy, bg), cols);
}

// Water ripples on the blue base.
function waterTile() {
  const dashes = [[2, 1, 4], [7, 4, 3], [12, 0, 5]];
  const grid = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) {
      const wave = dashes.some(([wy, wx, len]) => y === wy && x >= wx && x < wx + len);
      row.push(wave ? I.white : I.water);
    }
    grid.push(row);
  }
  return grid;
}

const GRIT = [[2, 4], [6, 10]];
function roadTile() {
  const grid = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) {
      row.push(GRIT.some(([gx, gy]) => gx === x && gy === y) ? I.midGrey : I.black);
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
  const img = load(SHEET);
  const obox = (x, y, w, h) => ({ x0: x, y0: y, w, h });

  const LOG_END = obox(14, 258, 30, 59);        // rounded left end of the log
  const LOG_MID = obox(120, 258, 40, 59);       // a plain middle slice
  const TURTLE = obox(403, 11, 71, 56);
  const CAR_BLUE = obox(12, 484, 127, 67);
  const CAR_YELLOW = obox(305, 483, 134, 70);
  const FIRE = obox(9, 407, 178, 65);
  const TRUCK = obox(203, 406, 284, 66);        // the whole truck

  // Log: 16x18 cap, 8x18 middle, mirrored cap; five tiles per row.
  const capL = fit(img, LOG_END, 16, 18, I.water);
  const middle = fit(img, LOG_MID, 8, 18, I.water);
  const logCell = [];
  for (let y = 0; y < 30; y++) {
    const row = [];
    for (let x = 0; x < 40; x++) {
      const v = y - 6;
      if (v < 0 || v >= 18) { row.push(I.water); continue; }
      if (x < 16) row.push(capL[v][x]);
      else if (x < 24) row.push(middle[v][x - 16]);
      else row.push(capL[v][15 - (x - 24)]);
    }
    logCell.push(row);
  }

  const entries = [
    [FROGGER_TILES.water, waterTile()],
    [FROGGER_TILES.road, roadTile()],
    [FROGGER_TILES.grass, grassTile()],
    [FROGGER_TILES.bar, barTile()],
    ...sliceTiles(logCell, 5).map((grid, i) => [FROGGER_TILES.log + i, grid]),
    ...objectTiles(img, TURTLE, 4, 26, 20, I.water, true).map((grid, i) => [FROGGER_TILES.turtle + i, grid]),
    ...objectTiles(img, CAR_BLUE, 4, 26, 20, I.black).map((grid, i) => [FROGGER_TILES.carBlue + i, grid]),
    ...objectTiles(img, CAR_YELLOW, 4, 26, 20, I.black).map((grid, i) => [FROGGER_TILES.carYellow + i, grid]),
    ...objectTiles(img, FIRE, 6, 42, 20, I.black, true).map((grid, i) => [FROGGER_TILES.fireTruck + i, grid]),
    ...objectTiles(img, TRUCK, 8, 56, 20, I.black, true).map((grid, i) => [FROGGER_TILES.truck + i, grid]),
  ];
  return entries.map(([index, grid]) => ({ index, grid }));
}
