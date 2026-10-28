#!/usr/bin/env node
// scripts/make_screens.mjs - turn Forth source files into SD-card or user-flash
// screens.
//
// SD: the card has no file system: a source file is a run of 512-byte sectors,
// lines separated by LF, the tail padded with LF (see `include` in
// forth/demo.fth). This writes one blob with every file starting on a sector
// boundary and prints the sector range and the dd command that puts it on the
// card at a chosen sector.
//
// FLASH: a screen is one 2 KB page of the on-die FLASH608K, four characters per
// 32-bit word (little-endian, the order the CPU read port returns). Pages 25..
// 37 are free: 0x3200 + n*512 in 32-bit flash words, which is what
// `screen ( n -- )` in forth/demo.fth reads. A source file must fit 2048 bytes;
// the tail is padded with LF, so an empty line is a no-op.
//
//   node scripts/make_screens.mjs screens/starfield.fth
//   node scripts/make_screens.mjs screens/flash/hello.fth --flash
//   node scripts/make_screens.mjs a.fth b.fth --start=100 --out=/tmp/sd.bin
//
// Then, with the card unmounted (the whole device, not a partition):
//   sudo dd if=artifacts/sd/screens.bin of=/dev/rdiskN bs=512 seek=<start> conv=notrunc
// or into the user flash (the npm run flash:tile route does this from the
// image build; this is the standalone equivalent):
//   sudo dd if=artifacts/flash/screens.bin of=/dev/rdiskN bs=512 seek=100 conv=notrunc
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECTOR = 512;
export const SCREEN_BYTES = 2048;      // one flash page
export const SCREEN_WORDS = 512;       // 32-bit flash words in a screen
export const SCREEN_BASE = 0x3200;     // first free 32-bit flash word
export const SCREEN_PAGES = 13;        // pages 25..37: 0x3200..0x49FF

// A flash screen is one page, four characters per 32-bit word, LF padded.
export function packScreen(text) {
  const normal = text.replace(/\r\n?/g, '\n');
  normal.split('\n').forEach((line, i) => {
    if (line.length > 120)
      throw new Error(`line ${i + 1} is ${line.length} characters (limit 120)`);
  });
  const bytes = Buffer.from(normal, 'latin1');
  if (bytes.length > SCREEN_BYTES)
    throw new Error(`${bytes.length} bytes - a flash screen is one 2 KB page`);
  const page = Buffer.alloc(SCREEN_BYTES, 10);        // LF padding
  bytes.copy(page);
  const words = new Uint32Array(SCREEN_WORDS);
  for (let i = 0; i < SCREEN_WORDS; i++)
    words[i] = (page[i * 4] | (page[i * 4 + 1] << 8) |
                (page[i * 4 + 2] << 16) | (page[i * 4 + 3] << 24)) >>> 0;
  return { page, words };
}

// The screens baked into the image, one per sorted .fth in the directory.
export function loadScreens(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.fth')).sort()
    .map((name, index) => {
      const file = path.join(dir, name);
      return { name, file, index, ...packScreen(fs.readFileSync(file, 'utf8')) };
    });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const a = args.find((v) => v.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : dflt;
  };
  const flash = args.includes('--flash');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: make_screens.mjs <file.fth> [...] [--flash] [--start=N] [--out=FILE]');
    process.exit(1);
  }
  const out = path.resolve(ROOT, opt('out', flash ? 'artifacts/flash/screens.bin' : 'artifacts/sd/screens.bin'));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  if (flash) {
    const first = Number(opt('first', '0'));
    if (!Number.isInteger(first) || first < 0 || first + files.length > SCREEN_PAGES) {
      console.error(`--first must leave the screens inside pages 0..${SCREEN_PAGES - 1}`);
      process.exit(1);
    }
    const pages = [];
    const rows = [];
    for (const f of files) {
      let packed;
      try { packed = packScreen(fs.readFileSync(f, 'utf8')); }
      catch (e) { console.error(`${f}: ${e.message}`); process.exit(1); }
      pages.push(packed.page);
      rows.push({ file: path.relative(ROOT, f), page: first + rows.length });
    }
    fs.writeFileSync(out, Buffer.concat(pages));
    const width = Math.max(...rows.map((r) => r.file.length));
    for (const r of rows)
      console.log(`  ${r.file.padEnd(width)}  screen ${String(r.page).padStart(2)}  ->  ${r.page} screen`);
    console.log(`\n  ${out}  (${pages.length * SCREEN_BYTES} bytes, screens ${first}..${first + pages.length - 1})`);
    console.log(`  also baked into the image by scripts/make_image.mjs; standalone write:`);
    console.log(`    sudo dd if=${path.relative(process.cwd(), out)} of=/dev/rdiskN bs=512 seek=${(SCREEN_BASE + first * SCREEN_WORDS) * 4 / 512} conv=notrunc`);
    process.exit(0);
  }

  const start = Number(opt('start', '1'));
  if (start < 0 || !Number.isInteger(start)) {
    console.error('--start must be a sector number');
    process.exit(1);
  }

  const chunks = [];
  let sector = start;
  const rows = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (line.length > 120) {
        console.error(`${f}:${i + 1}: ${line.length} characters - a screen line is at most 120 (the load throws -22 past 128)`);
        process.exit(1);
      }
    });
    const bytes = Buffer.from(text, 'latin1');
    const count = Math.max(1, Math.ceil(bytes.length / SECTOR));
    const buf = Buffer.alloc(count * SECTOR, 10);          // LF padding
    bytes.copy(buf);
    chunks.push(buf);
    rows.push({ file: path.relative(ROOT, f), first: sector, count });
    sector += count;
  }

  fs.writeFileSync(out, Buffer.concat(chunks));

  const width = Math.max(...rows.map((r) => r.file.length));
  for (const r of rows) {
    console.log(`  ${r.file.padEnd(width)}  sector ${String(r.first).padStart(5)}  ${String(r.count).padStart(3)} sectors  ->  ${r.count > 1 ? `${r.first} ${r.count} include` : `${r.first} 1 include`}`);
  }
  console.log(`\n  ${out}  (${(sector - start) * SECTOR} bytes, sectors ${start}..${sector - 1})`);
  console.log(`  write it with the card unmounted:`);
  console.log(`    sudo dd if=${path.relative(process.cwd(), out)} of=/dev/rdiskN bs=512 seek=${start} conv=notrunc`);
}
