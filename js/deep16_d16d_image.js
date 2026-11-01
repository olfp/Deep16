/* deep16_d16d_image.js - build the D16D code image in the browser.
 *
 * The image is code only: the nano kernel from the editor plus the showcase
 * menu/game sources. Graphics are not part of it; they live in the flash blob
 * and are loaded by the tile engine's loader.
 *
 * Placement mirrors scripts/make_image.mjs + make_showcase.mjs:
 *   - kernel assembled with CONSOLE_UART, D16NANO, D16D (and D16SEG by default);
 *   - showcase words at physical 0x4A00 + their segment offset;
 *   - fill 0xFFFF; anything outside 0x0000..0x5FFF is reported, not written.
 */
class Deep16D16DImage {
  static build({ kernel, showcase, flappy, defines = {} } = {}) {
    if (typeof Deep16Assembler !== 'function') throw new Error('Deep16Assembler is not loaded');
    if (typeof kernel !== 'string' || !kernel.trim()) throw new Error('D16D image needs kernel source');
    if (typeof showcase !== 'string' || typeof flappy !== 'string') {
      throw new Error('D16D image needs the showcase and flappy sources');
    }

    const defs = {
      CONSOLE_UART: 1,
      D16NANO: 1,
      D16D: 1,
      D16SEG: 1,
      ...defines,
    };

    const kres = new Deep16Assembler().assemble(kernel, { defines: defs });
    if (!kres.success) throw new Error('kernel does not assemble: ' + kres.errors.join('; '));

    const sres = new Deep16Assembler().assemble(`${showcase}\n${flappy}`);
    if (!sres.success) throw new Error('showcase does not assemble: ' + sres.errors.join('; '));

    const WINDOW = 0x6000;
    const SHOWCASE_BASE = 0x4A00;
    const words = new Uint16Array(WINDOW).fill(0xFFFF);
    const outOfWindow = new Set();

    for (const change of kres.memoryChanges) {
      if (change.address >= 0 && change.address < WINDOW) {
        words[change.address] = change.value & 0xFFFF;
      } else {
        outOfWindow.add(change.address);
      }
    }
    for (const change of sres.memoryChanges) {
      if (change.address < 0 || change.address >= 0x10000) {
        throw new Error(`showcase address out of range: 0x${change.address.toString(16)}`);
      }
      const pa = SHOWCASE_BASE + change.address;
      if (pa < WINDOW) words[pa] = change.value & 0xFFFF;
      else outOfWindow.add(pa);
    }

    return {
      words,
      outOfWindow: [...outOfWindow].sort((a, b) => a - b),
      dictFree: kres.symbols.dict_free,
      biosEntry: kres.symbols.bios_entry,
      symbols: kres.symbols,
      showcase: { words: sres.memoryChanges.map((c) => [c.address, c.value & 0xFFFF]) },
    };
  }
}
