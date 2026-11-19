#!/usr/bin/env node
// Shared format for 32x32 sprite frames carried in a game's binary slice.
//
// A sprite pack sits at SPR_PACK_OFFSET in the game's segment:
//   word 0  SPR_MAGIC
//   word 1  frame count
//   then per frame: the absolute sprite-bank group, followed by its 256 words
//   (16 8x8 patterns: tile = (row >> 3) * 4 + (col >> 3), 16 words each).
//
// Sprite index 0 is transparent. The game entry installs the pack into the
// writable sprite bank, so the global bitstream sprite bank needs no game art.
export const SPR_PACK_OFFSET = 0x2000;
export const SPR_MAGIC = 0x0a58;
export const SPRITE_GROUP_WORDS = 256;

// One 32x32 indexed frame as 256 words: 16 8x8 tiles, two rows per word,
// four 4bpp pixels per word, exactly the layout of the sprite bank.
export function spriteFrameWords(grid) {
  if (!Array.isArray(grid) || grid.length !== 32 ||
      grid.some((row) => !Array.isArray(row) || row.length !== 32)) {
    throw new Error('a sprite frame must be a 32x32 grid');
  }
  const out = new Array(SPRITE_GROUP_WORDS).fill(0);
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const tile = ty * 4 + tx;
      for (let row = 0; row < 8; row++) {
        for (let half = 0; half < 2; half++) {
          let word = 0;
          for (let n = 0; n < 4; n++) {
            const x = tx * 8 + half * 4 + n;
            const y = ty * 8 + row;
            word |= (grid[y][x] & 0x0f) << (n * 4);
          }
          out[tile * 16 + row * 2 + half] = word & 0xffff;
        }
      }
    }
  }
  return out;
}

export function spritePack(frames) {
  const words = [SPR_MAGIC, frames.length];
  for (const { group, grid } of frames) {
    words.push(group & 0xffff);
    words.push(...spriteFrameWords(grid));
  }
  return words;
}
