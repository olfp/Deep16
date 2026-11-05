#!/usr/bin/env node
// scripts/make_frogger_art.mjs - the Frogger backdrop's tile art.
//
// The backdrop draws 32x30 game cells, i.e. four 8x15 tiles wide and two tile
// rows tall.  The objects come from the 16x16 pixel-art pack in
// assets/art/frogger (top-down cars, a log and a turtle).  Each object is
// cropped to its opaque box, scaled with one factor so it fits the cell and
// centred in it, so the pack's pixels stay square.  The water, road, grass and
// time-bar tiles are composed from the same 16-colour palette.
//
// Tiles live in the free font gap 57..95 and the demo installs the palette in
// palette set 2's art bank at run time.
import { decodePng } from './lib_png.mjs';

// Palette set 2, art bank (16 RGB332 entries).  Entry 0 is the panel colour
// the blank tile 0 shows; the rest are the pack's own ten colours plus water,
// bar and the road line.
export const FROGGER_PALETTE = [
  0x49, // 0  panel
  0x00, // 1  black
  0x25, // 2  navy
  0x2C, // 3  dark green (grass)
  0x44, // 4  dark purple (road)
  0x74, // 5  green
  0x7B, // 6  cyan
  0x88, // 7  brown
  0x92, // 8  grey
  0xC9, // 9  red
  0xD6, // 10 tan
  0x03, // 11 blue (water)
  0xFC, // 12 yellow (time bar)
  0xFF, // 13 white (road line)
  0x02, // 14 deep blue (water ripple)
  0xDF, // 15 pale green highlight
];

const I = {
  panel: 0, black: 1, navy: 2, grass: 3, road: 4, green: 5, cyan: 6,
  brown: 7, grey: 8, red: 9, tan: 10, water: 11, yellow: 12, white: 13,
  deep: 14,
};

// Tile slots: 57..62 were the old flat colours and stay reserved for this
// demo; 96.. is Flappy's pack and Pac-Man's slots.
export const FROGGER_TILES = {
  water: 57,
  waterB: 58,
  road: 59,
  roadLine: 60,
  grass: 61,
  grassB: 62,
  bar: 63,
  log: 64,
  carRight: 72,
  carLeft: 80,
  turtle: 88,
};

const ASSET = (name) => new URL(`../assets/art/frogger/${name}`, import.meta.url);

// Source RGB -> palette index.  The pack is drawn in ten flat colours; every
// one of them is already in the palette above.
const rgb332 = (r, g, b) => ((r >> 5) << 5) | ((g >> 5) << 2) | (b >> 6);
const INDEX_OF = new Map(FROGGER_PALETTE.map((v, i) => [v, i]));

function indexOfColour(r, g, b) {
  const key = rgb332(r, g, b);
  const i = INDEX_OF.get(key);
  if (i === undefined) throw new Error(`colour ${r},${g},${b} (0x${key.toString(16)}) is not in the palette`);
  return i;
}

function load(name) {
  return decodePng(ASSET(name));
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

// Fit the opaque box into width x height with one scale factor, centre it and
// fill the rest with the lane colour `bg`.
function fit(img, width, height, bg) {
  const box = opaqueBox(img);
  const scale = Math.min(width / box.w, height / box.h);
  const w = Math.max(1, Math.round(box.w * scale));
  const h = Math.max(1, Math.round(box.h * scale));
  const ox = Math.floor((width - w) / 2);
  const oy = Math.floor((height - h) / 2);
  const grid = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const u = x - ox;
      const v = y - oy;
      if (u < 0 || v < 0 || u >= w || v >= h) {
        row.push(bg);
        continue;
      }
      const sx = box.x0 + Math.min(box.w - 1, Math.floor((u * box.w) / w));
      const sy = box.y0 + Math.min(box.h - 1, Math.floor((v * box.h) / h));
      const o = (sy * img.width + sx) * 4;
      row.push(img.rgba[o + 3] < 128 ? bg : indexOfColour(img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]));
    }
    grid.push(row);
  }
  return grid;
}

// 32x30 -> eight 8x15 tiles: tiles 0..3 are the top row, 4..7 the bottom row.
function sliceTiles(grid) {
  const tiles = [];
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const tile = [];
      for (let y = 0; y < 15; y++) tile.push(grid[ty * 15 + y].slice(tx * 8, tx * 8 + 8));
      tiles.push(tile);
    }
  }
  return tiles;
}

function objectTiles(name, bg) {
  return sliceTiles(fit(load(name), 32, 30, bg));
}

// Two short dark ripples per tile, offset per phase so alternating tile rows
// do not line up into a grid.
function waterTile(shift) {
  const ripples = [[2 + shift, 1, 3], [8 + shift, 5, 3], [12 + shift, 0, 2]];
  const grid = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) {
      const on = ripples.some(([ry, rx, len]) => y === (ry % 15) && x >= rx && x < rx + len);
      row.push(on ? I.deep : I.water);
    }
    grid.push(row);
  }
  return grid;
}

// Asphalt with sparse grey grit; `line` paints the dashed lane divider along
// the bottom pixel row, which lands on the boundary between two lanes.
const GRIT = [[1, 2], [5, 5], [3, 11], [7, 8], [6, 1], [2, 13]];
function roadTile(line) {
  const grid = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) {
      let p = GRIT.some(([gx, gy]) => gx === x && gy === y) ? I.grey : I.navy;
      if (line && y === 14) p = (x & 3) < 2 ? I.white : I.grey;
      row.push(p);
    }
    grid.push(row);
  }
  return grid;
}

// The pack's ground texture: a 16x16 speckled field, cropped into two 8x15
// tiles so alternating rows break up the repeat.
function grassTile(offset) {
  const img = load('flower_ground_2.png');
  const grid = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) {
      const o = (y * img.width + offset + x) * 4;
      row.push(img.rgba[o + 3] < 128 ? I.grass : indexOfColour(img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]));
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
  const tiles = [
    [FROGGER_TILES.water, waterTile(0)],
    [FROGGER_TILES.waterB, waterTile(2)],
    [FROGGER_TILES.road, roadTile(false)],
    [FROGGER_TILES.roadLine, roadTile(true)],
    [FROGGER_TILES.grass, grassTile(0)],
    [FROGGER_TILES.grassB, grassTile(8)],
    [FROGGER_TILES.bar, barTile()],
    ...objectTiles('log_middle.png', I.water).map((grid, i) => [FROGGER_TILES.log + i, grid]),
    ...objectTiles('car_1.png', I.road).map((grid, i) => [FROGGER_TILES.carRight + i, grid]),
    ...objectTiles('car_2.png', I.road).map((grid, i) => [FROGGER_TILES.carLeft + i, grid]),
    ...objectTiles('turtle0000.png', I.water).map((grid, i) => [FROGGER_TILES.turtle + i, grid]),
  ];
  return tiles.map(([index, grid]) => ({ index, grid }));
}
