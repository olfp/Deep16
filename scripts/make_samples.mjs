// scripts/make_samples.mjs - demo μ-law samples for the config-flash slices.
//
// G.711 μ-law at 11.10 kHz. Two 8-bit samples pack into each 16-bit cell,
// little sample first, which is what the player's byte unpacker expects.
//
// `ping` is generated, `swoosh` is the user-provided Flappy effect decoded
// from assets/audio/flappy/sfx_swooshing.wav (44.1 kHz, 16-bit stereo) and
// resampled to the D16 rate. A sample may span several linked type-0x0A
// slices; the player copies the whole chain into the 0xE000 sound window.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const RATE_ULAW_11100 = 2;   // ADVARCH rate code: 11.10 kHz

const BIAS = 0x84;
const CLIP = 32635;

export function ulawEncode(value) {
  let sample = value | 0;
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {
    // find the segment
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  return (~(sign | (exponent << 4) | mantissa)) & 0xFF;
}

export function ulawDecode(code) {
  let u = (~code) & 0xFF;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 7;
  const mantissa = u & 0x0F;
  let sample = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -sample : sample;
}

export function pingBytes({ seconds = 0.22, hertz = 880, rate = 11100 } = {}) {
  const n = Math.round(seconds * rate);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const attack = Math.min(1, i / 18);
    const env = attack * Math.exp(-t * 14);
    const value = Math.round(Math.sin(2 * Math.PI * hertz * t) * 26000 * env);
    out[i] = ulawEncode(value);
  }
  return out;
}

// Minimal RIFF/WAVE reader: integer PCM only, which is what the Flappy pack
// uses (16-bit stereo at 44.1 kHz). Returns mono frames in [-1, 1].
export function readWavMono(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${file}: not a RIFF/WAVE file`);
  }
  let fmt = null;
  let data = null;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const off = p + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(off),
        channels: buf.readUInt16LE(off + 2),
        rate: buf.readUInt32LE(off + 4),
        bits: buf.readUInt16LE(off + 14),
      };
    } else if (id === 'data') {
      data = { off, size };
    }
    p = off + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: missing fmt/data chunk`);
  if (fmt.format !== 1) throw new Error(`${file}: only integer PCM is supported`);
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.size / (bytes * fmt.channels));
  const mono = new Float64Array(frames);
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const at = data.off + (i * fmt.channels + c) * bytes;
      let v;
      if (bytes === 1) v = (buf.readUInt8(at) - 128) / 128;
      else if (bytes === 2) v = buf.readInt16LE(at) / 32768;
      else if (bytes === 3) {
        let x = buf.readUIntLE(at, 3);
        if (x & 0x800000) x |= 0xff000000;
        v = x / 8388608;
      } else if (bytes === 4) v = buf.readInt32LE(at) / 2147483648;
      else throw new Error(`${file}: unsupported ${fmt.bits}-bit samples`);
      sum += v;
    }
    const v = sum / fmt.channels;
    mono[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  return { rate: fmt.rate, samples: mono, peak };
}

// Linear-interpolation resampler; the source is short and the rate change is
// constant, so this is enough and has no dependency.
export function resample(samples, srcRate, dstRate) {
  const n = Math.max(1, Math.round(samples.length * dstRate / srcRate));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * srcRate / dstRate;
    const at = Math.min(samples.length - 1, Math.floor(pos));
    const next = Math.min(samples.length - 1, at + 1);
    const frac = pos - at;
    out[i] = samples[at] * (1 - frac) + samples[next] * frac;
  }
  return out;
}

export function wavToUlaw(file, { rate = 11100, peak = 30000 } = {}) {
  const wav = readWavMono(file);
  const mono = resample(wav.samples, wav.rate, rate);
  let max = 0;
  for (const v of mono) max = Math.max(max, Math.abs(v));
  const gain = max > 0 ? peak / (max * 32768) : 1;
  const out = new Uint8Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    out[i] = ulawEncode(Math.round(mono[i] * 32768 * gain));
  }
  return out;
}

export function buildSamples() {
  const swoosh = wavToUlaw(path.join(ROOT, 'assets/audio/flappy/sfx_swooshing.wav'));
  return {
    ping: { name: 'ping', rate: RATE_ULAW_11100, bytes: pingBytes() },
    swoosh: { name: 'swoosh', rate: RATE_ULAW_11100, bytes: swoosh },
  };
}
