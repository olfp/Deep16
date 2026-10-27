// scripts/make_art.mjs - turn the free Flappy art pack into the D16's 4bpp art.
//
// The tile engine has one shared 16-entry RGB332 palette, 96 font tiles and a
// 32x32 sprite slot.  This module extracts the pipe body/caps, the grass/dirt
// ground and a small cloud from assets/art, quantises them to the palette, and
// exposes indexed 8x15 tiles plus 32x32 bird frames.  make_tile_font places
// the tiles at 96.. and make_bird_sprite places two wing poses in sprite groups
// 6..7 and three bedazzled poses in groups 3..5.
import { decodePng, px } from './lib_png.mjs';

// Shared 16-colour RGB332 palette.  Index 0 is the sky (also the sprite's
// transparent key), 1 is text white, 8 is outline black.
export const ART_PALETTE = [
  0x5b, 0xff, 0x84, 0x70, 0xd5, 0x8e, 0x4c, 0xb9,
  0x00, 0xdf, 0x17, 0xf4, 0x74, 0xf1, 0x28, 0xda,
];

const expand = (v) => [
  ((v >> 5) & 7) * 255 / 7,
  ((v >> 2) & 7) * 255 / 7,
  (v & 3) * 85,
];
const PAL = ART_PALETTE.map(expand);

function quant(r, g, b, a = 255) {
  if (a === 0) return 0;
  let best = 1, bd = Infinity;
  // indices 1..15; index 0 is the sky/transparent key
  for (let i = 1; i < 16; i++) {
    const [pr, pg, pb] = PAL[i];
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function sample(img, x, y) {
  return px(img, Math.max(0, Math.min(img.width - 1, x)),
                Math.max(0, Math.min(img.height - 1, y)));
}

// nearest-neighbour resize of an RGBA region into an indexed grid
function resizeIndexed(img, x0, y0, sw, sh, dw, dh) {
  const out = [];
  for (let y = 0; y < dh; y++) {
    const row = [];
    const sy = y0 + Math.floor((y + 0.5) * sh / dh);
    for (let x = 0; x < dw; x++) {
      const sx = x0 + Math.floor((x + 0.5) * sw / dw);
      const [r, g, b, a] = sample(img, sx, sy);
      row.push(quant(r, g, b, a));
    }
    out.push(row);
  }
  return out;
}

// crop/index without resizing
function cropIndexed(img, x0, y0, w, h) {
  const out = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = sample(img, x0 + x, y0 + y);
      row.push(quant(r, g, b, a));
    }
    out.push(row);
  }
  return out;
}

const split3 = (grid) => [0, 1, 2].map((c) => grid.map((row) => row.slice(c * 8, c * 8 + 8)));

export function artTiles() {
  const pipes = decodePng(new URL('../assets/art/Pipes.png', import.meta.url));
  const grass = decodePng(new URL('../assets/art/Grass.png', import.meta.url));

  // First pipe: x 3..39.  Cap rows 23..41 (the wide lip), body from row 42.
  const capGrid = resizeIndexed(pipes, 3, 23, 37, 19, 24, 15);
  const bodyGrid = resizeIndexed(pipes, 6, 60, 31, 15, 24, 15);
  const capDown = capGrid.slice().reverse();

  const grassTop = cropIndexed(grass, 0, 228, 8, 15);
  const dirt = cropIndexed(grass, 0, 242, 8, 15);

  // A small cloud from the pack's two cloud colours: three puffs.
  const cloud = [];
  for (let y = 0; y < 15; y++) {
    const row = [];
    for (let x = 0; x < 24; x++) {
      let inside = false;
      for (const [cx, cy, r] of [[6, 9, 5], [12, 6, 6], [18, 9, 5]]) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) inside = true;
      }
      // flat bottom
      if (y >= 11 && x >= 2 && x <= 21) inside = true;
      row.push(inside ? (y < 7 ? 1 : 9) : 0);
    }
    cloud.push(row);
  }

  // order: body L/M/R, cap-up L/M/R, cap-down L/M/R, grass, dirt, cloud L/M/R
  return [
    ...split3(bodyGrid),
    ...split3(capGrid),
    ...split3(capDown),
    grassTop,
    dirt,
    ...split3(cloud),
  ];
}

export function birdFrames() {
  const sheet = decodePng(new URL('../assets/art/Red_Bird.png', import.meta.url));
  const boxes = [[4, 9], [52, 9], [4, 57], [52, 57]];
  return boxes.map(([x, y]) => {
    // 40x30 source -> 32x30, one transparent row above and below
    const f = Array.from({ length: 32 }, () => Array(32).fill(0));
    const g = resizeIndexed(sheet, x, y, 40, 30, 32, 30);
    for (let yy = 0; yy < 30; yy++) for (let xx = 0; xx < 32; xx++) f[yy + 1][xx] = g[yy][xx];
    return f;
  });
}

// The bedazzled pose from the paid pack's promo: a black headband across the
// head with a purple flower and a yellow star, and the eye recoloured to the
// orange iris inside its blue ring.  The flower and star slide along the band
// between the three poses, which is the whole animation.
export function dizzyFrames() {
  const purple = 5, yellow = 11, cyan = 10, black = 8;

  const flower = (g, cx, cy) => {
    for (const [x, y] of [[cx, cy - 1], [cx - 1, cy], [cx + 1, cy], [cx, cy + 1]]) g[y][x] = purple;
    g[cy][cx] = yellow;
    g[cy + 2][cx] = black;              // stem down to the band
  };
  const star = (g, cx, cy) => {
    for (const [x, y] of [[cx, cy - 1], [cx - 1, cy], [cx, cy], [cx + 1, cy], [cx, cy + 1]]) g[y][x] = yellow;
  };
  const pose = (fx, fy, sx, sy) => {
    const g = birdFrames()[1].map((r) => r.slice());
    for (let x = 7; x <= 19; x++) g[7][x] = black;   // headband, up to the eye rim
    g[7][14] = cyan;
    g[7][15] = cyan;
    for (let y = 10; y <= 11; y++) for (let x = 22; x <= 23; x++) g[y][x] = yellow;  // iris
    g[9][23] = cyan;
    flower(g, fx, fy);
    star(g, sx, sy);
    return g;
  };
  return [pose(11, 4, 25, 4), pose(13, 3, 27, 3), pose(9, 5, 24, 5)];
}

export function artPreview() {
  const ch = (i) => '.WRG T?L#PEBOAYY'.replace(/ /g, '') [i] || '?';
  const tiles = artTiles();
  const frames = birdFrames();
  const show = (name, grid) => {
    console.log('--- ' + name);
    for (const row of grid) console.log(row.map((i) => ch(i)).join(''));
  };
  frames.forEach((f, i) => show('bird ' + i, f));
  dizzyFrames().forEach((f, i) => show('dizzy ' + i, f));
  // stitch the 3-column pipe body/cap for a readable preview
  const join3 = (a, b, c) => a.map((row, y) => [...row, ...b[y], ...c[y]]);
  show('pipe body', join3(tiles[0], tiles[1], tiles[2]));
  show('pipe cap up', join3(tiles[3], tiles[4], tiles[5]));
  show('pipe cap down', join3(tiles[6], tiles[7], tiles[8]));
  show('grass', tiles[9]);
  show('dirt', tiles[10]);
  show('cloud', join3(tiles[11], tiles[12], tiles[13]));
}

const isMain = process.argv[1] && process.argv[1].endsWith('make_art.mjs');
if (isMain) artPreview();
