#!/usr/bin/env node
// scripts/make_ps2map.mjs - PS/2 Set-2 keyboard layouts for the software decoder.
//
// The receiver (rtl/ps2_rx.sv) no longer carries a character table. It emits a
// 16-bit raw make event and the BIOS decoder (asm/forth_nano.asm) maps it
// through one of the layouts below:
//
//     plain[code] = base | shifted << 8        (128 words)
//     alt[code]   = altgr | altgr_shift << 8   (128 words)
//
// A layout entry is therefore 256 words (512 bytes). The image carries the
// entries at PS2_LAYOUT_BASE = 0x6A90, in the free BIOS-image tail; see
// PS2LAYOUT.md. The default is German QWERTZ (index 0).
//
// The Set-2 make code is a physical key position, so a layout is a per-code
// pair table, not a list of letters. DE and US prove the two extremes; FR/UK/ES
// are data-only additions while the 0x6A90..0x6F7F space lasts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const LAYOUT_WORDS = 256;
export const PS2_LAYOUT_BASE = 0x6a90;
export const LAYOUT_FILE = 'ps2layouts.hex';

// Set-2 scan code -> [unshifted, shifted]. Only keys that produce a character
// are listed; modifiers and prefixes stay zero.
export const KEYS = {
  // German letters: y and z are at each other's US positions.
  0x1c: ['a', 'A'], 0x32: ['b', 'B'], 0x21: ['c', 'C'], 0x23: ['d', 'D'],
  0x24: ['e', 'E'], 0x2b: ['f', 'F'], 0x34: ['g', 'G'], 0x33: ['h', 'H'],
  0x43: ['i', 'I'], 0x3b: ['j', 'J'], 0x42: ['k', 'K'], 0x4b: ['l', 'L'],
  0x3a: ['m', 'M'], 0x31: ['n', 'N'], 0x44: ['o', 'O'], 0x4d: ['p', 'P'],
  0x15: ['q', 'Q'], 0x2d: ['r', 'R'], 0x1b: ['s', 'S'], 0x2c: ['t', 'T'],
  0x3c: ['u', 'U'], 0x2f: ['v', 'V'], 0x2a: ['v', 'V'], 0x1d: ['w', 'W'], 0x22: ['x', 'X'],
  0x35: ['z', 'Z'], 0x1a: ['y', 'Y'],

  0x45: ['0', '='], 0x16: ['1', '!'], 0x1e: ['2', '"'], 0x26: ['3', '§'],
  0x25: ['4', '$'], 0x2e: ['5', '%'], 0x36: ['6', '&'], 0x3d: ['7', '/'],
  0x3e: ['8', '('], 0x46: ['9', ')'],

  // German punctuation. The dead keys emit their spacing character.
  0x0e: ['^', '°'], 0x4e: ['ß', '?'], 0x55: ['´', '`'],
  0x54: ['ü', 'Ü'], 0x5b: ['+', '*'], 0x5d: ['#', "'"],
  0x4c: ['ö', 'Ö'], 0x52: ['ä', 'Ä'], 0x41: [',', ';'],
  0x49: ['.', ':'], 0x4a: ['-', '_'], 0x29: [' ', ' '],

  0x5a: ['\r', '\r'], 0x66: ['\b', '\b'], 0x0d: ['\t', '\t'],
  0x76: ['\x1b', '\x1b'],

  // Numeric keypad (Num Lock on). Extended navigation codes are handled by the
  // decoder's fixed table, not by the layout.
  0x70: ['0', '0'], 0x69: ['1', '1'], 0x72: ['2', '2'], 0x7a: ['3', '3'],
  0x6b: ['4', '4'], 0x73: ['5', '5'], 0x74: ['6', '6'], 0x6c: ['7', '7'],
  0x75: ['8', '8'], 0x7d: ['9', '9'], 0x71: ['.', '.'], 0x7c: ['*', '*'],
  0x7b: ['-', '-'], 0x79: ['+', '+'],
};

// US QWERTY is the same physical matrix with different caps. The scan codes are
// positions: 0x1a is the US Y / DE Z key, 0x35 is the US Z / DE Y key.
export const US_KEYS = {
  0x1c: ['a', 'A'], 0x32: ['b', 'B'], 0x21: ['c', 'C'], 0x23: ['d', 'D'],
  0x24: ['e', 'E'], 0x2b: ['f', 'F'], 0x34: ['g', 'G'], 0x33: ['h', 'H'],
  0x43: ['i', 'I'], 0x3b: ['j', 'J'], 0x42: ['k', 'K'], 0x4b: ['l', 'L'],
  0x3a: ['m', 'M'], 0x31: ['n', 'N'], 0x44: ['o', 'O'], 0x4d: ['p', 'P'],
  0x15: ['q', 'Q'], 0x2d: ['r', 'R'], 0x1b: ['s', 'S'], 0x2c: ['t', 'T'],
  0x3c: ['u', 'U'], 0x2f: ['v', 'V'], 0x1d: ['w', 'W'], 0x22: ['x', 'X'],
  0x1a: ['z', 'Z'], 0x35: ['y', 'Y'],

  0x45: ['0', ')'], 0x16: ['1', '!'], 0x1e: ['2', '@'], 0x26: ['3', '#'],
  0x25: ['4', '$'], 0x2e: ['5', '%'], 0x36: ['6', '^'], 0x3d: ['7', '&'],
  0x3e: ['8', '*'], 0x46: ['9', '('],

  0x0e: ['`', '~'], 0x4e: ['-', '_'], 0x55: ['=', '+'],
  0x54: ['[', '{'], 0x5b: [']', '}'], 0x5d: ['\\', '|'],
  0x4c: [';', ':'], 0x52: ["'", '"'], 0x41: [',', '<'],
  0x49: ['.', '>'], 0x4a: ['/', '?'], 0x29: [' ', ' '],

  0x5a: ['\r', '\r'], 0x66: ['\b', '\b'], 0x0d: ['\t', '\t'],
  0x76: ['\x1b', '\x1b'],

  0x70: ['0', '0'], 0x69: ['1', '1'], 0x72: ['2', '2'], 0x7a: ['3', '3'],
  0x6b: ['4', '4'], 0x73: ['5', '5'], 0x74: ['6', '6'], 0x6c: ['7', '7'],
  0x75: ['8', '8'], 0x7d: ['9', '9'], 0x71: ['.', '.'], 0x7c: ['*', '*'],
  0x7b: ['-', '-'], 0x79: ['+', '+'],
};

// AltGr characters, keyed by the original scan code. The decoder sees the Alt
// bit and looks these up in the layout's alt[] half; no synthetic code remap.
export const ALTGR = {
  0x15: '@', 0x3d: '{', 0x3e: '[', 0x46: ']', 0x45: '}',
  0x4e: '\\', 0x41: '|', 0x5b: '~',
  0x1e: '²', 0x26: '³', 0x3a: 'µ', 0x24: '€',
};

// E0-prefixed navigation keys. These are layout-independent control bytes and
// stay in the decoder's fixed table.
export const EXT = {
  0x6b: 0x02,  // Left  -> C-B
  0x74: 0x06,  // Right -> C-F
  0x75: 0x10,  // Up    -> C-P
  0x72: 0x0e,  // Down  -> C-N
  0x6c: 0x01,  // Home  -> C-A
  0x69: 0x05,  // End   -> C-E
};

export const LAYOUTS = [
  { name: 'de', keys: KEYS, altgr: ALTGR },
  { name: 'us', keys: US_KEYS, altgr: {} },
];

export const LAYOUT_COUNT = LAYOUTS.length;

const codeOf = (s) => (s ? s.charCodeAt(0) & 0xff : 0);

const isLetter = (c) =>
  (c >= 0x61 && c <= 0x7a) || (c >= 0xe0 && c <= 0xfe && c !== 0xf7);

// The 128 plain/alt pairs for one layout. Scan codes 0x80.. are not reachable
// here: the decoder rejects them before indexing this table.
export function layoutEntry(index) {
  const layout = LAYOUTS[index];
  if (!layout) throw new Error(`no PS/2 layout ${index}`);
  const out = new Uint16Array(LAYOUT_WORDS);
  for (let code = 0; code < 128; code++) {
    const pair = layout.keys[code];
    if (pair) out[code] = codeOf(pair[0]) | (codeOf(pair[1]) << 8);
    const alt = layout.altgr[code];
    if (alt) out[128 + code] = codeOf(alt) | (codeOf(alt) << 8);
  }
  return out;
}

export function layoutWords() {
  const out = new Uint16Array(LAYOUTS.length * LAYOUT_WORDS);
  LAYOUTS.forEach((_, i) => out.set(layoutEntry(i), i * LAYOUT_WORDS));
  return out;
}

// Reference implementation of the decoder. The assembly routine in
// asm/forth_nano.asm must agree with this; the raw-event tests compare them.
export function decodeEvent(event, layout = 0) {
  event &= 0xffff;
  if ((event & 0x8000) === 0) return event & 0xff;

  const code = event & 0xff;
  if (code >= 0x80) return 0;
  if (event & 0x4000) return EXT[code] ?? 0;

  const caps = (event & 0x2000) !== 0;
  const alt = (event & 0x1000) !== 0;
  const ctrl = (event & 0x0800) !== 0;
  const shift = (event & 0x0400) !== 0;

  const entry = layoutEntry(((layout % LAYOUT_COUNT) + LAYOUT_COUNT) % LAYOUT_COUNT);
  const plain = entry[code];
  const base = plain & 0xff;
  const upper = (plain >> 8) & 0xff;
  const altWord = entry[128 + code];

  if (alt && altWord) return shift ? ((altWord >> 8) & 0xff) : (altWord & 0xff);
  if (isLetter(base)) {
    if (ctrl) return (base >= 0x61 && base <= 0x7a) ? (base & 0x1f) : 0;
    return (shift !== caps) ? upper : base;
  }
  return shift ? upper : base;
}

export function makeEvent(code, { caps = false, alt = false, ctrl = false,
                                  shift = false, extended = false } = {}) {
  return 0x8000 | (extended ? 0x4000 : 0) | (caps ? 0x2000 : 0) |
         (alt ? 0x1000 : 0) | (ctrl ? 0x0800 : 0) | (shift ? 0x0400 : 0) |
         (code & 0xff);
}

export function writePs2Layouts(outDir) {
  const words = layoutWords();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, LAYOUT_FILE),
                   Array.from(words).map((b) => b.toString(16).padStart(4, '0')).join('\n') + '\n');
  return words.length;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = path.resolve(process.argv[2] ?? path.join(ROOT, 'artifacts', 'image'));
  const n = writePs2Layouts(out);
  console.log(`wrote ${path.relative(ROOT, out)}/${LAYOUT_FILE} (${n} words, ` +
              `${LAYOUT_COUNT} layouts, ${LAYOUTS.map((l) => l.name).join('/')})`);
}
