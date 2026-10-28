#!/usr/bin/env node
// scripts/embed_forth.mjs - bake forth/demo.fth into asm/forth.asm.
//
// The D16MINI kernel carries a Forth boot script: read_line reads it before the
// keyboard, once per boot, so the demo source is the program that is running -
// no loader, no upload, nothing to keep in step at the console. The text lives
// between two markers in asm/forth.asm.
//
// The script is baked with the assembler's `.string`, which packs two characters
// per cell (high byte first) and ends the line with a 0 cell. One cell per
// character cost the data section 3,610 words for 3,610 characters; packing
// halves that, and the freed words are what the SD driver's Forth lives in.
// read_line unpacks a line into tib_kbd before interpreting it.
//
// Usage:
//   node scripts/embed_forth.mjs            # rewrite the block
//   node scripts/embed_forth.mjs --check    # exit 1 if it is out of date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'forth', 'demo.fth');
const TARGET = path.join(ROOT, 'asm', 'forth.asm');
const TARGETS = [TARGET, path.join(ROOT, 'asm', 'forth_nano.asm')];
const BEGIN = '; >>> generated from forth/demo.fth - do not edit here <<<';
const END = '; <<< end generated >>>';
export const MAX_LINE = 120;

// The assembler's string literal: backslash and quote are the two characters
// that must not reach it raw.
const escape = (line) => line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function block(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (line.length > MAX_LINE) {
      throw new Error(`forth/demo.fth:${i + 1}: line is ${line.length} characters, limit ${MAX_LINE}`);
    }
    // Blank lines and lines that are wholly a `\` comment are dropped: an image
    // cell is one character, so the prose in forth/demo.fth would cost four
    // times what the code does, and nobody reads the baked copy - the file is
    // the source. Inline comments stay, they are part of the line.
    if (line.trim() === '' || line.trim().startsWith('\\')) return;
    out.push(`    .string "${escape(line)}"`);
  });
  return out.join('\n');
}

export function embed(asm, source) {
  const from = asm.indexOf(BEGIN);
  const to = asm.indexOf(END);
  if (from < 0 || to < 0 || to < from) {
    throw new Error(`asm/forth.asm: the generated markers are missing or out of order`);
  }
  const head = asm.slice(0, from + BEGIN.length);
  const tail = asm.slice(to);
  return `${head}\n${block(source)}\n${tail}`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const source = fs.readFileSync(SOURCE, 'utf8');
  let stale = [];
  for (const target of TARGETS) {
    const asm = fs.readFileSync(target, 'utf8');
    const next = embed(asm, source);
    const name = path.relative(ROOT, target);
    if (next !== asm) {
      if (check) stale.push(name);
      else { fs.writeFileSync(target, next); console.log(`embedded forth/demo.fth into ${name}`); }
    }
  }
  if (check) {
    if (stale.length) {
      console.error(`${stale.join(', ')} out of date with forth/demo.fth - run node scripts/embed_forth.mjs`);
      process.exit(1);
    }
    console.log('boot script is current');
  } else if (!stale.length) {
    console.log('boot script is current');
  }
}

export { SOURCE, TARGET, TARGETS, BEGIN, END, escape, ROOT, pathToFileURL };
