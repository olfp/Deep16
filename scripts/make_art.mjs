// scripts/make_art.mjs - turn the Flappy art packs into the D16's 4bpp art.
//
// The tile engine has one shared 16-entry RGB332 palette, 128 font/art tiles
// and 32x32 sprite slots.  This module extracts the pipe body/caps, the
// grass/dirt ground and a cloud from assets/art, quantises them to the palette,
// and exposes indexed 8x15 tiles plus 32x32 bird and cloud sprites.  The three
// birds share body/belly palette entries 2/13, so a run only has to set those
// two entries to pick Red, Purple or Yellow.
import { decodePng, px } from './lib_png.mjs';

// Shared 16-colour RGB332 palette.  Index 0 is the sky (also the sprite's
// transparent key), 1 is text white, 8 is outline black.  Entries 2 and 13
// are the bird's body and belly; a bird colour swaps those two at runtime.
export const ART_PALETTE = [
  0x5b, 0xff, 0x84, 0x70, 0xd5, 0x8e, 0x4c, 0xb9,
  0x00, 0xdf, 0x17, 0xf4, 0x74, 0xf1, 0x28, 0xda,
];

// Body (2) and belly (13) for each bird.  Red is the palette above; the other
// two are the paid pack's Purple and Yellow birds, reduced to RGB332.
export const BIRD_COLOURS = {
  red:    { body: 0x84, belly: 0xf1 },
  purple: { body: 0xae, belly: 0xb6 },
  yellow: { body: 0xfc, belly: 0xf4 },
};
export const BIRD_ORDER = ['red', 'purple', 'yellow'];

const expand = (v) => [
  ((v >> 5) & 7) * 255 / 7,
  ((v >> 2) & 7) * 255 / 7,
  (v & 3) * 85,
];
const PAL = ART_PALETTE.map(expand);

// A bird's own palette has its body/belly colours at 2/13, so the same pixels
// land on the shared indices no matter which bird is being converted.
function birdPalette(colour) {
  const pal = ART_PALETTE.slice();
  pal[2] = BIRD_COLOURS[colour].body;
  pal[13] = BIRD_COLOURS[colour].belly;
  // Entries 5 (flower) and 11 (star/iris) are added by the dizzy overlay, so
  // they must not capture body pixels during conversion.  Magenta appears in
  // none of the birds; park the offending entry there.
  if (colour === 'purple') pal[5] = 0xe3;
  if (colour === 'yellow') pal[11] = 0xe3;
  return pal.map(expand);
}

function quant(r, g, b, a = 255, palRGB = PAL) {
  if (a === 0) return 0;
  let best = 1, bd = Infinity;
  // indices 1..15; index 0 is the sky/transparent key
  for (let i = 1; i < 16; i++) {
    const [pr, pg, pb] = palRGB[i];
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
function resizeIndexed(img, x0, y0, sw, sh, dw, dh, palRGB = PAL) {
  const out = [];
  for (let y = 0; y < dh; y++) {
    const row = [];
    const sy = y0 + Math.floor((y + 0.5) * sh / dh);
    for (let x = 0; x < dw; x++) {
      const sx = x0 + Math.floor((x + 0.5) * sw / dw);
      const [r, g, b, a] = sample(img, sx, sy);
      row.push(quant(r, g, b, a, palRGB));
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

  // order: body L/M/R, cap-up L/M/R, cap-down L/M/R, grass, dirt, cloud L/M/R
  return [
    ...split3(bodyGrid),
    ...split3(capGrid),
    ...split3(capDown),
    grassTop,
    dirt,
    ...split3(softCloud()),
  ];
}

// A small cloud from the pack's two cloud colours: three puffs, 24x15.
function softCloud() {
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
  return cloud;
}

// The cloud as a 32x32 sprite: 24x15 art at x 4..27, top row 0.
export function cloudSprite() {
  const src = softCloud();
  const out = Array.from({ length: 32 }, () => Array(32).fill(0));
  for (let y = 0; y < 15; y++) for (let x = 0; x < 24; x++) out[y][x + 4] = src[y][x];
  return out;
}

const BIRD_FILES = {
  red: 'Red_Bird.png',
  purple: 'Purple_Bird.png',
  yellow: 'Yellow_Bird.png',
};
const BIRD_BOXES = [[4, 9], [52, 9], [4, 57], [52, 57]];

export function birdFrames(colour = 'red') {
  const sheet = decodePng(new URL(`../assets/art/${BIRD_FILES[colour]}`, import.meta.url));
  const palRGB = birdPalette(colour);
  return BIRD_BOXES.map(([x, y]) => {
    // 40x30 source -> 32x30, one transparent row above and below
    const f = Array.from({ length: 32 }, () => Array(32).fill(0));
    const g = resizeIndexed(sheet, x, y, 40, 30, 32, 30, palRGB);
    for (let yy = 0; yy < 30; yy++) for (let xx = 0; xx < 32; xx++) {
      const v = g[yy][xx];
      // 5/11 are the dizzy flower and star; the source bird has neither, so
      // any such pixel is a quantisation stray.  Fold it into the body.
      f[yy + 1][xx] = (v === 5 || v === 11) ? 2 : v;
    }
    return f;
  });
}

// The bedazzled pose from the paid pack's promo: a black headband across the
// head with a purple flower and a yellow star, and the eye recoloured to the
// orange iris inside its blue ring.  The flower and star slide along the band
// between the three poses, which is the whole animation.  Each bird gets its
// own band/eye coordinates because the three bodies are not the same shape.
const DIZZY = {
  red: {
    band: { y: 7, x0: 7, x1: 19, cyan: [14, 15] },
    eye: { x0: 22, y0: 10, x1: 23, y1: 11, cyan: [23, 9] },
    flower: [[11, 4], [13, 3], [9, 5]],
    star: [[25, 4], [27, 3], [24, 5]],
  },
  purple: {
    band: { y: 7, x0: 7, x1: 19, cyan: [14, 15] },
    eye: { x0: 22, y0: 12, x1: 24, y1: 13, cyan: [21, 10] },
    flower: [[8, 5], [10, 4], [7, 6]],
    star: [[25, 4], [27, 3], [24, 5]],
  },
  yellow: {
    band: { y: 13, x0: 9, x1: 17, cyan: [12, 13] },
    eye: { x0: 20, y0: 15, x1: 21, y1: 16, cyan: [19, 14] },
    flower: [[11, 11], [13, 10], [10, 12]],
    star: [[21, 9], [23, 8], [20, 10]],
  },
};

export function dizzyFrames(colour = 'red') {
  const purple = 5, yellow = 11, cyan = 10, black = 8;
  const cfg = DIZZY[colour];

  const flower = (g, cx, cy) => {
    for (const [x, y] of [[cx, cy - 1], [cx - 1, cy], [cx + 1, cy], [cx, cy + 1]]) g[y][x] = purple;
    g[cy][cx] = yellow;
    g[cy + 2][cx] = black;              // stem down to the band
  };
  const star = (g, cx, cy) => {
    for (const [x, y] of [[cx, cy - 1], [cx - 1, cy], [cx, cy], [cx + 1, cy], [cx, cy + 1]]) g[y][x] = yellow;
  };
  const pose = (fi) => {
    const g = birdFrames(colour)[1].map((r) => r.slice());
    const b = cfg.band, e = cfg.eye;
    for (let x = b.x0; x <= b.x1; x++) g[b.y][x] = black;
    g[b.y][b.cyan[0]] = cyan;
    g[b.y][b.cyan[1]] = cyan;
    for (let y = e.y0; y <= e.y1; y++) for (let x = e.x0; x <= e.x1; x++) g[y][x] = yellow;
    g[e.cyan[1]][e.cyan[0]] = cyan;
    const [fx, fy] = cfg.flower[fi];
    const [sx, sy] = cfg.star[fi];
    flower(g, fx, fy);
    star(g, sx, sy);
    return g;
  };
  return [pose(0), pose(1), pose(2)];
}

export function artPreview() {
  const ch = (i) => '0123456789abcdef'[i] || '?';
  const tiles = artTiles();
  const show = (name, grid) => {
    console.log('--- ' + name);
    for (const row of grid) console.log(row.map((i) => ch(i)).join(''));
  };
  for (const colour of BIRD_ORDER) {
    birdFrames(colour).forEach((f, i) => show(`${colour} bird ${i}`, f));
    dizzyFrames(colour).forEach((f, i) => show(`${colour} dizzy ${i}`, f));
  }
  show('cloud sprite', cloudSprite());
  // stitch the 3-column pipe body/cap for a readable preview
  const join3 = (a, b, c) => a.map((row, y) => [...row, ...b[y], ...c[y]]);
  show('pipe body', join3(tiles[0], tiles[1], tiles[2]));
  show('pipe cap up', join3(tiles[3], tiles[4], tiles[5]));
  show('pipe cap down', join3(tiles[6], tiles[7], tiles[8]));
  show('grass', tiles[9]);
  show('dirt', tiles[10]);
  show('cloud tiles', join3(tiles[11], tiles[12], tiles[13]));
}

const isMain = process.argv[1] && process.argv[1].endsWith('make_art.mjs');
if (isMain) artPreview();
