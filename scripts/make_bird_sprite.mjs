#!/usr/bin/env node
// Flappy's sprite frames and the legacy global sprite-bank image.
//
// Flappy's art is no longer baked into the bitstream's sprite bank. It rides
// in the Flappy binary slice as a sprite pack at offset 0x2000 and the game
// installs it into the writable sprite bank on entry.
//
// The frames use absolute sprite-bank groups:
//   group 2       cloud
//   groups 3..5   bedazzled poses
//   groups 6..7   wing poses
//   groups 11..15 and 19..23  the same poses for the Purple and Yellow birds
//
// The 24-group global bank remains for the hardware image format, but it is
// blank. Each game owns its groups and installs its own pack.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIRD_ORDER, birdFrames, dizzyFrames, cloudSprite } from './make_art.mjs';
import { spritePack } from './make_sprite_pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIRD_GROUPS = [6, 7];
export const DIZZY_GROUPS = [3, 4, 5];
export const CLOUD_GROUP = 2;
export const SPRITE_GROUPS = 24;
export const SPRITE_WORDS = SPRITE_GROUPS * 16 * 16;

export function flappySpriteFrames() {
  const frames = [{ group: CLOUD_GROUP, grid: cloudSprite() }];
  BIRD_ORDER.forEach((colour, page) => {
    const base = page * 8;
    dizzyFrames(colour).forEach((grid, i) => {
      frames.push({ group: base + DIZZY_GROUPS[i], grid });
    });
    // Frames 2 and 3 are near-duplicates of 1, so two poses carry the wing beat.
    birdFrames(colour).slice(0, BIRD_GROUPS.length).forEach((grid, i) => {
      frames.push({ group: base + BIRD_GROUPS[i], grid });
    });
  });
  return frames;
}

export function flappySpritePack() {
  return spritePack(flappySpriteFrames());
}

// The bitstream keeps the sprite-bank shape but no game art. The menu has no
// sprites; a game installs the pack carried by its own slice.
export function birdSpriteWords() {
  return new Array(SPRITE_WORDS).fill(0);
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
  console.log(`wrote ${path.relative(ROOT, out)}/birdsprite.hex (${n} blank words; game art rides in slices)`);
}
