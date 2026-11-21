// Browser sink plumbing, without a real audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './helpers.js';

class FakeSource {
  constructor() { this.buffer = null; this.started = null; this.connected = null; }
  connect(node) { this.connected = node; }
  start(when) { this.started = when; }
}
class FakeContext {
  constructor() {
    this.currentTime = 1;
    this.state = 'running';
    this.destination = {};
    this.sources = [];
    this.buffers = [];
  }
  createBuffer(channels, length, rate) {
    const buffer = {
      channels, length, sampleRate: rate, data: new Float32Array(length),
      copyToChannel(data) { this.data.set(data); },
      duration: length / rate,
    };
    this.buffers.push(buffer);
    return buffer;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

test('the sink schedules 16-bit samples as 21.09375 kHz buffers', () => {
  globalThis.window = { AudioContext: FakeContext };
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'deep16_audio.js'), 'utf8'),
                      { filename: 'js/deep16_audio.js' });
  const Audio = vm.runInThisContext('Deep16Audio');
  const audio = new Audio();
  assert.equal(audio.start(), true);
  const ctx = audio.ctx;

  const samples = new Int16Array(1024);
  samples[0] = 16384;
  samples[1] = -16384;
  audio.push(samples);
  assert.ok(ctx.sources.length >= 1, 'a buffer source was scheduled');
  assert.equal(ctx.buffers[0].sampleRate, 21093.75);
  assert.equal(ctx.buffers[0].data[0], 0.5);
  assert.equal(ctx.buffers[0].data[1], -0.5);
  assert.ok(ctx.sources[0].started >= 1, 'scheduled in the future');

  audio.stop();
  assert.equal(audio.ready, false);
  assert.equal(audio.queued, 0);
});
