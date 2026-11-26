#!/usr/bin/env node
// scripts/make_music.mjs - ABC notation -> G.711 mu-law PCM for the I2S player.
//
// The I2S path plays mono mu-law at the 11.10 kHz rate code (the audio IRQ
// pushes every sample twice, so the wire runs at ~10.55 kHz). This tool is the
// offline "synthesizer": it parses a small ABC subset, renders a square-wave
// melody with an ADSR envelope, adds the root of each "C" chord symbol as a
// triangle bass, and packs the bytes like scripts/make_samples.mjs.
//
// ABC subset (deliberately small; anything else is an error):
//   headers  X: T: M: L: Q: K:   (K: C Am G D F Em Dm)
//   notes    A-G a-g, ^/_/= accidentals, ' and , octave shifts
//   rests    z x
//   duration 2 4 /2 /4 / 3/2 ...  (fraction of L:, default 1/8)
//   bars     |, [|, |] reset the bar accidentals
//   ties     - extends the previous note
//   chords   "C" "Am" ... become the bass root at that point
//   other    % comments, !decorations! and [inline fields] are skipped
//
// Usage:
//   node scripts/make_music.mjs --wav out.wav [--abc file.abc]
//   node scripts/make_music.mjs --bytes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulawEncode } from '../../scripts/make_samples.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MUSIC_RATE = 11100;          // rate code 2 (see ADVARCH.md)
export const RATE_ULAW_11100 = 2;

// A four-bar loop in C, 132 BPM: short enough for the 0xE000 sound window
// (about 11.8 s of mu-law) and original, so it can ship in the slice set.
export const FLAPPY_LOOP_ABC = `X:1
T:Flappy Loop
M:4/4
L:1/8
Q:1/4=132
K:C
"C" G2 c2 e2 c2 | "F" A2 c2 f2 c2 | "G" B2 d2 g2 d2 | "C" c2 e2 g4 |
`;

const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC = { '^': 1, '_': -1, '=': 0 };
// Sharps/flats in each key signature, by note letter.
const KEY_SIG = {
  C: {}, Am: {}, G: { F: 1 }, D: { F: 1, C: 1 }, F: { B: -1 },
  Em: { F: 1 }, Dm: { B: -1 },
};
const CHORD_ROOT = { C: 36, D: 38, E: 40, F: 41, G: 43, A: 45, B: 47 };

function parseDuration(text, unit) {
  // A duration is a fraction of the unit length: 2, 3/2, /2, /.
  if (text === '') return unit;
  const m = /^(\d*)(?:\/(\d*))?$/.exec(text);
  if (!m) throw new Error(`bad duration ${JSON.stringify(text)}`);
  const num = m[1] === '' ? 1 : Number(m[1]);
  const den = m[2] === undefined ? 1 : (m[2] === '' ? 2 : Number(m[2]));
  if (!num || !den) throw new Error(`bad duration ${JSON.stringify(text)}`);
  return (unit * num) / den;
}

export function parseABC(text) {
  const lines = text.split(/\r?\n/);
  const headers = { M: '4/4', L: '1/8', Q: '1/4=120', K: 'C' };
  const body = [];
  let seenK = false;

  for (const raw of lines) {
    const line = raw.replace(/%.*$/, '').trim();
    if (!line) continue;
    if (!seenK) {
      const h = /^([A-Za-z]):(.*)$/.exec(line);
      if (h && 'XTLMQK'.includes(h[1])) {
        headers[h[1]] = h[2].trim();
        if (h[1] === 'K') seenK = true;
        continue;
      }
      throw new Error(`expected an ABC header, got ${JSON.stringify(raw)}`);
    }
    body.push(line);
  }
  if (!seenK) throw new Error('no K: header');

  const unit = parseDuration(headers.L.replace(/^1\//, '/'), 1);
  const q = /^(\d+)\/(\d+)\s*=\s*(\d+)$/.exec(headers.Q);
  const bpm = q ? Number(q[3]) : Number(headers.Q);
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error(`bad Q: ${headers.Q}`);
  const key = headers.K.split(/\s+/)[0];
  if (!(key in KEY_SIG)) {
    throw new Error(`unsupported key ${key} (only ${Object.keys(KEY_SIG).join(', ')})`);
  }

  const notes = [];
  const chords = [];
  let time = 0;                 // in whole notes
  let prev = null;
  const accidentals = new Map();
  const src = body.join(' ');
  let i = 0;

  const durationText = () => {
    let t = '';
    while (/\d/.test(src[i] || '')) t += src[i++];
    if (src[i] === '/') {
      t += '/';
      i++;
      while (/\d/.test(src[i] || '')) t += src[i++];
    }
    return t;
  };

  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '|' || (ch === '[' && src[i + 1] === '|') || (ch === ']' && src[i + 1] === '|')) {
      accidentals.clear();
      i += (ch === '[' || ch === ']') ? 2 : 1;
      continue;
    }
    if (ch === ']' || ch === '[') { i++; continue; }
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new Error('unterminated chord symbol');
      const name = src.slice(i + 1, end).trim();
      if (!/^[A-G][#b]?m?$/.test(name)) throw new Error(`unsupported chord ${name}`);
      chords.push({ at: time, name });
      i = end + 1;
      continue;
    }
    if (ch === '!') {
      const end = src.indexOf('!', i + 1);
      if (end < 0) throw new Error('unterminated decoration');
      i = end + 1;
      continue;
    }
    if (ch === '[') {
      const end = src.indexOf(']', i + 1);
      if (end < 0) throw new Error('unterminated [field]');
      i = end + 1;
      continue;
    }
    if (ch === '(') throw new Error('tuplets are not supported');
    if (ch === '{') throw new Error('grace notes are not supported');

    let explicit = null;
    let letter = ch;
    if (ch === '^' || ch === '_' || ch === '=') {
      explicit = ACC[ch];
      i++;
      letter = src[i];
    }

    if (letter === 'z' || letter === 'x') {
      i++;
      time += parseDuration(durationText(), unit);
      prev = null;
      continue;
    }
    if (!/[A-Ga-g]/.test(letter || '')) throw new Error(`unsupported token ${JSON.stringify(letter)}`);
    i++;

    const lower = letter === letter.toLowerCase();
    const upper = letter.toUpperCase();
    let octave = lower ? 5 : 4;               // ABC: C = C4, c = C5
    while (src[i] === "'") { octave++; i++; }
    while (src[i] === ',') { octave--; i++; }
    const dur = parseDuration(durationText(), unit);

    const accKey = `${upper}${octave}`;
    let alter = explicit !== null ? explicit : (accidentals.get(accKey) ?? KEY_SIG[key][upper] ?? 0);
    if (explicit !== null) accidentals.set(accKey, explicit);
    const midi = 12 * (octave + 1) + NOTE_BASE[upper] + alter;

    if (prev && src[i] === '-') {
      prev.dur += dur;                        // tie
      i++;
    } else {
      const note = { at: time, dur, midi };
      notes.push(note);
      prev = note;
    }
    time += dur;
  }

  const length = notes.reduce((m, n) => Math.max(m, n.at + n.dur), time);
  return { title: headers.T || 'untitled', meter: headers.M, unit, bpm, key, notes, chords, length };
}

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

export function renderMusic(abc, { rate = MUSIC_RATE } = {}) {
  const parsed = parseABC(abc);
  const secondsPerWhole = (60 / parsed.bpm) * 4;
  const at = (wholes) => wholes * secondsPerWhole;
  const total = Math.max(1, Math.ceil(at(parsed.length) * rate));
  const mix = new Float32Array(total);

  const attack = 0.008 * rate;
  const decay = 0.06 * rate;
  const sustain = 0.7;
  const release = 0.05 * rate;

  for (const n of parsed.notes) {
    const s0 = Math.round(at(n.at) * rate);
    const len = Math.round(at(n.dur) * rate);
    const gate = Math.max(1, Math.round(len * 0.9));
    const step = midiHz(n.midi) / rate;
    let phase = 0;
    for (let k = 0; k < len && s0 + k < total; k++) {
      let env;
      if (k < attack) env = k / attack;
      else if (k < attack + decay) env = 1 - (1 - sustain) * ((k - attack) / decay);
      else if (k < gate) env = sustain;
      else env = sustain * Math.max(0, 1 - (k - gate) / Math.max(1, release));
      // 25 % square: a light chiptune edge without the full square's buzz.
      mix[s0 + k] += (phase < 0.25 ? 1 : -1) * 0.5 * env;
      phase += step;
      if (phase >= 1) phase -= 1;
    }
  }

  // Triangle bass on each chord root, held until the next chord or the end.
  for (let c = 0; c < parsed.chords.length; c++) {
    const chord = parsed.chords[c];
    const next = parsed.chords[c + 1];
    const startWhole = chord.at;
    const endWhole = next ? next.at : parsed.length;
    if (endWhole <= startWhole) continue;
    const s0 = Math.round(at(startWhole) * rate);
    const len = Math.round(at(endWhole - startWhole) * rate);
    const step = midiHz(CHORD_ROOT[chord.name[0]]) / rate;
    let phase = 0;
    for (let k = 0; k < len && s0 + k < total; k++) {
      const tri = 4 * Math.abs(phase - 0.5) - 1;
      const env = Math.min(1, k / (0.01 * rate)) * Math.min(1, (len - k) / (0.05 * rate));
      mix[s0 + k] += tri * 0.18 * env;
      phase += step;
      if (phase >= 1) phase -= 1;
    }
  }

  // Soft clip, then G.711 mu-law.
  const bytes = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const x = Math.tanh(mix[i] * 1.2) * 0.9;
    bytes[i] = ulawEncode(Math.round(x * 32767));
  }
  return { bytes, seconds: total / rate, parsed };
}

export function flappyMusicBytes() {
  return renderMusic(FLAPPY_LOOP_ABC).bytes;
}

// Minimal 16-bit mono WAV so the tune can be auditioned on the host.
export function writeWav(file, bytes, rate = MUSIC_RATE) {
  const n = bytes.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const u = (~bytes[i]) & 0xff;
    const sign = u & 0x80;
    const exp = (u >> 4) & 7;
    const man = u & 0x0f;
    let v = (((man << 3) + 0x84) << exp) - 0x84;
    if (sign) v = -v;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, v)), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const abcFile = opt('--abc');
  const abc = abcFile ? fs.readFileSync(abcFile, 'utf8') : FLAPPY_LOOP_ABC;
  const { bytes, seconds, parsed } = renderMusic(abc);
  const wav = opt('--wav');
  if (wav) {
    writeWav(wav, bytes);
    console.log(`wrote ${wav}: ${parsed.title}, ${seconds.toFixed(2)} s, ${bytes.length} bytes`);
  } else {
    console.log(`${parsed.title}: ${seconds.toFixed(2)} s, ${bytes.length} mu-law bytes`);
  }
}
