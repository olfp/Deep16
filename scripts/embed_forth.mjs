#!/usr/bin/env node
// scripts/embed_forth.mjs - bake a Forth boot script into a kernel image.
//
// The D16MINI kernel (asm/forth.asm) and the D16NANO kernel (asm/forth_nano.asm)
// both read a boot script before the keyboard, once per boot, so the boot
// loader is the program that is running - no upload, nothing to keep in step
// at the console. The mini keeps forth/boot.fth and its cf-burst reader; the
// nano has its own forth/boot-nano.fth, whose slice reads go through BDOS.
//
// The script is baked with the assembler's `.string`, which packs two characters
// per cell (high byte first) and ends the line with a 0 cell. One cell per
// character cost the data section 3,610 words for 3,610 characters; packing
// halves that, and the freed words are what the SD driver's Forth lives in.
// read_line unpacks a line into tib_kbd before interpreting it.
//
// Usage:
//   node scripts/embed_forth.mjs            # rewrite the blocks
//   node scripts/embed_forth.mjs --check    # exit 1 if one is out of date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'forth', 'boot.fth');
const TARGET = path.join(ROOT, 'asm', 'forth.asm');
const NANO_SOURCE = path.join(ROOT, 'forth', 'boot-nano.fth');
const NANO_TARGET = path.join(ROOT, 'asm', 'forth_nano.asm');
const JOBS = [
  { source: SOURCE, target: TARGET },
  { source: NANO_SOURCE, target: NANO_TARGET },
];
const TARGETS = JOBS.map((job) => job.target);
const END = '; <<< end generated >>>';
export const MAX_LINE = 120;

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const markers = (source) => {
  const begin = `; >>> generated from ${rel(source)} - do not edit here <<<`;
  return { begin, end: END };
};

// The assembler's string literal: backslash and quote are the two characters
// that must not reach it raw.
const escape = (line) => line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function block(source, name = rel(SOURCE)) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (line.length > MAX_LINE) {
      throw new Error(`${name}:${i + 1}: line is ${line.length} characters, limit ${MAX_LINE}`);
    }
    // Blank lines and lines that are wholly a `\` comment are dropped: an image
    // cell is one character, so prose would cost four times what the code does,
    // and nobody reads the baked copy - the file is the source. Inline comments
    // stay, they are part of the line.
    if (line.trim() === '' || line.trim().startsWith('\\')) return;
    out.push(`    .string "${escape(line)}"`);
  });
  return out.join('\n');
}

export function embed(asm, source, sourcePath = SOURCE) {
  const { begin } = markers(sourcePath);
  const from = asm.indexOf(begin);
  const to = asm.indexOf(END);
  if (from < 0 || to < 0 || to < from) {
    throw new Error(`${rel(sourcePath)}: the generated markers are missing or out of order`);
  }
  const head = asm.slice(0, from + begin.length);
  const tail = asm.slice(to);
  return `${head}\n${block(source, rel(sourcePath))}\n${tail}`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const { source, target } of JOBS) {
    const asm = fs.readFileSync(target, 'utf8');
    const next = embed(asm, fs.readFileSync(source, 'utf8'), source);
    const name = rel(target);
    if (next !== asm) {
      if (check) stale.push(`${name} (${rel(source)})`);
      else { fs.writeFileSync(target, next); console.log(`embedded ${rel(source)} into ${name}`); }
    }
  }
  if (check) {
    if (stale.length) {
      console.error(`${stale.join(', ')} out of date - run node scripts/embed_forth.mjs`);
      process.exit(1);
    }
    console.log('boot scripts are current');
  } else if (!stale.length) {
    console.log('boot scripts are current');
  }
}

export { SOURCE, TARGET, NANO_SOURCE, NANO_TARGET, TARGETS, JOBS, END, markers, escape, ROOT, pathToFileURL };
