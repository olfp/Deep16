/* deep16_d16d_image.js - build the nano code images in the browser.
 *
 * The image is code only: the nano kernel from the editor plus, for D16D, the
 * showcase menu. Flappy, Frogger and Pac-Man are type-4 slices loaded from the
 * config flash by BDOS at run time; the builder still assembles them so the
 * renderer and the tests can place them at their segments.
 *
 * Placement mirrors scripts/make_image.mjs + make_showcase.mjs:
 *   - kernel assembled with CONSOLE_UART, D16NANO and D16SEG; D16D adds D16D;
 *   - the soft-float library is appended at 0x5800 when an FPU image is asked
 *     for, so the ILL handler can reach it through the BIOS copy;
 *   - the Forth words are appended at 0x417D when forthFloat is supplied;
 *   - menu words at physical 0x4A00 + their segment offset;
 *   - fill 0xFFFF; anything outside 0x0000..0x5FFF is reported, not written.
 *
 * The flat D16D image is deliberately kept word-for-word equal to the Node
 * builder. The segmented memory map is a loader step, not an image format:
 * scatterD16SEG() below makes the three physical copies the RTL flash loader
 * makes.
 */
class Deep16D16DImage {
  // Assemble one nano kernel into the flat 24K image window. When softfloat is
  // supplied it is appended, at its own .org 0x5800, and FPU_KERNEL turns on
  // the ILL dispatch that calls it. forthFloat adds the Forth surface at
  // 0x417D and defines FPU_WORDS.
  static assembleNano({ kernel, softfloat = null, forthFloat = null, defines = {} } = {}) {
    if (typeof Deep16Assembler !== 'function') throw new Error('Deep16Assembler is not loaded');
    if (typeof kernel !== 'string' || !kernel.trim()) throw new Error('nano image needs kernel source');
    if (softfloat !== null && (typeof softfloat !== 'string' || !softfloat.trim())) {
      throw new Error('softfloat source must be text');
    }
    if (forthFloat !== null && (typeof forthFloat !== 'string' || !forthFloat.trim())) {
      throw new Error('forthFloat source must be text');
    }
    if (forthFloat !== null && softfloat === null) {
      throw new Error('forthFloat needs the softfloat library');
    }

    const defs = {
      CONSOLE_UART: 1,
      D16NANO: 1,
      D16SEG: 1,
      ...defines,
    };
    let source = kernel;
    if (softfloat !== null) {
      defs.FPU_KERNEL = 1;
      source = `${kernel}\n${softfloat}`;
    }
    if (forthFloat !== null) {
      defs.FPU_WORDS = 1;
      source = `${source}\n${forthFloat}`;
    }

    const result = new Deep16Assembler().assemble(source, { defines: defs });
    if (!result.success) throw new Error('kernel does not assemble: ' + result.errors.join('; '));

    // The FPU image carries fexp32/flog32 at 0x6000, so it needs 0x7000 words.
    const WINDOW = softfloat !== null ? 0x7000 : 0x6000;
    const words = new Uint16Array(WINDOW).fill(0xFFFF);
    const outOfWindow = new Set();
    for (const change of result.memoryChanges) {
      if (change.address >= 0 && change.address < WINDOW) {
        words[change.address] = change.value & 0xFFFF;
      } else {
        outOfWindow.add(change.address);
      }
    }

    return { result, words, outOfWindow: [...outOfWindow].sort((a, b) => a - b) };
  }

  // The generic D16nano console used by the IDE. CONSOLE_PS2 keeps the
  // CONSOLE_UART output path, but reads input from the D16nano keyboard FIFO
  // instead of the serial UART.
  static buildNano({ kernel, softfloat = null, forthFloat = null, defines = {} } = {}) {
    const image = this.assembleNano({
      kernel,
      softfloat,
      forthFloat,
      defines: { CONSOLE_MIRROR: 1, CONSOLE_PS2: 1, ...defines },
    });
    const result = image.result;
    return {
      words: image.words,
      outOfWindow: image.outOfWindow,
      collisions: [],
      dictFree: result.symbols.dict_free,
      biosEntry: result.symbols.bios_entry,
      fpu: softfloat !== null,
      fpuWords: forthFloat !== null,
      symbols: result.symbols,
    };
  }

  // Scatter a flat D16SEG image into the physical map used by the board and
  // the JS core (rtl/flash/flash_boot.sv):
  //
  //   0x00000..last     flat code/image copy
  //   0x10000 + offset  DS=0x1000 copy of image 0x3000..0x57DC
  //   0x30000 + offset  BIOS segment copy of image 0x4A00..last
  //
  // bootPtr is cleared in the flat and DS copies when supplied. That disables
  // the baked Forth boot script, so the IDE starts at the interactive prompt
  // instead of running the board's demo script. The image words themselves stay
  // unchanged and remain comparable with scripts/make_image.mjs.
  //
  // Returns the writes as { address, value } records. If memory is supplied,
  // the writes are also applied to it.
  static scatterD16SEG(words, { bootPtr = null, memory = null } = {}) {
    if (!words || typeof words.length !== 'number') {
      throw new Error('D16SEG scatter needs an image word array');
    }

    const writes = new Map();
    const put = (address, value) => writes.set(address >>> 0, value & 0xFFFF);
    const last = words.length - 1;

    for (let offset = 0; offset <= last; offset++) put(offset, words[offset]);
    for (let offset = 0x3000; offset <= Math.min(0x57DC, last); offset++) {
      put(0x10000 + offset, words[offset]);
    }
    for (let offset = 0x4A00; offset <= last; offset++) {
      put(0x30000 + (offset - 0x4A00), words[offset]);
    }

    if (bootPtr !== null && bootPtr !== undefined) {
      put(bootPtr, 0);
      put(0x10000 + bootPtr, 0);
    }

    const changes = Array.from(writes, ([address, value]) => ({ address, value }));
    if (memory) {
      for (const change of changes) memory[change.address] = change.value;
    }
    return changes;
  }

  static build({ kernel, softfloat = null, forthFloat = null, showcase, flappy, flappyDefs,
                 pacmanMap, pacmanGame, frogger, defines = {}, bakePacman = false, packs = {} } = {}) {
    if (typeof kernel !== 'string' || !kernel.trim()) throw new Error('D16D image needs kernel source');
    if (typeof showcase !== 'string') throw new Error('D16D image needs the showcase source');
    if (bakePacman && forthFloat !== null) {
      throw new Error('bakePacman is incompatible with the float literal parser (0x4330 gap)');
    }

    // The board image carries the soft-float library so the D16D ILL handler
    // can execute trapped FPU words from the BIOS segment. Callers that do not
    // pass it get the pre-P4 image, which is what the generic nano builder uses.
    const kernelImage = this.assembleNano({
      kernel,
      softfloat,
      forthFloat,
      defines: { D16D: 1, ...defines },
    });
    const kres = kernelImage.result;
    const words = kernelImage.words;
    const outOfWindow = new Set(kernelImage.outOfWindow);

    const sres = new Deep16Assembler().assemble(showcase);
    if (!sres.success) throw new Error('showcase does not assemble: ' + sres.errors.join('; '));

    let fres = null;
    if (typeof flappy === 'string' && typeof flappyDefs === 'string') {
      fres = new Deep16Assembler().assemble(`${flappyDefs}\n${flappy}`);
      if (!fres.success) throw new Error('flappy does not assemble: ' + fres.errors.join('; '));
    }

    if (typeof pacmanMap !== 'string' || typeof pacmanGame !== 'string') {
      throw new Error('D16D image needs the pacman sources');
    }
    const pres = new Deep16Assembler().assemble(`${pacmanMap}\n${pacmanGame}`);
    if (!pres.success) throw new Error('pacman does not assemble: ' + pres.errors.join('; '));

    let gres = null;
    if (typeof frogger === 'string') {
      gres = new Deep16Assembler().assemble(frogger);
      if (!gres.success) throw new Error('frogger does not assemble: ' + gres.errors.join('; '));
    }

    const WINDOW = words.length;
    const SHOWCASE_BASE = 0x4A00;
    const PACMAN_BASE = 0x4330;
    const collisions = [];
    for (const change of sres.memoryChanges) {
      if (change.address < 0 || change.address >= 0x10000) {
        throw new Error(`showcase address out of range: 0x${change.address.toString(16)}`);
      }
      const pa = SHOWCASE_BASE + change.address;
      if (pa < WINDOW) {
        // Same rule as scripts/make_image.mjs: only FILL gaps may be claimed.
        if (words[pa] !== 0xFFFF) collisions.push(pa);
        words[pa] = change.value & 0xFFFF;
      } else outOfWindow.add(pa);
    }
    // Pac-Man can still be baked into the free image gap for a build that has
    // the room back; the board loads it from the config flash instead.
    if (bakePacman) {
      for (const change of pres.memoryChanges) {
        if (change.address < 0 || change.address >= 0x2000) {
          throw new Error(`pacman address out of range: 0x${change.address.toString(16)}`);
        }
        const pa = PACMAN_BASE + change.address;
        if (pa < WINDOW) words[pa] = change.value & 0xFFFF;
        else outOfWindow.add(pa);
      }
    }

    const block = (res, seg, pack, spritePack) => res === null ? null : (() => {
      const blockWords = res.memoryChanges.map((c) => [c.address, c.value & 0xFFFF])
        .sort((a, b) => a[0] - b[0]);
      const codeMax = blockWords.reduce((m, [a]) => Math.max(m, a), 0);
      let max = codeMax;
      if (pack) {
        for (let i = 0; i < pack.length; i++) blockWords.push([0x1000 + i, pack[i] & 0xFFFF]);
        max = Math.max(max, 0x1000 + pack.length - 1);
      }
      if (spritePack) {
        for (let i = 0; i < spritePack.length; i++) blockWords.push([0x2000 + i, spritePack[i] & 0xFFFF]);
        max = Math.max(max, 0x2000 + spritePack.length - 1);
      }
      if (pack || spritePack) blockWords.sort((a, b) => a[0] - b[0]);
      return { words: blockWords, seg, entry: 0, codeMax, max };
    })();

    return {
      words,
      outOfWindow: [...outOfWindow].sort((a, b) => a - b),
      collisions,
      dictFree: kres.symbols.dict_free,
      biosEntry: kres.symbols.bios_entry,
      fpu: softfloat !== null,
      fpuWords: forthFloat !== null,
      symbols: kres.symbols,
      showcase: { words: sres.memoryChanges.map((c) => [c.address, c.value & 0xFFFF]) },
      flappy: block(fres, 0x5000, packs.flappy, packs.flappySprites),
      frogger: block(gres, 0x0600, packs.frogger, packs.froggerSprites),
      pacman: (() => {
        const b = block(pres, 0x2000, packs.pacman);
        return b && { ...b, codeEnd: pres.symbols.p_code_end };
      })(),
    };
  }
}
