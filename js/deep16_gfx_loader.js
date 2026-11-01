/* deep16_gfx_loader.js - load FiT graphics from the simulated config flash.
 *
 * The simulation has no graphics ROM. The tile bank, sprite bank and palettes
 * live in a flash blob and are written through the same CPU windows a real
 * loader uses. This is a reference implementation for tests, the IDE and the
 * headless renderer; the future CPU/Forth loader performs the same stores.
 *
 * Blob format (little-endian):
 *   "D16G" | version u16 | tileWords u16 | spriteWords u16 |
 *   paletteWords u16 | tileBank[] | spriteBank[] | palette[]
 */
class Deep16GfxLoader {
  static decodeBase64(b64) {
    if (typeof atob === 'function') {
      const s = atob(b64);
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
      return out;
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    throw new Error('no base64 decoder available');
  }

  static bytesOf(assets) {
    if (assets instanceof Uint8Array) return assets;
    if (typeof assets === 'string') return this.decodeBase64(assets);
    if (assets && typeof assets.bytes === 'string') return this.decodeBase64(assets.bytes);
    throw new Error('no flash asset bytes');
  }

  static parse(assets) {
    const bytes = this.bytesOf(assets);
    if (bytes.length < 12) throw new Error('flash asset blob is truncated');
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== 'D16G') throw new Error(`bad flash asset magic: ${magic}`);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = dv.getUint16(4, true);
    const tileWords = dv.getUint16(6, true);
    const spriteWords = dv.getUint16(8, true);
    const paletteWords = dv.getUint16(10, true);
    const need = 12 + 2 * (tileWords + spriteWords + paletteWords);
    if (bytes.length !== need) {
      throw new Error(`flash asset length ${bytes.length}, expected ${need}`);
    }
    const read = (at, count) => {
      const out = new Uint16Array(count);
      for (let i = 0; i < count; i++) out[i] = dv.getUint16(at + i * 2, true);
      return out;
    };
    let at = 12;
    const tiles = read(at, tileWords); at += tileWords * 2;
    const sprites = read(at, spriteWords); at += spriteWords * 2;
    const palette = read(at, paletteWords);
    return { version, tiles, sprites, palette };
  }

  // Copy the blob into the simulated config flash. This is storage; it does not
  // touch the tile engine.
  static installFlash(sim, assets) {
    const bytes = this.bytesOf(assets);
    const base = assets && Number.isInteger(assets.base) ? assets.base : 0x300000;
    const flash = sim && sim.spiFlash;
    if (!flash || !flash.mem) throw new Error('simulator has no config flash');
    if (base < 0 || base + bytes.length > flash.mem.length) {
      throw new Error(`flash asset blob does not fit at 0x${base.toString(16)}`);
    }
    flash.mem.set(bytes, base);
    return { base, length: bytes.length };
  }

  // Write the decoded graphics through the CPU windows. `engine` may be null
  // for tests that only care about the JS memory image.
  static writeGraphics(engine, sim, parsed) {
    const write = (addr, value) => {
      if (engine && typeof engine.write === 'function') engine.write(addr, value & 0xFFFF);
      if (sim && sim.memory && addr >= 0 && addr < sim.memory.length) {
        sim.memory[addr] = value & 0xFFFF;
      }
    };

    // All 128 tile slots: the simulation target, ahead of the current RTL's
    // 96-slot window (ERRPLAN, upper tile bank).
    for (let i = 0; i < parsed.tiles.length; i++) write(0xF3000 + i, parsed.tiles[i]);

    // The sprite bank keeps the hardware's 8-group write page.
    const groups = parsed.sprites.length / 256;
    const pages = Math.ceil(groups / 8);
    for (let page = 0; page < pages; page++) {
      write(0xF200A, page);
      for (let i = 0; i < 2048; i++) {
        const w = parsed.sprites[page * 2048 + i];
        if (w !== undefined) write(0xF4000 + i, w);
      }
    }
    write(0xF200A, 0);

    // Text, art and sprite palette banks, contiguous at 0xF5080..0xF50AF.
    for (let i = 0; i < parsed.palette.length; i++) write(0xF5080 + i, parsed.palette[i]);

    return {
      tiles: parsed.tiles.length,
      sprites: parsed.sprites.length,
      palettes: parsed.palette.length,
      pages,
    };
  }

  // Full path: flash image + CPU-window load. Returns the parsed blob so a
  // caller can inspect it.
  static load(engine, sim, assets) {
    this.installFlash(sim, assets);
    const parsed = this.parse(assets);
    const counts = this.writeGraphics(engine, sim, parsed);
    return { parsed, counts };
  }
}
