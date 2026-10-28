#!/usr/bin/env node
// scripts/make_screens.mjs - turn Forth source files into SD-card screens.
//
// The card has no file system: a source file is a run of 512-byte sectors, lines
// separated by LF, the tail padded with LF (see `include` in forth/demo.fth).
// This writes one blob with every file starting on a sector boundary and prints
// the sector range and the dd command that puts it on the card at a chosen
// sector.
//
//   node scripts/make_screens.mjs screens/starfield.fth
//   node scripts/make_screens.mjs a.fth b.fth --start=100 --out=/tmp/sd.bin
//
// Then, with the card unmounted (the whole device, not a partition):
//   sudo dd if=artifacts/sd/screens.bin of=/dev/rdiskN bs=512 seek=<start> conv=notrunc
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECTOR = 512;
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const a = args.find((v) => v.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: make_screens.mjs <file.fth> [...] [--start=N] [--out=FILE]');
  process.exit(1);
}
const start = Number(opt('start', '1'));
const out = path.resolve(ROOT, opt('out', 'artifacts/sd/screens.bin'));
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

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat(chunks));

const width = Math.max(...rows.map((r) => r.file.length));
for (const r of rows) {
  console.log(`  ${r.file.padEnd(width)}  sector ${String(r.first).padStart(5)}  ${String(r.count).padStart(3)} sectors  ->  ${r.count > 1 ? `${r.first} ${r.count} include` : `${r.first} 1 include`}`);
}
console.log(`\n  ${out}  (${(sector - start) * SECTOR} bytes, sectors ${start}..${sector - 1})`);
console.log(`  write it with the card unmounted:`);
console.log(`    sudo dd if=${path.relative(process.cwd(), out)} of=/dev/rdiskN bs=512 seek=${start} conv=notrunc`);
