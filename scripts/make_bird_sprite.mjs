#!/usr/bin/env node
// scripts/make_bird_sprite.mjs - bake the three birds and the cloud into the
// sprite bank.  Pac-Man's frames live in the Pac-Man slice, not here.  Groups
// are absolute; the game selects a page (0 red, 1 purple, 2 yellow) and keeps
// using relative groups 3..7 for the bird:
//
//   page 0/1/2  rel 2  cloud
//               rel 3..5  bedazzled poses
//               rel 6..7  wing poses
//
// Page 0 rel 0..1 are unused (the colour demo was removed).
// The cloud is duplicated on all three pages so the same OAM group works
// whichever bird is picked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIRD_ORDER, birdFrames, dizzyFrames, cloudSprite } from './make_art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIRD_GROUPS = [6, 7];
export const DIZZY_GROUPS = [3, 4, 5];
export const CLOUD_GROUP = 2;
export const SPRITE_GROUPS = 24;          // source pack: three bird pages
export const SPRITE_WORDS = SPRITE_GROUPS * 16 * 16;
export const BAKED_SPRITE_GROUPS = 24;    // resident bank
export const BAKED_SPRITE_WORDS = BAKED_SPRITE_GROUPS * 16 * 16;

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
  BIRD_ORDER.forEach((colour, page) => {
    const base = page * 8;                 // page = 8 groups
    writeFrame(words, base + CLOUD_GROUP, cloudSprite());
    dizzyFrames(colour).forEach((g, i) => writeFrame(words, base + DIZZY_GROUPS[i], g));
    // Frames 2 and 3 are near-duplicates of 1, so two poses carry the wing beat.
    birdFrames(colour).slice(0, BIRD_GROUPS.length)
      .forEach((g, i) => writeFrame(words, base + BIRD_GROUPS[i], g));
  });
  // Pac-Man is not part of this set.  Its slice carries pac_sprite_data and
  // pac_ghost_data and copies them into the bank at startup, so the baked
  // bank and the Flappy pack stay bird/cloud-only.
  return words;
}

// The bitstream's resident bank is 24 groups: all three bird pages and the
// shared cloud are baked. Flappy still copies its selected page into groups
// 0..7 at run time, so the baked content is the fallback for other scenes.
export function bakedBirdSpriteWords() {
  return birdSpriteWords();
}

const hex = (words) =>
  words.map((w) => w.toString(16).padStart(4, '0')).join('\n') + '\n';

export function writeBirdSprite(outDir) {
  const words = bakedBirdSpriteWords();
  fs.mkdirSync(outDir, { recursive: true });
  // The RTL keeps the bank as two power-of-two arrays (4,096 + 2,048 words).
  // One 6,144-word array makes the tool fall back to a much wider read mux
  // and costs over 300 logic cells, so the split is a resource decision, not
  // a cosmetic one. The single full file stays for tooling and archives.
  fs.writeFileSync(path.join(outDir, 'birdsprite.hex'), hex(words));
  fs.writeFileSync(path.join(outDir, 'birdsprite_lo.hex'), hex(words.slice(0, 4096)));
  fs.writeFileSync(path.join(outDir, 'birdsprite_hi.hex'), hex(words.slice(4096)));
  return words.length;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = path.resolve(process.argv[2] ?? path.join(ROOT, 'artifacts', 'image'));
  const n = writeBirdSprite(out);
  console.log(`wrote ${path.relative(ROOT, out)}/birdsprite.hex (${n} words, three pages + cloud)`);
}
