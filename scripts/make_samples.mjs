// scripts/make_samples.mjs - demo μ-law samples for the config-flash slices.
//
// G.711 μ-law at 11.10 kHz. Two 8-bit samples pack into each 16-bit cell,
// little sample first, which is what the player's byte unpacker expects.
//
// The first sample is a short decaying 880 Hz ping. Replace/extend this file
// with WAV decoding when the real effect library exists.

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

export function buildSamples() {
  return {
    ping: { name: 'ping', rate: RATE_ULAW_11100, bytes: pingBytes() },
  };
}
