#!/usr/bin/env node
// scripts/make_frogger_art.mjs - six flat colour tiles for the Frogger
// per-row scrolling backdrop.
//
// No special art: each tile is one 4bpp pixel index repeated over 8 x 15.  The
// demo installs palette set 2 entries for indices 1..6 at run time, and uses
// the blank tile 0 plus art entry 0 for the left panel.
export const FROGGER_TILES = {
  water: 57,
  road: 58,
  grass: 59,
  carRed: 60,
  carYellow: 61,
  log: 62,
};

const COLOURS = [
  [FROGGER_TILES.water, 1],
  [FROGGER_TILES.road, 2],
  [FROGGER_TILES.grass, 3],
  [FROGGER_TILES.carRed, 4],
  [FROGGER_TILES.carYellow, 5],
  [FROGGER_TILES.log, 6],
];

export function froggerArtTiles() {
  return COLOURS.map(([index, pix]) => ({
    index,
    grid: Array.from({ length: 15 }, () => Array(8).fill(pix)),
  }));
}
