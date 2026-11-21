/* deep16_audio.js - browser audio sink for the simulated I2S FIFO.
 *
 * The simulator drains signed 16-bit mono samples at the board's 21.09375 kHz
 * I2S rate. This class turns those samples into scheduled AudioBufferSource
 * nodes. The browser resamples the 21.09375 kHz buffers to the device rate, so
 * pitch stays correct without a hand-written resampler.
 */
class Deep16Audio {
    constructor() {
        this.ctx = null;
        this.ready = false;
        this.chunks = [];
        this.chunkOffset = 0;
        this.queued = 0;
        this.nextTime = 0;
        this.muted = false;
        this.sources = [];
    }

    start() {
        if (typeof window === 'undefined') return false;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        try {
            if (!this.ctx) this.ctx = new Ctx({ latencyHint: 'interactive' });
            if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
                this.ctx.resume().catch(() => {});
            }
            this.ready = true;
            if (!this.nextTime || this.nextTime < this.ctx.currentTime) {
                this.nextTime = this.ctx.currentTime + 0.08;
            }
            return true;
        } catch {
            this.ready = false;
            return false;
        }
    }

    stop() {
        this.ready = false;
        this.chunks = [];
        this.chunkOffset = 0;
        this.queued = 0;
        this.nextTime = 0;
        for (const src of this.sources) {
            try { src.stop(); } catch {}
            try { src.disconnect(); } catch {}
        }
        this.sources = [];
        if (this.ctx && typeof this.ctx.suspend === 'function') {
            try { this.ctx.suspend().catch(() => {}); } catch {}
        }
    }

    setMuted(muted) {
        this.muted = !!muted;
        if (this.muted) this.chunks = [];
        this.chunkOffset = 0;
        this.queued = 0;
    }

    push(samples) {
        if (!this.ready || !this.ctx || this.muted || !samples || !samples.length) return;
        const f = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            f[i] = Math.max(-1, Math.min(1, samples[i] / 32768));
        }
        this.chunks.push(f);
        this.queued += f.length;
        this.flush(false);
    }

    take(n) {
        const out = new Float32Array(n);
        let at = 0;
        while (at < n && this.chunks.length) {
            const head = this.chunks[0];
            const left = head.length - this.chunkOffset;
            const take = Math.min(left, n - at);
            out.set(head.subarray(this.chunkOffset, this.chunkOffset + take), at);
            at += take;
            this.chunkOffset += take;
            if (this.chunkOffset >= head.length) {
                this.chunks.shift();
                this.chunkOffset = 0;
            }
        }
        this.queued -= at;
        return at === n ? out : out.subarray(0, at);
    }

    flush(force) {
        if (!this.ctx) return;
        // ~24 ms chunks keep the node count low while still tracking the
        // simulator's 10 ms pump. Start with 80 ms of lookahead.
        const chunk = 512;
        while (this.queued >= chunk || (force && this.queued > 0)) {
            const n = Math.min(chunk, this.queued);
            const data = this.take(n);
            if (!data.length) break;
            const buffer = this.ctx.createBuffer(1, data.length, 21093.75);
            buffer.copyToChannel(data, 0);
            const src = this.ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(this.ctx.destination);
            const now = this.ctx.currentTime;
            if (this.nextTime < now + 0.02) this.nextTime = now + 0.02;
            src.start(this.nextTime);
            this.sources.push(src);
            src.onended = () => {
                const i = this.sources.indexOf(src);
                if (i >= 0) this.sources.splice(i, 1);
            };
            this.nextTime += data.length / 21093.75;
        }
    }
}
