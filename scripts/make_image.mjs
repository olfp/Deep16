#!/usr/bin/env node
// scripts/make_image.mjs - build the D16MINI boot image from asm/forth.asm.
//
// D16MINI.md §6.5. The image is the UART (CONSOLE_UART) kernel laid into the
// 24K-word BSRAM window (0x0000-0x5FFF) and filled with 0xFFFF, so a run off the
// end of memory hits the halt word instead of `LDI 0` forever (§6.1).
// (24K, not 26 - GowinSynthesis' BSRAM granularity; §2 and §4.7.)
//
// The image is a *synthesis* input - Gowin bakes it into the bitstream, so the
// configuration itself is the "flash to RAM" step (§6.2.1). Two files:
//
//   image.hex   $readmemh, 8 words per line - for Verilator
//   image.mi    one word per line - Gowin INIT_FILE (dialect to confirm on EDK)
//
// plus image.manifest.json (range, fill, build id).
//
// Usage:
//   npm run image                     # writes artifacts/image/
//   npm run image -- --out=/tmp/x     # choose the directory
//   npm run image -- --check          # assert only, write nothing
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeTileFont } from './make_tile_font.mjs';
import { writeBirdSprite } from './make_bird_sprite.mjs';
import { writePs2Map } from './make_ps2map.mjs';
import { buildShowcase, checkShowcase, SHOWCASE_SEG_BASE } from './make_showcase.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const NANO = !!process.env.D16NANO;
// D16D is the user-flash Flappy showcase: the kernel gains the gfx BIOS call
// and word, and the showcase menu/game block rides in the BIOS segment. The
// packed BSRAM console is built without it (the tile kernel already fills the
// 16-block budget).
export const D16D = !!process.env.D16D;
// The flat image is the 24K window; the showcase sits in the BIOS segment
// between the BIOS code and the Forth stacks, so both sizes stay 24K.
export const WINDOW = 0x6000;
export const FILL   = 0xFFFF;      // the halt word, everywhere unused (§6.1)
export const IMG_BLOCK_WORDS = 0x4000; // 16 BSRAM blocks: the packed-image budget
export const BIOS_BASE  = process.env.D16NANO ? 0x4A00 : 0x5600;  // must match the kernel's .org
export const STACK_BASE = 0x5800;  // RSTACK_TOP: the dictionary stays below it
export const FLASH_MAGIC  = 0x44313646; // 'D16F', first 32-bit word of the flash header
export const FLASH_FORMAT = 1;         // header format
export const FLASH_HDR_WORDS = 64;     // 32-bit words reserved before the image
export const ECHO_FLAG  = 0xF0064; // the kernel's echo cell: outside the window,
                                   // so the board neither backs nor decodes it
                                   // (D16MINI.md §6.4) - it is expected here

function loadAssembler() {
  globalThis.window = globalThis.window || {};
  // A top-level `class` lands in the global lexical scope, so a second run would
  // throw "already declared" - reuse it if something (a test) loaded it first.
  try { return vm.runInThisContext('Deep16Assembler'); } catch { /* not yet */ }
  const file = path.join(ROOT, 'js', 'deep16_assembler.js');
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: 'deep16_assembler.js' });
  return vm.runInThisContext('Deep16Assembler');
}

// Assemble the kernel and lay it into the window. Returns the words plus the
// facts the assertions and the manifest need.
export const DEFINES = { CONSOLE_UART: 1 };
if (NANO) DEFINES.D16NANO = 1;                       // D16nano: software divide
if (process.env.D16SEG) DEFINES.D16SEG = 1;          // segmented data stack (tile build)
if (D16D) DEFINES.D16D = 1;                          // gfx BIOS call + word
if (process.env.BOOT_DIAG) DEFINES.BOOT_DIAG = 1;     // boot diagnostic build

export function buildImage() {
  const Deep16Assembler = loadAssembler();
  const sourceName = NANO ? 'forth_nano.asm' : 'forth.asm';
  const source = fs.readFileSync(path.join(ROOT, 'asm', sourceName), 'utf8');
  const res = new Deep16Assembler().assemble(source, { defines: DEFINES });
  if (!res.success) throw new Error(`${sourceName} does not assemble: ` + res.errors.join('; '));

  const words = new Uint16Array(WINDOW).fill(FILL);
  const outOfWindow = new Set();
  for (const c of res.memoryChanges) {
    if (c.address < WINDOW) words[c.address] = c.value & 0xFFFF;
    else outOfWindow.add(c.address);
  }

  const sym = res.symbols;
  const biosWords = (() => {
    let hi = 0;
    for (const c of res.memoryChanges) {
      if (c.address >= sym.bios_entry && c.address < WINDOW) hi = Math.max(hi, c.address);
    }
    return hi - sym.bios_entry + 1;
  })();

  // The D16D showcase block lives in the BIOS segment 0x04A0, in the free gap
  // above the BIOS and below the stacks. It rides in the same 24K flat image,
  // so the standard flash loader/installer copy and verify it.
  let showcase = null;
  if (D16D) {
    showcase = buildShowcase();
    checkShowcase(showcase);
    for (const [addr, value] of showcase.words) {
      const pa = SHOWCASE_SEG_BASE + addr;
      if (pa < WINDOW) words[pa] = value;
      else outOfWindow.add(pa);
    }
  }

  const build = crypto.createHash('sha256')
    .update(source)
    .update(showcase?.build ?? '')
    .digest('hex').slice(0, 16);

  return {
    words, outOfWindow: [...outOfWindow].sort((a, b) => a - b),
    dictFree: sym.dict_free, biosEntry: sym.bios_entry, biosWords, build, showcase,
  };
}

// The invariants §6.5 names. Throws with a readable message; the CLI and the
// test both call it.
export function checkImage(img) {
  const fail = [];
  if (img.dictFree >= STACK_BASE) fail.push(`dict_free 0x${img.dictFree.toString(16)} reaches the stacks (0x${STACK_BASE.toString(16)})`);
  if (img.dictFree > img.biosEntry) fail.push(`dict_free 0x${img.dictFree.toString(16)} runs into the BIOS at 0x${img.biosEntry.toString(16)}`);
  if (img.biosEntry !== BIOS_BASE) fail.push(`BIOS at 0x${img.biosEntry.toString(16)}, expected 0x${BIOS_BASE.toString(16)}`);
  if (img.biosEntry + img.biosWords > STACK_BASE) fail.push(`BIOS (${img.biosWords} words) overruns the stacks`);
  // The only word outside the window is the kernel's echo cell, which the board
  // neither backs nor decodes (§6.4) - anything else means the kernel grew a
  // high address the board cannot back.
  const unexpected = img.outOfWindow.filter((a) => a !== ECHO_FLAG);
  if (unexpected.length) fail.push(`words outside the window: ${unexpected.map((a) => '0x' + a.toString(16)).join(', ')}`);
  if (D16D && !img.showcase) fail.push('D16D image has no showcase block');
  if (D16D && img.showcase) checkShowcase(img.showcase);
  if (fail.length) throw new Error('boot image is not valid:\n  - ' + fail.join('\n  - '));
  return true;
}

export function imageHex(img, perLine = 8) {
  let out = '';
  for (let i = 0; i < img.words.length; i++) {
    out += img.words[i].toString(16).padStart(4, '0');
    out += ((i + 1) % perLine === 0) ? '\n' : ' ';
  }
  return out.replace(/ +$/, '') + '\n';
}

export function imageMi(img) {
  // One hex word per line. Gowin's INIT_FILE dialect is not verifiable here
  // (no toolchain); this is the shape EDK reads, to confirm on first synthesis.
  let out = '';
  for (let i = 0; i < img.words.length; i++) out += img.words[i].toString(16).padStart(4, '0') + '\n';
  return out;
}

// Range packing (deep16_psram_mem's loader format).
//
// The flat image is 24,576 words of which only ~15.7k are not FILL: the
// dictionary has reserved gaps, the stacks are empty, and the BIOS sits above
// them. Storing only the non-FILL runs in the BSRAM image costs 16 blocks
// instead of 24 (Gowin pads BSRAM depth to 4,096-word slices, so 24,576 rounds
// up to 24 blocks while 15,700 fits in 16). The loader walks the runs and
// writes FILL everywhere else; the verify walks the same runs.
//
//   word 0            range count N
//   words 1..2N       (start, end) pairs, inclusive, ascending
//   words 2N+1..       the contents of each range, concatenated
export function packImage(img) {
  const ranges = [];
  for (let i = 0; i < img.words.length;) {
    if (img.words[i] === FILL) { i++; continue; }
    const start = i;
    while (i < img.words.length && img.words[i] !== FILL) i++;
    ranges.push([start, i - 1]);
  }
  const words = [ranges.length];
  for (const [s, e] of ranges) words.push(s, e);
  for (const [s, e] of ranges) for (let a = s; a <= e; a++) words.push(img.words[a]);
  return { words, ranges };
}

// The inverse, used by the tests: a packed image must expand exactly.
export function expandImage(packed) {
  const count = packed[0];
  const words = new Uint16Array(WINDOW).fill(FILL);
  let src = 1 + 2 * count;
  for (let r = 0; r < count; r++) {
    const start = packed[1 + 2 * r], end = packed[2 + 2 * r];
    for (let a = start; a <= end; a++) words[a] = packed[src++];
  }
  return { words, src };
}

// The one invariant packing must never break: the loader's 16 blocks hold it,
// and expanding it gives back the flat image exactly.
export function checkPacked(img, packed) {
  const fail = [];
  if (packed.words.length > IMG_BLOCK_WORDS)
    fail.push(`packed image is ${packed.words.length} words, over the ${IMG_BLOCK_WORDS}-word (16-block) budget`);
  // The count lives in one word; the loader reads it into a 5-bit register.
  if (packed.ranges.length > 31) fail.push(`${packed.ranges.length} ranges do not fit the header counter`);
  const back = expandImage(packed.words).words;
  for (let a = 0; a < WINDOW; a++) {
    if (back[a] !== img.words[a]) {
      fail.push(`range expansion differs at 0x${a.toString(16)}: 0x${back[a].toString(16)} vs 0x${img.words[a].toString(16)}`);
      break;
    }
  }
  if (fail.length) throw new Error('packed boot image is not valid:\n  - ' + fail.join('\n  - '));
  return true;
}


// CRC-16/CCITT-FALSE over the flat image, low byte then high byte of each
// 16-bit word, MSB first inside each byte. The RTL loader uses exactly this.
export function crc16Bytes(bytes) {
  let crc = 0xFFFF;
  for (const b of bytes) {
    crc ^= (b & 0xFF) << 8;
    for (let i = 0; i < 8; i++) {
      crc = ((crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)) & 0xFFFF;
    }
  }
  return crc & 0xFFFF;
}

export function crc16(words) {
  const bytes = [];
  for (const w of words) bytes.push(w & 0xFF, (w >> 8) & 0xFF);
  return crc16Bytes(bytes);
}

// The user-flash image: a 64-word header, then the flat 16-bit image packed
// two words per 32-bit flash word. Header word 0 = magic, 1 = format,
// 2 = image words, 3 = CRC16, 4 = build id (0), 5..7 = reserved.
export function flashImage(img) {
  const crc = crc16(img.words);
  const words = new Uint32Array(FLASH_HDR_WORDS + img.words.length / 2);
  words[0] = FLASH_MAGIC;
  words[1] = FLASH_FORMAT;
  words[2] = img.words.length;
  words[3] = crc;
  words[4] = parseInt(img.build.slice(0, 8), 16) >>> 0;
  words[5] = 0; words[6] = 0; words[7] = 0;
  for (let i = 0; i < img.words.length; i += 2) {
    words[FLASH_HDR_WORDS + i / 2] = (img.words[i] | (img.words[i + 1] << 16)) >>> 0;
  }
  return { words, crc };
}

// The installer ROM is sized at build time. The standard image fills it; the
// D16nano image leaves room for the demo at 0x6000 and pads the tail with the
// erased value, so the on-die flash beyond the programmed words stays FILL.
export const INSTALLER_WORDS = 12352;

export function installerFlash(img) {
  const flash = flashImage(img);
  const out = new Uint32Array(INSTALLER_WORDS).fill(0xFFFFFFFF);
  for (let i = 0; i < Math.min(out.length, flash.words.length); i++) out[i] = flash.words[i];
  return out;
}

export function flashHex(flash) {
  const words = Array.isArray(flash) || flash instanceof Uint32Array ? flash : flash.words;
  return Array.from(words).map((w) => w.toString(16).padStart(8, '0')).join('\n') + '\n';
}

export function manifest(img) {
  const pack = D16D ? null : packImage({ words: img.words });
  return JSON.stringify({
    project: 'D16MINI',
    source: 'asm/forth.asm',
    defines: DEFINES,
    base: '0x00000',
    window: `0x${(WINDOW - 1).toString(16)}`,
    words: WINDOW,
    fill: '0xFFFF',
    dict_free: `0x${img.dictFree.toString(16)}`,
    bios_entry: `0x${img.biosEntry.toString(16)}`,
    bios_words: img.biosWords,
    stack_base: `0x${STACK_BASE.toString(16)}`,
    build: img.build,
    pack: pack ? {
      format: 'count, (start,end) pairs, payload ranges',
      words: pack.words.length,
      blocks: Math.ceil(pack.words.length / 1024),
      ranges: pack.ranges.length,
    } : null,
    flash: {
      format: '64-word header, then flat image, two 16-bit words per 32-bit word',
      image_words: img.words.length,
      words: flashImage(img).words.length,
      installer_words: INSTALLER_WORDS,
      header_words: FLASH_HDR_WORDS,
      crc16: `0x${flashImage(img).crc.toString(16).padStart(4, '0')}`,
    },
    showcase: img.showcase ? {
      source: 'asm/showcase/showcase.asm + asm/showcase/flappy_game.asm',
      base: `0x${SHOWCASE_SEG_BASE.toString(16)}`,
      min: `0x${img.showcase.min.toString(16)}`,
      max: `0x${img.showcase.max.toString(16)}`,
      build: img.showcase.build,
    } : null,
  }, null, 2) + '\n';
}

// --------------------------------------------------------------------------
function argValue(name, fallback) {
  const hit = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!hit) return fallback;
  if (hit === name) return true;
  return hit.slice(name.length + 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const img = buildImage();
  checkImage(img);
  const outDir = path.resolve(ROOT, String(argValue('--out', 'artifacts/image')));
  const check = argValue('--check', false);
  // The packed 16-block BSRAM image exists only for the packed console. The
  // D16D user-flash build does not load it (the kernel with the gfx additions is
  // over the 16-block budget); its state is the flat 32K flash image.
  const kernel = { words: new Uint16Array(img.words.length).fill(FILL) };
  kernel.words.set(img.words.subarray(0, 0x6000));
  if (!check) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'image.hex'), imageHex(kernel));
    fs.writeFileSync(path.join(outDir, 'image.mi'), imageMi(kernel));
    if (!D16D) {
      const packed = packImage(kernel);
      checkPacked(kernel, packed);
      fs.writeFileSync(path.join(outDir, 'image-packed.hex'),
                       imageHex({ words: packed.words }));
    } else {
      // The D16D image is user-flash only; do not leave a stale packed image
      // from an earlier build where the flash bitstream might find it.
      try { fs.unlinkSync(path.join(outDir, 'image-packed.hex')); } catch { /* none */ }
    }
    fs.writeFileSync(path.join(outDir, 'image.manifest.json'), manifest(img));
    // The DVI text renderer reads its font with $readmemh too; keep it beside
    // the image so the Gowin include path and the board sims both find it.
    fs.copyFileSync(path.join(ROOT, 'rtl', 'dvi', 'font8x15.hex'),
                    path.join(outDir, 'font8x15.hex'));
    // The tile engine's 32-word 4bpp bank and its palette, generated from the
    // same 8x15 font so the text console and the tile console cannot drift.
    writeTileFont(outDir, path.join(ROOT, 'rtl', 'dvi', 'font8x15.hex'));
    writeBirdSprite(outDir);
    // PS/2 Set-2 -> ASCII map: a BSRAM pROM read by rtl/ps2_rx.sv.
    writePs2Map(outDir);
    // The same words serve the on-die installer fallback and the config-flash
    // boot image at 0x100000.
    const installerWords = installerFlash(img);
    fs.writeFileSync(path.join(outDir, 'image.flash.hex'), flashHex(installerWords));
    // Full 76 KB boot image for config-flash 0x100000 (and the installer's
    // User Flash Initialization): the installer's 12,352 words at 0, 0xFF
    // beyond, little-endian.
    const BOOT_BYTES = 0x13000;   // 608 Kbit
    const bootImage = Buffer.alloc(BOOT_BYTES, 0xFF);
    for (let i = 0; i < installerWords.length && i * 4 + 4 <= BOOT_BYTES; i++)
      bootImage.writeUInt32LE(installerWords[i] >>> 0, i * 4);
    fs.writeFileSync(path.join(outDir, 'image.flash.bin'), bootImage);
  }
  const kb = (img.words.length * 2 / 1024).toFixed(0);
  console.log(`boot image: ${img.words.length} words (${kb} KiB), fill 0xFFFF, build ${img.build}`);
  console.log(`  dict_free 0x${img.dictFree.toString(16)}  BIOS 0x${img.biosEntry.toString(16)} (${img.biosWords} words)  stacks 0x${STACK_BASE.toString(16)}`);
  console.log(`  outside the window (dropped: the board does not back it): ${img.outOfWindow.map((a) => '0x' + a.toString(16)).join(', ') || 'none'}`);
  if (D16D) {
    console.log('  packed: not built (D16D user-flash image; the gfx kernel is over 16 blocks)');
  } else {
    const pack = packImage(kernel);
    console.log(`  packed: ${pack.ranges.length} ranges, ${pack.words.length} words ` +
                `(${Math.ceil(pack.words.length / 1024)} BSRAM blocks of ${IMG_BLOCK_WORDS / 1024})`);
  }
  const flash = flashImage(img);
  console.log(`  boot image: ${flash.words.length} x 32-bit words, installer ${INSTALLER_WORDS}, CRC16 0x${flash.crc.toString(16).padStart(4, '0')}`);
  console.log(`  config-flash boot file: image.flash.bin (0x13000 = 608 Kbit, 0xFF padded)`);
  if (!check) {
    const files = D16D
      ? 'image.hex, image.mi, image.flash.hex, image.flash.bin, image.manifest.json'
      : 'image.hex, image-packed.hex, image.mi, image.flash.hex, image.flash.bin, image.manifest.json';
    console.log(`  wrote ${path.relative(ROOT, outDir)}/${files}`);
  }
  else console.log('  --check: nothing written');
}
