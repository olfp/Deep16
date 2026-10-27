// scripts/lib_png.mjs - tiny PNG decoder for the art build (RGBA/RGB, 8-bit).
// Node's zlib does the inflate; the rest is the PNG filter chain.
import fs from 'node:fs';
import zlib from 'node:zlib';

export function decodePng(file) {
  const d = fs.readFileSync(file);
  if (d.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG: ' + file);
  let p = 8, idat = [], plte = null, trns = null;
  let w = 0, h = 0, bd = 0, ct = 0, inter = 0;
  while (p < d.length) {
    const len = d.readUInt32BE(p), typ = d.toString('ascii', p + 4, p + 8);
    const data = d.subarray(p + 8, p + 8 + len);
    if (typ === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bd = data[8]; ct = data[9]; inter = data[12];
    } else if (typ === 'PLTE') plte = data;
    else if (typ === 'tRNS') trns = data;
    else if (typ === 'IDAT') idat.push(data);
    else if (typ === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || inter !== 0) throw new Error(`unsupported PNG ${file} bd=${bd} interlace=${inter}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (!ch) throw new Error('unsupported colour type ' + ct);
  const stride = w * ch;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride), pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const line = new Uint8Array(raw.subarray(pos, pos + stride)); pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ct === 6) { out[o] = line[x*4]; out[o+1] = line[x*4+1]; out[o+2] = line[x*4+2]; out[o+3] = line[x*4+3]; }
      else if (ct === 2) { out[o] = line[x*3]; out[o+1] = line[x*3+1]; out[o+2] = line[x*3+2]; out[o+3] = 255; }
      else if (ct === 3) { const i = line[x]; out[o]=plte[i*3]; out[o+1]=plte[i*3+1]; out[o+2]=plte[i*3+2]; out[o+3]=trns && i<trns.length ? trns[i] : 255; }
      else if (ct === 0) { out[o]=out[o+1]=out[o+2]=line[x]; out[o+3]=255; }
      else { out[o]=out[o+1]=out[o+2]=line[x*2]; out[o+3]=line[x*2+1]; }
    }
    prev = line;
  }
  return { width: w, height: h, rgba: out };
}

export function px(img, x, y) {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o], img.rgba[o+1], img.rgba[o+2], img.rgba[o+3]];
}
