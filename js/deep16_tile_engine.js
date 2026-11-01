/* deep16_tile_engine.js - the FiT tile/sprite/palette renderer for the
 * simulation.
 *
 * This is a plain browser script: no DOM, no timers, no fetch. It models the
 * state and pixel rules of rtl/dvi/dvi_tile.sv. It does not contain graphics:
 * powerOn() leaves every bank and palette blank, and a loader writes the CPU
 * windows the same way the board will load them from flash.
 *
 * Deliberate forward model: all 128 tile slots are writable here, while the
 * current RTL exposes 96 (see ERRPLAN, upper tile bank). Sprite groups keep the
 * hardware's 8-group write page.
 */
class Deep16TileEngine {
  constructor() {
    this.WIDTH = 640;
    this.HEIGHT = 360;
    this.CELL_W = 8;
    this.CELL_H = 15;
    this.COLS = 80;
    this.ROWS = 24;
    this.MAP_COLS = 82;
    this.MAP_ROWS = 26;
    this.TILE_COUNT = 128;
    this.TILE_WORDS = 32;
    this.SPR_GROUPS = 24;
    this.SPR_PAGE_WORDS = 8 * 256;
    this.SPR_WORDS = this.SPR_GROUPS * 256;
    this.OAM_WORDS = 16;
    this.PALETTE_WORDS = 48;

    this.tilemap = [new Uint16Array(this.MAP_COLS * this.MAP_ROWS),
                    new Uint16Array(this.MAP_COLS * this.MAP_ROWS)];
    this.tileBank = new Uint16Array(this.TILE_COUNT * this.TILE_WORDS);
    this.spriteBank = new Uint16Array(this.SPR_WORDS);
    this.oam = new Uint16Array(this.OAM_WORDS);
    this.palette = new Uint8Array(this.PALETTE_WORDS);
    this.rowScroll = new Uint8Array(this.MAP_ROWS);
    this.rowScrollNext = new Uint8Array(this.MAP_ROWS);

    this.pixels = new Uint8ClampedArray(this.WIDTH * this.HEIGHT * 4);
    this.rgbTable = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = this.rgb332(i);
      this.rgbTable[i * 3] = r;
      this.rgbTable[i * 3 + 1] = g;
      this.rgbTable[i * 3 + 2] = b;
    }

    this.dirty = 0;
    this.powerOn();
  }

  // ---- state ------------------------------------------------------------

  powerOn() {
    for (const bank of this.tilemap) bank.fill(0);
    this.tileBank.fill(0);
    this.spriteBank.fill(0);
    this.palette.fill(0);
    this.oam.fill(0);
    this.rowScroll.fill(0);
    this.rowScrollNext.fill(0);
    this.resetControls();
    this.frame = 0;
    this.blink = 0;
    this.dirty++;
  }

  reset() {
    // RTL rst_render: OAM and controls reset; banks, palette and map survive.
    this.oam.fill(0);
    this.rowScroll.fill(0);
    this.rowScrollNext.fill(0);
    this.resetControls();
    this.frame = 0;
    this.blink = 0;
    this.dirty++;
  }

  resetControls() {
    this.curRow = 0;
    this.curCol = 0;
    this.cursorEn = true;
    this.rowOff = 0;
    this.scrollX = 0;
    this.scrollXNext = 0;
    this.scrollY = 0;
    this.mapWrite = 0;
    this.mapDisplay = 0;
    this.mapDisplayNext = 0;
    this.spritePage = 0;
    this.rowScrollEn = 0;
    this.rowScrollEnNext = 0;
    this.rasterLine = 0;
  }

  // ---- CPU windows ------------------------------------------------------

  write(addr, value) {
    value &= 0xFFFF;
    addr &= 0xFFFFF;
    let handled = true;

    if (addr >= 0xF1000 && addr <= 0xF1853) {
      this.tilemap[this.mapWrite][addr - 0xF1000] = value;
    } else if (addr >= 0xF2000 && addr <= 0xF200E && (addr & 1) === 0) {
      switch (addr - 0xF2000) {
        case 0x0:
          this.curRow = (value >> 8) & 0x1F;
          this.curCol = (value >> 1) & 0x7F;
          this.cursorEn = (value & 1) !== 0;
          break;
        case 0x2: this.rowOff = value & 0x1F; break;
        case 0x4: this.scrollXNext = value & 0xF; break;
        case 0x6: this.scrollY = value & 0x1F; break;
        case 0x8:
          this.mapWrite = value & 1;
          this.mapDisplayNext = (value >> 1) & 1;
          break;
        case 0xA: this.spritePage = (value & 3) === 3 ? 0 : (value & 3); break;
        case 0xC: {
          const row = (value >> 3) & 0x1F;
          if (row < this.MAP_ROWS) this.rowScrollNext[row] = value & 7;
          this.rowScrollEnNext = (value >> 8) & 1;
          break;
        }
        case 0xE: this.rasterLine = value & 0x3FF; break;
        default: handled = false;
      }
    } else if (addr >= 0xF3000 && addr <= 0xF3FFF) {
      this.tileBank[addr - 0xF3000] = value;
    } else if (addr >= 0xF4000 && addr <= 0xF47FF) {
      this.spriteBank[this.spritePage * this.SPR_PAGE_WORDS + (addr - 0xF4000)] = value;
    } else if (addr >= 0xF5000 && addr <= 0xF500F) {
      this.oam[addr - 0xF5000] = value;
    } else if (addr >= 0xF5080 && addr <= 0xF50AF) {
      this.palette[addr - 0xF5080] = value & 0xFF;
    } else {
      handled = false;
    }

    if (handled) this.dirty++;
    return handled;
  }

  // ---- frame boundary ---------------------------------------------------

  tick() {
    this.mapDisplay = this.mapDisplayNext;
    this.scrollX = this.scrollXNext;
    this.rowScroll.set(this.rowScrollNext);
    this.rowScrollEn = this.rowScrollEnNext;
    // 24.75 MHz render clock / 60 Hz = 412,500 clocks per frame. The RTL's
    // cursor blink is bit 23 of a free-running counter.
    this.blink = (this.blink + 412500) & 0xFFFFFF;
    this.frame ^= 1;
    this.dirty++;
    return this.frame;
  }

  // ---- rendering --------------------------------------------------------

  wrapRows(n) {
    n %= this.MAP_ROWS;
    return n < 0 ? n + this.MAP_ROWS : n;
  }

  rgb332(byte) {
    const r3 = (byte >> 5) & 7;
    const g3 = (byte >> 2) & 7;
    const b2 = byte & 3;
    const r = (r3 << 5) | (r3 << 2) | (r3 & 3);
    const g = (g3 << 5) | (g3 << 2) | (g3 & 3);
    const b = b2 * 0x55;
    return [r, g, b];
  }

  // One background pixel. Returns { index, pixIndex } where index is the
  // palette entry and pixIndex is the 4-bit value the "behind" test uses.
  background(x, y, line) {
    const cellPos = line.fine + x;
    const cellX = cellPos & 7;
    const mapCol = line.coarse + (cellPos >> 3);
    if (mapCol < 0 || mapCol >= this.MAP_COLS) return { index: 0, pixIndex: 0 };
    const cell = this.tilemap[this.mapDisplay][line.mapRow * this.MAP_COLS + mapCol];
    const isText = (cell & 0x8000) !== 0;

    if (isText) {
      const pair = (cell >> 12) & 7;
      const style = cell & 7;
      const glyph = (cell >> 5) & 0x7F;
      const addr = 0x20 + glyph * 8 + ((style & 1) ? 0x300 : 0) + (line.gyVal >> 1);
      const word = this.tileBank[addr & 0xFFF];
      const byte = (line.gyVal & 1) ? ((word >> 8) & 0xFF) : (word & 0xFF);
      const raw = (byte >> (7 - cellX)) & 1;
      const underline = (style & 4) !== 0 && line.gyVal === 14;
      const bold = (style & 2) !== 0 && line.prevInk;
      const ink = raw | (underline ? 1 : 0) | (bold ? 1 : 0);
      const pixIndex = (word >> ((cellX & 3) * 4)) & 0xF;
      line.prevInk = raw;
      return { index: pair * 2 + ink, pixIndex };
    }

    const base = cell & 0x0FE0;
    const word = this.tileBank[(base + line.gyVal * 2 + (cellX >= 4 ? 1 : 0)) & 0xFFF];
    const pix = (word >> ((cellX & 3) * 4)) & 0xF;
    line.prevInk = 0;
    return { index: 16 + pix, pixIndex: pix };
  }

  spritePixel(slot, x, y) {
    const w0 = this.oam[slot * 2];
    const w1 = this.oam[slot * 2 + 1];
    if (!(w0 & 0x0800)) return null;                 // enable
    const group = (w1 >> 11) & 0x1F;
    if (group >= this.SPR_GROUPS) return null;

    const sx = (w0 & 0x0400) ? ((w0 & 0x03FF) - 1024) : (w0 & 0x03FF);
    const sy = w1 & 0x03FF;
    let col = x - sx;
    let row = y - sy;
    if (col < 0 || col > 31 || row < 0 || row > 31) return null;

    if (w0 & 0x2000) col = 31 - col;                 // H flip
    if (w0 & 0x4000) row = 31 - row;                 // V flip

    const tile = (row >> 3) * 4 + (col >> 3);
    const word = this.spriteBank[group * 256 + tile * 16 + (row & 7) * 2 + ((col & 7) >> 2)];
    const pix = (word >> (((col & 7) & 3) * 4)) & 0xF;
    if (pix === 0) return null;
    return { pix, behind: (w0 & 0x8000) !== 0 };
  }

  // Returns the RGBA buffer (640x360, row-major).
  render() {
    const out = this.pixels;
    const cursorOn = this.cursorEn && (this.blink & 0x800000) !== 0;

    for (let y = 0; y < this.HEIGHT; y++) {
      const ty = Math.floor(y / this.CELL_H);
      const gy = y % this.CELL_H;
      const gySum = gy + this.scrollY;
      const carry = gySum >= 30 ? 2 : gySum >= 15 ? 1 : 0;
      const gyVal = gySum - (carry === 2 ? 30 : carry === 1 ? 15 : 0);
      const trow = ty + carry;
      const mapRow = this.wrapRows(trow + this.rowOff);
      const fine = this.rowScrollEn ? this.rowScroll[trow] : (this.scrollX & 7);
      const line = {
        mapRow,
        gyVal,
        fine,
        coarse: this.scrollX >> 3,
        prevInk: 0,
      };
      const cursorRow = cursorOn && trow === this.curRow;

      for (let x = 0; x < this.WIDTH; x++) {
        if (((x + line.fine) & 7) === 0) line.prevInk = 0;
        const bg = this.background(x, y, line);
        let paletteIndex = bg.index;
        let spriteIndex = -1;

        for (let slot = 0; slot < 8; slot++) {
          const sp = this.spritePixel(slot, x, y);
          if (!sp) continue;
          if (sp.behind && bg.pixIndex !== 0) continue;
          spriteIndex = sp.pix;
          break;                                     // slot 0 wins
        }
        if (spriteIndex > 0) paletteIndex = 32 + spriteIndex;

        const atCursor = cursorOn && cursorRow && ((x >> 3) === this.curCol) &&
                         spriteIndex < 0;
        let value = this.palette[paletteIndex] || 0;
        if (atCursor) value ^= 0xFF;

        const p = (y * this.WIDTH + x) * 4;
        const c = value * 3;
        out[p] = this.rgbTable[c];
        out[p + 1] = this.rgbTable[c + 1];
        out[p + 2] = this.rgbTable[c + 2];
        out[p + 3] = 255;
      }
    }
    return out;
  }

  // ---- test/debug -------------------------------------------------------

  snapshot() {
    return {
      tilemap: this.tilemap.map((bank) => bank.slice()),
      tileBank: this.tileBank.slice(),
      spriteBank: this.spriteBank.slice(),
      oam: this.oam.slice(),
      palette: this.palette.slice(),
      rowScroll: this.rowScroll.slice(),
      rowScrollNext: this.rowScrollNext.slice(),
      cursor: { row: this.curRow, col: this.curCol, enable: this.cursorEn },
      rowOff: this.rowOff,
      scrollX: this.scrollX,
      scrollXNext: this.scrollXNext,
      scrollY: this.scrollY,
      mapWrite: this.mapWrite,
      mapDisplay: this.mapDisplay,
      mapDisplayNext: this.mapDisplayNext,
      spritePage: this.spritePage,
      rowScrollEn: this.rowScrollEn,
      rowScrollEnNext: this.rowScrollEnNext,
      rasterLine: this.rasterLine,
      frame: this.frame,
      blink: this.blink,
    };
  }
}
