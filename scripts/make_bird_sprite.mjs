#!/usr/bin/env node
// scripts/make_bird_sprite.mjs - bake the bird into the sprite bank: two
// wing poses in groups 6..7 and the three bedazzled poses in groups 3..5.
// Groups 0..2 stay for the colour demo; the game never writes the sprite bank
// at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { birdFrames, dizzyFrames } from './make_art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIRD_GROUPS = [6, 7];
export const DIZZY_GROUPS = [3, 4, 5];
export const SPRITE_WORDS = 128 * 16;

function writeFrame(words, group, g) {
  const base = group * 16 * 16;            // 16 tiles x 16 words
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const tile = ty * 4 + tx;
      for (let row = 0; row < 8; row++) {
        for (let half = 0; half < 2; half++) {
          let w = 0;
          for (let n = 0; n < 4; n++) {
            const x = tx * 8 + half * 4 + n;
            const y = ty * 8 + row;
            w |= (g[y][x] & 0xF) << (n * 4);
          }
          words[base + tile * 16 + row * 2 + half] = w;
        }
      }
    }
  }
}

export function birdSpriteWords() {
  const words = new Array(SPRITE_WORDS).fill(0);
  // Frames 2 and 3 are near-duplicates of 1, so two poses carry the wing beat.
  birdFrames().slice(0, BIRD_GROUPS.length)
    .forEach((g, fi) => writeFrame(words, BIRD_GROUPS[fi], g));
  dizzyFrames().forEach((g, fi) => writeFrame(words, DIZZY_GROUPS[fi], g));
  return words;
}

export function writeBirdSprite(outDir) {
  const words = birdSpriteWords();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'birdsprite.hex'),
                   words.map((w) => w.toString(16).padStart(4, '0')).join('\n') + '\n');
  return words.length;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = path.resolve(process.argv[2] ?? path.join(ROOT, 'artifacts', 'image'));
  const n = writeBirdSprite(out);
  console.log(`wrote ${path.relative(ROOT, out)}/birdsprite.hex (${n} words, wing ${BIRD_GROUPS.join(',')} + dizzy ${DIZZY_GROUPS.join(',')})`);
}
