#!/usr/bin/env node
// scripts/make_pole_art.mjs - the Pole art: tile bank, sprite bank, palette.
//
// The milestone-1 prototype drew the same shapes with floating point
// rectangles. The board has no rectangles: it has an 8x15 4bpp tile bank and
// a 32x32 4bpp sprite bank, so the art has to exist in those two formats.
//
// A tile is 15 rows of 8 pixels, 4 bits per pixel, packed two words per row
// (the low nibble of a word is the leftmost pixel). A sprite group is a 32x32
// image made of 4x4 8x8 patterns, 16 words per pattern.
//
// The art area of the tile bank is slots 96..127 (0..95 is the console font).
// The renderer writes tile *word addresses* into the map, so tile n lives at
// bank word n*32 and the cell word is n << 5.
//
// The sprite art is top-left aligned inside its 32x32 group: the renderer
// places the group so that the box's top-left corner is (x, y), with y set so
// that the car's bottom lands on the road line and x centred on the car.

export const CELL_W = 8;
export const CELL_H = 15;
export const SPRITE_SIZE = 32;

// Tile slots. The model (js/deep16_pole_model.js) uses the same numbers.
export const TILE = Object.freeze({
  SKY: 96,
  MOUNTAIN_A: 97,
  MOUNTAIN_B: 98,
  MOUNTAIN_C: 99,
  GRASS_A: 100,
  GRASS_B: 101,
  ROAD_A: 102,
  ROAD_B: 103,
  LEFT_EDGE: 104,      // 104..107: left edge, top cell, four offset buckets
  LEFT_EDGE_B: 108,    // 108..111: left edge, bottom cell
  RIGHT_EDGE: 112,     // 112..115: right edge, top cell
  RIGHT_EDGE_B: 116,   // 116..119: right edge, bottom cell
  CENTER: 120,         // 120..127: the centre stripe
});

// The car's scale bins, from the model: the width and height in pixels.
export const SCALES = Object.freeze([
  Object.freeze({ width: 28, height: 22 }),
  Object.freeze({ width: 21, height: 16 }),
  Object.freeze({ width: 14, height: 11 }),
  Object.freeze({ width: 8, height: 6 }),
]);

// The sprite groups. Group 0 is the player's car; the opponents follow, four
// scale bins per model.
// The player is two 32x32 sprites side by side: group 0 is the left half and
// group 17 the right half, which makes the car 64 pixels wide on screen. The
// four opponent models own groups 1..16, so the copy covers 18 groups.
export const PLAYER_GROUP = 0;
export const PLAYER_GROUP_RIGHT = 17;
export const MODEL_GROUPS = Object.freeze([1, 5, 9, 13]);

// Where the art sits in the Pole slice's own segment, and where it goes in
// the hardware banks. The two match: asm/pole/pole_art.asm copies the blocks
// with these numbers.
export const ART_OFFSETS = Object.freeze({
  TILE: 0x1000,       // 1024 words: the 32 art tiles
  SPRITE: 0x1400,     // 4608 words: the 18 sprite groups
  PALETTE: 0x2600,    // 48 words: the three palette banks
});

export const ART_DESTINATIONS = Object.freeze({
  TILE: 0xF3C00,      // the tile bank at tile 96
  SPRITE: 0xF4000,    // the sprite bank at group 0
  PALETTE: 0xF6080,   // the palette window, set 0, bank 0
});

// The opponent models: body, shade, glass, and the second body colour that
// makes the roofs read as a different car.
export const CAR_MODELS = Object.freeze([
  Object.freeze({ body: 1, shade: 2, glass: 5, stripe: 0 }),
  Object.freeze({ body: 5, shade: 9, glass: 3, stripe: 0 }),
  Object.freeze({ body: 6, shade: 13, glass: 3, stripe: 0 }),
  Object.freeze({ body: 10, shade: 11, glass: 13, stripe: 0 }),
]);

// Palette indices inside the grids below. The tile bank and the sprite bank
// have their own 16-entry palettes, so the same number means a different
// colour in each.
export const TILE_COLORS = Object.freeze({
  SKY: 0,
  GRASS: 1,
  GRASS_DARK: 2,
  GRASS_LIGHT: 3,
  ASPHALT: 4,
  ASPHALT_MID: 5,
  ASPHALT_LIGHT: 6,
  RUMBLE_RED: 7,
  RUMBLE_WHITE: 8,
  TREELINE: 9,
  MOUNTAIN_SHADE: 10,
  MOUNTAIN: 11,
  SNOW: 12,
  STRIPE: 13,
  BLACK: 14,
  BLUE: 15,
});

export const SPRITE_COLORS = Object.freeze({
  TRANSPARENT: 0,
  RED: 1,
  DARK_RED: 2,
  BLACK: 3,
  WHITE: 4,
  BLUE: 5,
  YELLOW: 6,
  LIGHT_RED: 7,
  GREY: 8,
  DARK_BLUE: 9,
  GREEN: 10,
  BROWN: 11,
  ORANGE: 12,
  CYAN: 13,
  MAGENTA: 14,
  PINK: 15,
});

// ---- palettes -------------------------------------------------------------

export function rgb332(red, green, blue) {
  const r = Math.round(Math.max(0, Math.min(255, red)) * 7 / 255);
  const g = Math.round(Math.max(0, Math.min(255, green)) * 7 / 255);
  const b = Math.round(Math.max(0, Math.min(255, blue)) * 3 / 255);
  return (r << 5) | (g << 2) | b;
}

// The tile bank palette (palette set 0, bank 1). Index 0 is the sky, so the
// sky tile is a single colour.
export const TILE_PALETTE = Object.freeze([
  rgb332(66, 142, 235),    // 0 sky
  rgb332(44, 148, 54),     // 1 grass
  rgb332(27, 108, 39),     // 2 dark grass
  rgb332(87, 188, 73),     // 3 light grass
  rgb332(46, 46, 54),      // 4 asphalt
  rgb332(58, 58, 67),      // 5 asphalt variation
  rgb332(74, 74, 84),      // 6 light asphalt
  rgb332(225, 42, 34),     // 7 red rumble strip
  rgb332(239, 239, 235),   // 8 white rumble strip
  rgb332(20, 78, 36),      // 9 treeline
  rgb332(126, 160, 198),   // 10 mountain haze (the far, washed-out base)
  rgb332(72, 104, 148),    // 11 mountain body
  rgb332(222, 233, 243),   // 12 snow
  rgb332(245, 203, 42),    // 13 centre stripe
  rgb332(14, 14, 18),      // 14 black
  rgb332(35, 75, 210),     // 15 blue
]);

// The sprite bank palette (palette set 0, bank 2). Index 0 is transparent.
export const SPRITE_PALETTE = Object.freeze([
  0,                      // 0 transparent
  rgb332(225, 48, 38),    // 1 red
  rgb332(142, 24, 25),    // 2 dark red
  rgb332(15, 15, 19),     // 3 black
  rgb332(242, 242, 238),  // 4 white
  rgb332(38, 86, 222),    // 5 blue
  rgb332(244, 202, 42),   // 6 yellow
  rgb332(255, 111, 91),   // 7 light red
  rgb332(164, 164, 170),  // 8 grey
  rgb332(20, 42, 120),    // 9 dark blue
  rgb332(48, 165, 61),    // 10 green
  rgb332(132, 83, 45),    // 11 brown
  rgb332(235, 119, 33),   // 12 orange
  rgb332(65, 203, 220),   // 13 cyan
  rgb332(220, 63, 189),   // 14 magenta
  rgb332(245, 137, 173),  // 15 pink
]);

// The text bank (palette set 0, bank 0): the background and the text colour.
export const TEXT_PALETTE = Object.freeze([
  rgb332(20, 20, 26),     // 0 background
  rgb332(245, 245, 235),  // 1 text
]);

// ---- grids ----------------------------------------------------------------

function grid15x8(fill = 0) {
  return Array.from({ length: CELL_H }, () => Array(CELL_W).fill(fill));
}

function grid32x32(fill = 0) {
  return Array.from({ length: SPRITE_SIZE }, () => Array(SPRITE_SIZE).fill(fill));
}

// The sky is one flat colour: there is only one sky tile, so a gradient would
// have to be faked with dithering, which tiles visibly.
export function skyGrid() {
  return grid15x8(TILE_COLORS.SKY);
}

// A small integer hash, so the ground and the road get scattered texture
// instead of a regular diagonal pattern.
function hash2(x, y, seed) {
  let h = Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) +
          Math.imul(seed + 1, 2246822519);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// A row of distant peaks. The renderer repeats the tile across the row, so
// the profile starts and ends at the same height and the range reads as a
// continuous ridge line. Two variants are used alternately across the row, so
// the ridge has a sixteen pixel period instead of an eight pixel one and
// stops reading as a row of teeth.
//
// The peaks catch the light on top and the bases wash out into the haze, the
// way a distant range does. The haze sits above the tree line, so the range
// recedes instead of standing on the grass.
export function mountainGrid(variant) {
  const grid = grid15x8(TILE_COLORS.SKY);
  if (variant === 2) {
    // The row that stands on the horizon: the haze in front of the range,
    // with an uneven tree line in front of that.
    const heights = [2, 4, 3, 5, 2, 3, 4, 3];
    for (let x = 0; x < CELL_W; x++) {
      const top = heights[x];
      for (let y = 0; y < CELL_H; y++) {
        if (y < top) grid[y][x] = TILE_COLORS.MOUNTAIN_SHADE;
        else if (y === top) grid[y][x] = TILE_COLORS.GRASS;
        else grid[y][x] = TILE_COLORS.TREELINE;
      }
    }
    return grid;
  }
  // Both profiles start and end at 7, so the ridge line is continuous when
  // the two tiles are laid next to each other.
  const profiles = [
    [7, 6, 4, 2, 3, 5, 6, 7],
    [7, 5, 6, 3, 4, 6, 5, 7],
  ];
  const profile = profiles[variant % profiles.length];
  for (let x = 0; x < CELL_W; x++) {
    const top = profile[x];
    for (let y = top; y < CELL_H; y++) {
      // Snow only on the highest peak of each profile, and only on its top
      // row: a cap on every peak would read as a regular row of white dots
      // along the horizon.
      if (top === 2 && y === top) grid[y][x] = TILE_COLORS.SNOW;
      else if (y >= top + 6) grid[y][x] = TILE_COLORS.MOUNTAIN_SHADE;
      else grid[y][x] = TILE_COLORS.MOUNTAIN;
    }
  }
  return grid;
}

// The grass: a flat green with a little noise, so the ground reads as a
// texture rather than a colour.
export function grassGrid(variant) {
  const grid = grid15x8(TILE_COLORS.GRASS);
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const n = hash2(x, y, variant) % 23;
      if (n === 0) grid[y][x] = TILE_COLORS.GRASS_DARK;
      else if (n <= 2) grid[y][x] = TILE_COLORS.GRASS_LIGHT;
    }
  }
  return grid;
}

// The asphalt. The two variants alternate every eight bands, which is what
// makes the road look like it is moving: variant A is the darker surface,
// variant B the lighter one.
export function roadGrid(variant) {
  const grid = grid15x8(variant ? TILE_COLORS.ASPHALT_MID : TILE_COLORS.ASPHALT);
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const n = hash2(x, y, variant + 4) % 17;
      if (n === 0) {
        grid[y][x] = variant ? TILE_COLORS.ASPHALT : TILE_COLORS.ASPHALT_LIGHT;
      }
    }
  }
  return grid;
}

// The grass outside the road, in the same pattern as the grass tile, so the
// kerb does not cut a visible seam through the ground.
function grassPixel(x, y) {
  const n = hash2(x, y, 0) % 23;
  if (n === 0) return TILE_COLORS.GRASS_DARK;
  if (n <= 2) return TILE_COLORS.GRASS_LIGHT;
  return TILE_COLORS.GRASS;
}

// The left edge of the road: grass, then the rumble strip, then the road.
// The boundary sits at `boundary` pixels into the cell, so the eight tiles
// are the eight positions the boundary can take.
// The road edge is drawn across two cells so the asphalt boundary can be a
// continuous diagonal instead of a vertical bar per tile. The top cell holds
// the upper half of the line, the cell one column outside holds the lower
// half; both use the same offset bucket, and the line drops ten pixels over
// the fifteen rows, which is the road's own width change per band.
export const EDGE_BUCKETS = Object.freeze([2, 4, 6, 7]);
const EDGE_SLOPE = 10;

function edgeShift(y) {
  return Math.round((y * EDGE_SLOPE) / (CELL_H - 1));
}

function asphaltPixel(x, y) {
  return ((x * 5 + y) % 13 === 0) ? TILE_COLORS.ASPHALT_MID : TILE_COLORS.ASPHALT;
}

// The left top cell: the line starts at `a` on the top edge and walks left.
export function leftTopGrid(a) {
  const grid = grid15x8(TILE_COLORS.ASPHALT);
  for (let y = 0; y < CELL_H; y++) {
    const edge = a - edgeShift(y);
    for (let x = 0; x < CELL_W; x++) {
      if (edge < 0) grid[y][x] = asphaltPixel(x, y);
      else if (x < edge - 1) grid[y][x] = grassPixel(x, y);
      else if (x === edge - 1) grid[y][x] = TILE_COLORS.RUMBLE_RED;
      else if (x === edge) grid[y][x] = TILE_COLORS.RUMBLE_WHITE;
      else grid[y][x] = asphaltPixel(x, y);
    }
  }
  return grid;
}

// The left bottom cell: the line enters at the right edge and ends at `a`.
export function leftBottomGrid(a) {
  const grid = grid15x8(TILE_COLORS.ASPHALT);
  for (let y = 0; y < CELL_H; y++) {
    const edge = 8 + a - edgeShift(y);
    for (let x = 0; x < CELL_W; x++) {
      if (edge > 8) grid[y][x] = grassPixel(x, y);
      else if (edge < 0) grid[y][x] = asphaltPixel(x, y);
      else if (x < edge - 1) grid[y][x] = grassPixel(x, y);
      else if (x === edge - 1) grid[y][x] = TILE_COLORS.RUMBLE_RED;
      else if (x === edge) grid[y][x] = TILE_COLORS.RUMBLE_WHITE;
      else grid[y][x] = asphaltPixel(x, y);
    }
  }
  return grid;
}

// The right top cell: the line starts at `a` and walks right.
export function rightTopGrid(a) {
  const grid = grid15x8(TILE_COLORS.ASPHALT);
  for (let y = 0; y < CELL_H; y++) {
    const edge = a + edgeShift(y);
    for (let x = 0; x < CELL_W; x++) {
      if (edge > 7) grid[y][x] = asphaltPixel(x, y);
      else if (x <= edge) grid[y][x] = asphaltPixel(x, y);
      else if (x === edge + 1) grid[y][x] = TILE_COLORS.RUMBLE_WHITE;
      else if (x === edge + 2) grid[y][x] = TILE_COLORS.RUMBLE_RED;
      else grid[y][x] = grassPixel(x, y);
    }
  }
  return grid;
}

// The right bottom cell: the line enters at the left edge and ends at `a`.
export function rightBottomGrid(a) {
  const grid = grid15x8(TILE_COLORS.ASPHALT);
  for (let y = 0; y < CELL_H; y++) {
    const edge = a - 8 + edgeShift(y);
    for (let x = 0; x < CELL_W; x++) {
      if (edge < 0) grid[y][x] = grassPixel(x, y);
      else if (x <= edge) grid[y][x] = asphaltPixel(x, y);
      else if (x === edge + 1) grid[y][x] = TILE_COLORS.RUMBLE_WHITE;
      else if (x === edge + 2) grid[y][x] = TILE_COLORS.RUMBLE_RED;
      else grid[y][x] = grassPixel(x, y);
    }
  }
  return grid;
}
// The centre stripe. The stripe is two pixels wide and starts at `offset`
// inside the cell; the cell edge cuts it, which is the usual seam of a
// sub-cell accurate line on an eight pixel grid. The stripe is dashed: the
// top eight rows of every cell carry the paint and the bottom seven are
// plain road, so the dashes repeat once per cell.
export function centerGrid(offset) {
  const grid = roadGrid(0);
  for (let y = 0; y < 8; y++) {
    grid[y][offset] = TILE_COLORS.STRIPE;
    if (offset < 7) grid[y][offset + 1] = TILE_COLORS.RUMBLE_WHITE;
  }
  return grid;
}

// The car artwork: 28x22 pixels, seen from behind.
export const CAR_W = 28;
export const CAR_H = 22;

// A car seen from behind, 28x22, in the top-left corner of its group.
export function carGrid(model, player = false) {
  const grid = grid32x32(SPRITE_COLORS.TRANSPARENT);
  const body = model.body;
  const shade = model.shade;
  const glass = model.glass;
  const set = (x, y, color) => {
    if (x >= 0 && x < CAR_W && y >= 0 && y < CAR_H) grid[y][x] = color;
  };
  const fill = (x0, y0, x1, y1, color) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) set(x, y, color);
    }
  };
  // The roof, narrowing towards the top.
  fill(7, 0, 21, 1, body);
  fill(6, 1, 22, 2, body);
  fill(5, 2, 23, 3, body);
  // The rear window, between the pillars.
  fill(8, 3, 20, 8, glass);
  // The shoulders and the body sides.
  fill(3, 9, 25, 11, body);
  fill(2, 11, 26, 18, shade);
  // The rear bumper.
  fill(4, 18, 24, 20, SPRITE_COLORS.GREY);
  // The wheels, sticking out below the body.
  fill(0, 16, 4, 22, SPRITE_COLORS.BLACK);
  fill(24, 16, 28, 22, SPRITE_COLORS.BLACK);
  // The tail lights.
  fill(3, 15, 6, 18, SPRITE_COLORS.LIGHT_RED);
  fill(22, 15, 25, 18, SPRITE_COLORS.LIGHT_RED);
  if (player) {
    // The player's stripe runs over the roof and down the boot.
    fill(13, 0, 15, 3, SPRITE_COLORS.BLUE);
    fill(13, 3, 15, 18, SPRITE_COLORS.WHITE);
  }
  // A black outline around the silhouette: every painted pixel that touches
  // the background becomes the outline. It gives the car an edge at every
  // scale, which is what makes four bits per pixel enough.
  for (let y = 0; y < CAR_H; y++) {
    for (let x = 0; x < CAR_W; x++) {
      if (grid[y][x] === SPRITE_COLORS.TRANSPARENT) continue;
      if (grid[y][x] === SPRITE_COLORS.BLACK) continue;
      const edge = (x === 0 || grid[y][x - 1] === SPRITE_COLORS.TRANSPARENT) ||
                   (x === CAR_W - 1 || grid[y][x + 1] === SPRITE_COLORS.TRANSPARENT) ||
                   (y === 0 || grid[y - 1][x] === SPRITE_COLORS.TRANSPARENT) ||
                   (y === CAR_H - 1 || grid[y + 1][x] === SPRITE_COLORS.TRANSPARENT);
      if (edge) grid[y][x] = SPRITE_COLORS.BLACK;
    }
  }
  return grid;
}

// Scale a car down into its box. The art stays in the top-left corner, so
// the OAM placement can put the car's bottom on the road line.
export function scaleGrid(source, width, height) {
  const out = grid32x32(SPRITE_COLORS.TRANSPARENT);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(CAR_H - 1, Math.floor(y * CAR_H / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(CAR_W - 1, Math.floor(x * CAR_W / width));
      out[y][x] = source[sy][sx];
    }
  }
  return out;
}

// The player's car is 56x32, split into two 32x32 sprite groups so it reads
// as a full-width car against the road instead of a speck. The opponents use
// the 28x22 art above, scaled per depth bin.
export const WIDE_CAR_W = 64;
export const WIDE_CAR_H = 32;
const WIDE_CONTENT_W = 56;

export function widePlayerGrid() {
  const source = carGrid(CAR_MODELS[0], true);
  const grid = Array.from({ length: WIDE_CAR_H },
                          () => Array(WIDE_CAR_W).fill(SPRITE_COLORS.TRANSPARENT));
  const ox = (WIDE_CAR_W - WIDE_CONTENT_W) >> 1;
  for (let y = 0; y < WIDE_CAR_H; y++) {
    const sy = Math.min(CAR_H - 1, Math.floor(y * CAR_H / WIDE_CAR_H));
    for (let x = 0; x < WIDE_CONTENT_W; x++) {
      const sx = Math.min(CAR_W - 1, Math.floor(x * CAR_W / WIDE_CONTENT_W));
      grid[y][ox + x] = source[sy][sx];
    }
  }
  return grid;
}

// One 32x32 half of a wide grid: the left half starts at x=0, the right at 32.
export function spriteHalfGrid(grid, offsetX) {
  const out = grid32x32(SPRITE_COLORS.TRANSPARENT);
  for (let y = 0; y < SPRITE_SIZE; y++) {
    for (let x = 0; x < SPRITE_SIZE; x++) out[y][x] = grid[y][offsetX + x];
  }
  return out;
}

// ---- the banks ------------------------------------------------------------

// One tile: 15 rows of 8 pixels, two words per row, the low nibble leftmost.
export function tileWords(grid) {
  const words = new Array(32).fill(0);
  for (let row = 0; row < CELL_H; row++) {
    const pixels = grid[row];
    words[row * 2] = (pixels[0] | (pixels[1] << 4) |
                       (pixels[2] << 8) | (pixels[3] << 12)) & 0xFFFF;
    words[row * 2 + 1] = (pixels[4] | (pixels[5] << 4) |
                          (pixels[6] << 8) | (pixels[7] << 12)) & 0xFFFF;
  }
  return words;
}

// One sprite group: 32x32 pixels as 4x4 8x8 patterns, 16 words per pattern.
export function spriteWords(grid) {
  const words = new Array(256).fill(0);
  for (let y = 0; y < SPRITE_SIZE; y++) {
    for (let x = 0; x < SPRITE_SIZE; x += 4) {
      const pattern = Math.floor(y / 8) * 4 + Math.floor(x / 8);
      const half = (x & 4) ? 1 : 0;
      let word = 0;
      for (let n = 0; n < 4; n++) word |= (grid[y][x + n] & 0xF) << (n * 4);
      words[pattern * 16 + (y & 7) * 2 + half] = word & 0xFFFF;
    }
  }
  return words;
}

// Every tile of the art area, in bank order.
export function poleTileGrids() {
  const tiles = [
    { index: TILE.SKY, grid: skyGrid() },
    { index: TILE.MOUNTAIN_A, grid: mountainGrid(0) },
    { index: TILE.MOUNTAIN_B, grid: mountainGrid(1) },
    { index: TILE.MOUNTAIN_C, grid: mountainGrid(2) },
    { index: TILE.GRASS_A, grid: grassGrid(0) },
    { index: TILE.GRASS_B, grid: grassGrid(1) },
    { index: TILE.ROAD_A, grid: roadGrid(0) },
    { index: TILE.ROAD_B, grid: roadGrid(1) },
  ];
  EDGE_BUCKETS.forEach((a, bucket) => {
    tiles.push({ index: TILE.LEFT_EDGE + bucket, grid: leftTopGrid(a) });
    tiles.push({ index: TILE.LEFT_EDGE_B + bucket, grid: leftBottomGrid(a) });
    tiles.push({ index: TILE.RIGHT_EDGE + bucket, grid: rightTopGrid(a) });
    tiles.push({ index: TILE.RIGHT_EDGE_B + bucket, grid: rightBottomGrid(a) });
  });
  for (let offset = 0; offset < 8; offset++) {
    tiles.push({ index: TILE.CENTER + offset, grid: centerGrid(offset) });
  }
  // The bank copy is one block, so the tiles have to be in index order.
  return tiles.sort((a, b) => a.index - b.index);
}

// Every sprite group: the player first, then four scale bins per model.
export function poleSpriteGrids() {
  const wide = widePlayerGrid();
  const groups = [
    { group: PLAYER_GROUP, grid: spriteHalfGrid(wide, 0) },
    { group: PLAYER_GROUP_RIGHT, grid: spriteHalfGrid(wide, SPRITE_SIZE) },
  ];
  CAR_MODELS.forEach((model, index) => {
    const source = carGrid(model, false);
    SCALES.forEach((scale, bin) => {
      groups.push({
        group: MODEL_GROUPS[index] + bin,
        grid: scaleGrid(source, scale.width, scale.height),
      });
    });
  });
  return groups.sort((a, b) => a.group - b.group);
}

// The tile art as one block of bank words. The tile bank is 128 tiles of 32
// words, so the art tiles (96..127) are the last 1024 words of the bank and
// the copy is a single block move.
export function poleTileWords() {
  const words = [];
  for (const tile of poleTileGrids()) {
    words.push(...tileWords(tile.grid));
  }
  return words;
}

// The sprite art as one block: the player is groups 0 and 17 and the four
// models own groups 1..16, so the copy covers the first 4608 words of the
// sprite bank.
export function poleSpriteWords() {
  const words = [];
  for (const entry of poleSpriteGrids()) {
    words.push(...spriteWords(entry.grid));
  }
  return words;
}

// The palettes as one block of 48 words: the text bank (16), the art bank
// (16) and the sprite bank (16). The layout mirrors the palette window at
// 0xF6080, so the copy is a single block move as well.
export function polePaletteWords() {
  const text = new Array(16).fill(0);
  text[0] = TEXT_PALETTE[0];
  text[1] = TEXT_PALETTE[1];
  return [...text, ...TILE_PALETTE, ...SPRITE_PALETTE];
}
