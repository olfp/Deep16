#!/usr/bin/env node
// scripts/make_pacman_art.mjs - Pac-Man maze data, wall/dot/ghost art tiles and
// the Pac-Man sprite frames.
//
// The playfield is 30 x 23 logical cells.  Each logical cell is two 8-pixel
// tilemap cells wide and one 15-pixel row tall, so the maze is 60 x 23 cells
// and is centred in the 80-column tilemap (10-cell margin, 80 pixels).
//
// The layout is the arcade 28x31 maze compressed to 23 rows and widened by one
// corridor column on each side.  Cell values are packed two bits per cell,
// eight cells per word, four words per row (92 words).  0 empty, 1 wall,
// 2 dot, 3 power pellet.  The ghost door is a wall cell at row 10, columns
// 14/15 and is drawn as text.
//
// Art slots (the font gap and the two free art slots after the Flappy pack):
//   tile 49/50   dot left/right halves
//   tile 51/52   power pellet left/right halves
//   tile 53/54   ghost left/right halves (normal)
//   tile 55/56   ghost left/right halves (frightened)
//   tile 110..117  wall left half, shape bits 1=left outline, 2=top, 4=bottom
//   tile 118..125  the same shapes mirrored for the right half
//
// Sprite groups 0,1,8,9,16,17 hold Pac-Man: right-open, right-closed,
// up-open, up-closed, down-open, down-closed.  Left is the right frame with
// the OAM H flip, so the six groups cover all four directions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PAC_W = 30;
export const PAC_H = 23;
export const PAC_ROW_WORDS = 4;
export const PAC_MAP_WORDS = PAC_ROW_WORDS * PAC_H;
export const PAC_MAP_ORG = 0x610;
export const PAC_AUX_ORG = 0x678;
export const PAC_MAP_FILE = 'asm/showcase/pacman_map.asm';

export const PAC_CELL_W = 2;        // tilemap cells per logical column
export const PAC_CELL_H = 1;        // tilemap rows per logical row
export const PAC_LEFT = 10;         // tilemap columns before the maze
export const PAC_TOP = 1;           // HUD row 0, maze rows 1..23

// Art tile indices.
export const T_DOT_L = 49, T_DOT_R = 50;
export const T_PELLET_L = 51, T_PELLET_R = 52;
export const T_GHOST_L = 53, T_GHOST_R = 54;
export const T_FRIGHT_L = 55, T_FRIGHT_R = 56;
export const T_WALL_L = 110, T_WALL_R = 118;

// Sprite groups.
export const PAC_GROUPS = {
  rightOpen: 0, rightClosed: 1,
  upOpen: 8, upClosed: 9,
  downOpen: 16, downClosed: 17,
};

// Palette entries this art uses (the game installs these into palette set 1).
export const PAC_PALETTE = [
  [0xC0, 0x00], [0xC1, 0xFF],                    // text: black, white
  [0xD0, 0x00], [0xD1, 0xFF], [0xD4, 0x03],      // art: black, white, wall blue
  [0xD5, 0xE0], [0xD6, 0x1F],                    // art: ghost red, frightened cyan
  [0xDC, 0xE9], [0xDE, 0xFE],                    // art: dot pink, pellet yellow
  [0xE0, 0x00], [0xE5, 0xFC],                    // sprite: key, Pac-Man yellow
];

// ---- the maze ---------------------------------------------------------
//
// A 28-column compression of the arcade 28x31 maze, widened to 30 columns by
// one corridor column on each side.  The arcade maze is 31 rows; at 16x15
// cells only 23 maze rows fit above the HUD, so the sparse house/void rows are
// the ones compressed.  The top and bottom blocks keep the arcade patterns.
//
// The base grid below is the 28-wide version: 216 small dots + 4 pellets.
// pacmanGrid() inserts one column on each side, taking its value from the
// adjacent outer corridor.  That makes the outer track two cells wide and
// brings the count to 246 small dots + 4 pellets (the agreed D16D layout).
//
// Cell values are packed two bits per cell, eight cells per word, four words
// per row (92 words).  0 empty, 1 wall/door, 2 dot, 3 power pellet.  The ghost
// door is a wall cell at row 10, columns 14/15 and is drawn as text.
const BASE_ROWS = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##          ##.######',
  '######.## ###==### ##.######',
  '######.## #      # ##.######',
  '      .## #      # ##.      ',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];

export const HOUSE = { top: 10, bottom: 13, left: 11, right: 18, door: 14 };
export const TUNNEL_ROW = 12;
export const PAC_START = { c: 14, r: 16 };

const insertValue = (ch) => (ch === 'o' ? '.' : ch);

// Full 30-column grid: one extra corridor column inside each outer wall.
export function pacmanGrid() {
  return BASE_ROWS.map((row) =>
    (row[0] + insertValue(row[1]) + row.slice(1, 27) + insertValue(row[26]) + row[27]).split(''));
}

export const wallChar = (ch) => ch === '#';

// Static cell value: 0 empty, 1 wall/door, 2 dot, 3 pellet.
export function pacmanCells() {
  return pacmanGrid().map((row) => row.map((ch) => {
    if (ch === '#' || ch === '=') return 1;   // the door is a wall cell
    if (ch === '.') return 2;
    if (ch === 'o') return 3;
    return 0;
  }));
}

export const isDoor = (c, r) => r === HOUSE.top && (c === HOUSE.door || c === HOUSE.door + 1);
export const house = HOUSE;

// Eight cells per 16-bit word, cell 0 in bits 1:0, four words per row.
export function pacmanMazeWords() {
  const cells = pacmanCells();
  const words = [];
  for (let r = 0; r < PAC_H; r++) {
    for (let w = 0; w < PAC_ROW_WORDS; w++) {
      let word = 0;
      for (let k = 0; k < 8; k++) {
        const c = w * 8 + k;
        const v = c < PAC_W ? cells[r][c] : 0;
        word |= (v & 3) << (k * 2);
      }
      words.push(word);
    }
  }
  return words;
}

export function pacmanDotCount() {
  return pacmanCells().flat().filter((v) => v === 2 || v === 3).length;
}

// ---- validation -------------------------------------------------------
// BFS from Pac-Man's start over cells Pac-Man can walk, then check that every
// dot is reachable and that the ghost house interior is reachable for ghosts
// through the door.
const PICKUP_TARGET = 250;   // 246 small dots + 4 power pellets

export function checkMaze() {
  const fail = [];
  const grid = pacmanGrid();
  for (let r = 0; r < PAC_H; r++) {
    if (grid[r].length !== PAC_W) fail.push(`row ${r} is ${grid[r].length} wide`);
    for (let c = 0; c < PAC_W; c++) {
      if (!'#.o ='.includes(grid[r][c])) fail.push(`row ${r} col ${c}: bad char '${grid[r][c]}'`);
      if (c >= 15 && grid[r][c] !== grid[r][29 - c]) fail.push(`row ${r} is not symmetric at ${c}`);
    }
  }
  const cells = pacmanCells();
  const seen = new Set();
  // A step wraps on the tunnel row; on every other row the outer wall makes
  // the wrapped cell a wall, so wrapping unconditionally is safe.
  const step = (c, r, ghosts) => {
    if (r < 0 || r >= PAC_H) return null;
    if (c < 0) c = PAC_W - 1;
    if (c >= PAC_W) c = 0;
    if (cells[r][c] === 1 && !(ghosts && isDoor(c, r))) return null;
    return [c, r];
  };
  const start = [PAC_START.c, PAC_START.r];
  seen.add(start.join(','));
  const q = [start];
  while (q.length) {
    const [c, r] = q.shift();
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const n = step(c + dc, r + dr, false);
      if (!n) continue;
      const key = n.join(',');
      if (!seen.has(key)) { seen.add(key); q.push(n); }
    }
  }
  let dots = 0, pellets = 0, unreachable = 0;
  for (let r = 0; r < PAC_H; r++) for (let c = 0; c < PAC_W; c++) {
    if (cells[r][c] === 2 || cells[r][c] === 3) {
      dots++;
      if (cells[r][c] === 3) pellets++;
      if (!seen.has(`${c},${r}`)) unreachable++;
    }
  }
  if (unreachable) fail.push(`${unreachable} dot cells are unreachable from the start`);
  if (dots !== PICKUP_TARGET) fail.push(`expected ${PICKUP_TARGET} pickups (246 dots + 4 power-ups), found ${dots}`);
  if (pellets !== 4) fail.push(`expected 4 power pellets, found ${pellets}`);

  // Ghost house: the interior and the door must connect to the maze.
  const gseen = new Set();
  const gq = [[HOUSE.door, HOUSE.top]];
  gseen.add(gq[0].join(','));
  while (gq.length) {
    const [c, r] = gq.shift();
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const n = step(c + dc, r + dr, true);
      if (!n) continue;
      const key = n.join(',');
      if (!gseen.has(key)) { gseen.add(key); gq.push(n); }
    }
  }
  for (let r = HOUSE.top + 1; r < HOUSE.bottom; r++) {
    for (let c = HOUSE.left + 1; c < HOUSE.right; c++) {
      if (!gseen.has(`${c},${r}`)) fail.push(`ghost house cell ${c},${r} is sealed off`);
    }
  }
  return { fail, dots, pellets, reachable: seen.size };
}

// ---- art -------------------------------------------------------------
const ART_W = 8, ART_H = 15;

function blankTile() {
  return Array.from({ length: ART_H }, () => Array(ART_W).fill(0));
}

function mirror(grid) {
  return grid.map((row) => row.slice().reverse());
}

const dotPixels = (radius) => {
  const out = [];
  const cx = 7.5, cy = 7;
  for (let y = 0; y < ART_H; y++) for (let x = 0; x < 16; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) out.push([x, y]);
  }
  return out;
};

function split16(grid) {
  return [grid.map((row) => row.slice(0, 8)), grid.map((row) => row.slice(8, 16))];
}

function dotTile(indices, radius) {
  const full = Array.from({ length: ART_H }, () => Array(16).fill(0));
  for (const [x, y] of dotPixels(radius)) full[y][x] = indices;
  return split16(full);
}

// One 8x15 wall half: shape bits 1 = left outline, 2 = top outline, 4 = bottom.
function wallHalf(shape) {
  const out = blankTile();
  const BLUE = 4;
  for (let y = 0; y < ART_H; y++) for (let x = 0; x < ART_W; x++) {
    const left = (shape & 1) && x < 2;
    const top = (shape & 2) && y < 2;
    const bottom = (shape & 4) && y >= ART_H - 2;
    out[y][x] = (left || top || bottom) ? BLUE : 0;
  }
  return out;
}

function ghostGrid(fright) {
  const body = fright ? 6 : 5;
  const eye = 1;
  const pupil = 4;
  const g = Array.from({ length: ART_H }, () => Array(16).fill(0));
  for (let y = 0; y < ART_H; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = Math.abs(x - 7.5);
      // rounded top, straight sides, wavy skirt
      let inside;
      if (y === 0) inside = dx <= 3;
      else if (y === 1) inside = dx <= 5;
      else if (y === 2) inside = dx <= 6;
      else if (y < 13) inside = x >= 1 && x <= 14;
      else if (y === 13) inside = x >= 1 && x <= 14 && ((x >> 1) % 2 === 0);
      else inside = x >= 1 && x <= 14 && ((x >> 1) % 2 === 1);
      if (inside) g[y][x] = body;
    }
  }
  // eyes: 3x4 white, 2x2 pupil in the middle
  for (const x0 of [3, 10]) {
    for (let y = 4; y <= 7; y++) for (let x = x0; x <= x0 + 2; x++) g[y][x] = eye;
    if (!fright) {
      for (let y = 5; y <= 6; y++) for (let x = x0 + 1; x <= x0 + 2; x++) g[y][x] = pupil;
    }
  }
  if (fright) {
    // wavy mouth
    for (let x = 4; x <= 11; x++) g[9][x] = (x % 2) ? eye : body;
    g[9][4] = eye;
  }
  return g;
}

// Returns [{ index, grid }] for every Pac-Man art tile in the fixed slots.
export function pacmanArtTiles() {
  const dot = dotTile(12, 2);
  const pellet = dotTile(14, 4);
  const ghost = ghostGrid(false);
  const fright = ghostGrid(true);
  const [ghostL, ghostR] = split16(ghost);
  const [frightL, frightR] = split16(fright);
  const tiles = [
    { index: T_DOT_L, grid: dot[0] },
    { index: T_DOT_R, grid: dot[1] },
    { index: T_PELLET_L, grid: pellet[0] },
    { index: T_PELLET_R, grid: pellet[1] },
    { index: T_GHOST_L, grid: ghostL },
    { index: T_GHOST_R, grid: ghostR },
    { index: T_FRIGHT_L, grid: frightL },
    { index: T_FRIGHT_R, grid: frightR },
  ];
  for (let shape = 0; shape < 8; shape++) {
    const half = wallHalf(shape);
    tiles.push({ index: T_WALL_L + shape, grid: half });
    tiles.push({ index: T_WALL_R + shape, grid: mirror(half) });
  }
  return tiles;
}

// Every wall shape the maze actually uses, for the coverage test.
export function wallShapeCoverage() {
  const cells = pacmanCells();
  const used = new Set();
  const path = (c, r) => {
    if (r < 0 || r >= PAC_H) return false;
    if (c < 0) c = PAC_W - 1;
    if (c >= PAC_W) c = 0;
    return cells[r][c] !== 1 || isDoor(c, r);
  };
  for (let r = 0; r < PAC_H; r++) for (let c = 0; c < PAC_W; c++) {
    if (cells[r][c] !== 1 || isDoor(c, r)) continue;
    used.add((path(c - 1, r) ? 1 : 0) |
             (path(c, r - 1) ? 2 : 0) |
             (path(c, r + 1) ? 4 : 0));
  }
  return used;
}

// Pac-Man frames: a 16-pixel-diameter body in the middle of a 32x32 sprite.
// Right-facing frames are the base; the left frames are the same art with the
// OAM H flip.  `open` is 0..2 (closed, medium, wide).
function pacmanFrame(dir, open, closed) {
  const g = Array.from({ length: 32 }, () => Array(32).fill(0));
  const cx = 16, cy = 16, r = 8;
  // mouth half-angle: 0 for the closed frame, 40 degrees when open
  const angle = closed ? 0.06 : (open ? 0.75 : 0.45);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy > r * r) continue;
    // the mouth wedge opens toward dir
    const ax = dir === 'right' ? dx : dir === 'left' ? -dx : dy;
    const ay = dir === 'right' || dir === 'left' ? Math.abs(dy) : dir === 'down' ? dx : -dx;
    if (ax > 0 && Math.abs(ay) <= ax * Math.tan(angle)) continue;
    g[y][x] = 5;
  }
  // eye
  if (dir === 'right') g[11][18] = 0;
  if (dir === 'left') g[11][13] = 0;
  if (dir === 'up') g[11][16] = 0;
  if (dir === 'down') g[21][16] = 0;
  return g;
}

export function pacmanSpriteFrames() {
  return [
    { group: PAC_GROUPS.rightOpen, grid: pacmanFrame('right', 2) },
    { group: PAC_GROUPS.rightClosed, grid: pacmanFrame('right', 0, true) },
    { group: PAC_GROUPS.upOpen, grid: pacmanFrame('up', 2) },
    { group: PAC_GROUPS.upClosed, grid: pacmanFrame('up', 0, true) },
    { group: PAC_GROUPS.downOpen, grid: pacmanFrame('down', 2) },
    { group: PAC_GROUPS.downClosed, grid: pacmanFrame('down', 0, true) },
  ];
}

// ---- generated assembly data -----------------------------------------
export function pacmanMapAsm() {
  const words = pacmanMazeWords();
  const hex = (v) => '0x' + (v & 0xFFFF).toString(16).padStart(4, '0');
  const lines = [];
  lines.push('; pacman_map.asm - generated by scripts/make_pacman_art.mjs; do not edit.');
  lines.push('; 30x23 cells, two bits each, eight cells per word, four words per row.');
  lines.push('; Rows 0..22, cell 0 in bits 1:0; 1 wall, 2 dot, 3 pellet.');
  lines.push('.org 0x610');
  lines.push('pacmap:');
  for (let r = 0; r < PAC_H; r++) {
    const row = words.slice(r * PAC_ROW_WORDS, (r + 1) * PAC_ROW_WORDS);
    lines.push(`    .word ${row.map(hex).join(', ')}    ; row ${r}`);
  }
  lines.push('');
  lines.push('; Direction deltas, indexed by 1 up, 2 down, 3 left, 4 right.');
  lines.push('; dir 0 is unused; dir_rev maps a direction to its opposite.');
  lines.push('.org 0x678');
  lines.push('pac_dc:');
  lines.push('    .word 0, 0, 0, -1, 1');
  lines.push('pac_dr:');
  lines.push('    .word 0, -1, 1, 0, 0');
  lines.push('pac_rev:');
  lines.push('    .word 0, 2, 1, 4, 3');
  lines.push('');
  lines.push('; Palette entries for set 1: (offset from 0xF600, value).');
  lines.push('.org 0x688');
  lines.push('pac_pal:');
  lines.push(`    .word ${String(PAC_PALETTE.length)}`);
  for (const [off, value] of PAC_PALETTE) lines.push(`    .word ${hex(off)}, ${hex(value)}`);
  return lines.join('\n') + '\n';
}

export function writePacmanMap(force = false) {
  const target = path.join(ROOT, PAC_MAP_FILE);
  const next = pacmanMapAsm();
  const old = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (next !== old) {
    if (!force) return { target, changed: true, wrote: false };
    fs.writeFileSync(target, next);
  }
  return { target, changed: next !== old, wrote: next !== old };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const maze = checkMaze();
  if (maze.fail.length) {
    console.error('pacman maze is not valid:\n  - ' + maze.fail.join('\n  - '));
    process.exit(1);
  }
  const write = writePacmanMap(!check);
  if (check && write.changed) {
    console.error(`${PAC_MAP_FILE} is out of date with ${path.relative(ROOT, import.meta.url)}`);
    process.exit(1);
  }
  if (!check) console.log(`wrote ${PAC_MAP_FILE}`);
  console.log(`maze: ${PAC_W}x${PAC_H}, ${maze.dots} dots/pellets, ${maze.reachable} walkable cells, ` +
              `${pacmanMazeWords().length} map words`);
  console.log(`wall shapes used: ${[...wallShapeCoverage()].sort((a, b) => a - b).join(', ')}`);
}
