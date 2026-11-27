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
const SYS_STAGE_BASE = 0x4A00;
// The BDOS chapter is dense after Phase 4a. These free flat-image runs carry
// its words to the board: the RTL windows in flash_boot.sv use the same six
// (source, destination, length) triples.
const BDOS_IMAGE_WORDS = 0x71D;
const BDOS_STAGE_WINDOWS = [
  { src: 0x0000, dst: 0x0000, len: 256 },
  { src: 0x2E05, dst: 0x0100, len: 293 },
  { src: 0x40E8, dst: 0x0225, len: 149 },
  { src: 0x6C90, dst: 0x02BA, len: 880 },
  { src: 0x6A85, dst: 0x062A, len: 11 },
  { src: 0x688B, dst: 0x0635, len: 117 },
  { src: 0x67D5, dst: 0x06AA, len: 43 },
  { src: 0x5FE3, dst: 0x06D5, len: 29 },
  { src: 0x2D49, dst: 0x06F2, len: 64 },
];

class Deep16D16DImage {
  // Stage the two segment-relative chapters into free flat-image words. The
  // system chapter is placed at 0x4A00 + offset so the existing BIOS window
  // copies it to CS=0x3000; BDOS is packed into free runs and copied by the
  // dedicated 0x4000 windows. The chapter images themselves stay separate for
  // the manifest and the JS scatter.
  static stageChapters(words, { bdos = null, sys = null } = {}) {
    if (!words || typeof words.length !== 'number') throw new Error('stageChapters needs the flat image');
    if (sys && sys.words) {
      for (let offset = 0; offset < sys.words.length; offset++) {
        if (sys.words[offset] === 0xFFFF) continue;
        const address = SYS_STAGE_BASE + offset;
        if (address >= words.length) throw new Error(`system staging 0x${address.toString(16)} is outside the image`);
        if (words[address] !== 0xFFFF) {
          throw new Error(`system staging collides at 0x${address.toString(16)}`);
        }
        words[address] = sys.words[offset];
      }
    }
    if (bdos && bdos.words) {
      for (const win of BDOS_STAGE_WINDOWS) {
        for (let i = 0; i < win.len; i++) {
          const address = win.src + i;
          if (address >= words.length) throw new Error(`BDOS staging 0x${address.toString(16)} is outside the image`);
          if (words[address] !== 0xFFFF) {
            throw new Error(`BDOS staging collides at 0x${address.toString(16)}`);
          }
          words[address] = bdos.words[win.dst + i];
        }
      }
      let last = 0;
      for (let i = 0; i < bdos.words.length; i++) if (bdos.words[i] !== 0xFFFF) last = i + 1;
      if (last > BDOS_IMAGE_WORDS) {
        throw new Error(`BDOS chapter is ${last} words, past the ${BDOS_IMAGE_WORDS}-word staging plan`);
      }
    }
    return { bdosWindows: BDOS_STAGE_WINDOWS.slice() };
  }

  // Assemble one nano kernel into the flat 24K image window. When softfloat is
  // supplied it is appended, at its own .org 0x5800, and FPU_KERNEL turns on
  // the ILL dispatch that calls it. forthFloat adds the Forth surface at
  // 0x417D and defines FPU_WORDS.
  // Phase 3b: the flat FloatLib shifts by -0x4A00 into the system chapter's
  // copy destinations. The only external label is the ILL handler's
  // ill_restore_shared, which is at 0x0728 in the system chapter.
  static systemSoftfloat(text) {
    const body = String(text)
      .replace(/^\.org 0x5800$/m, '.org 0x0E00')
      .replace(/^\.org 0x6000$/m, '.org 0x1600');
    return `.equ ill_restore_shared, 0x0728\n${body}`;
  }

  static assembleNano({ kernel, softfloat = null, forthFloat = null, bdosBlock = null,
                        illBlock = null, defines = {} } = {}) {
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
    const sources = [kernel];
    if (softfloat !== null) {
      defs.FPU_KERNEL = 1;
      // Phase 3b: under D16D the library is a system chapter, not flat code.
      if (!defs.D16D) sources.push(softfloat);
    }
    if (forthFloat !== null) {
      defs.FPU_WORDS = 1;
      sources.push(forthFloat);
    }
    if (typeof Deep16Linker !== 'function') throw new Error('Deep16Linker is not loaded');

    const chapters = [Deep16Linker.flat({ id: 'flat', sources })];
    if (defs.D16D && typeof illBlock === 'string' && illBlock.trim()) {
      // Phase 3: the ILL handler is a segment-relative system chapter at
      // CS=0x3000, offset 0x0600 (plus its dispatch helpers). The flat copy
      // is FILL under D16D; scatterD16SEG() places this at 0x30000 after the
      // BIOS copy, so the trap entry still finds it at 0x0600.
      const systemSources = [illBlock];
      if (softfloat !== null) systemSources.push(this.systemSoftfloat(softfloat));
      chapters.push({ id: 'sys', seg: 0x3000, base: 0, relative: true, sources: systemSources });
    }
    if (typeof bdosBlock === 'string' && bdosBlock.trim()) {
      // Phase 2c-0: the BDOS chapter is a segment-relative chapter. It does not
      // contribute to the flat kernel image; scatterD16SEG() places it at
      // 0x40000. The entry move itself is 2c-1.
      chapters.push({ id: 'bdos', seg: 0x4000, base: 0, relative: true, sources: [bdosBlock] });
    }

    // The FPU image carries fexp32/flog32 at 0x6000, so it needs 0x7000 words.
    const WINDOW = softfloat !== null ? 0x7000 : 0x6000;
    const linked = new Deep16Linker(Deep16Assembler).link({
      chapters,
      defines: defs,
      window: WINDOW,
      fill: 0xFFFF,
      flatChapter: 'flat',
    });
    const result = linked.flatView.result;
    if (!result.success) throw new Error('kernel does not assemble: ' + result.errors.join('; '));

    const bdos = linked.chapters.find((c) => c.id === 'bdos') ?? null;
    const sys = linked.chapters.find((c) => c.id === 'sys') ?? null;
    return {
      result,
      words: linked.flatView.words,
      outOfWindow: linked.flatView.outOfWindow,
      bdos: bdos ? { words: bdos.words, outOfWindow: bdos.outOfWindow } : null,
      sys: sys ? { words: sys.words, outOfWindow: sys.outOfWindow } : null,
    };
  }

  // The image invariants every scattered copy relies on. The Node builder has
  // the same checks in scripts/make_image.mjs; the IDE used to scatter without
  // consulting any of them, so a kernel that grew into the stacks still booted
  // in the browser and failed only on the board. `window` is the image length,
  // and D16SEG's return stack is a DS window, so the BIOS limit is the image
  // window rather than flat 0x5800.
  static checkImage(img) {
    const fail = [];
    const window = img.words.length;
    if (!(img.dictFree < 0x5800)) {
      fail.push(`dict_free 0x${img.dictFree.toString(16)} reaches the stacks (0x5800)`);
    }
    if (img.dictFree > img.biosEntry) {
      fail.push(`dict_free 0x${img.dictFree.toString(16)} runs into the BIOS at 0x${img.biosEntry.toString(16)}`);
    }
    if (img.biosEntry !== 0x4A00) {
      fail.push(`BIOS at 0x${img.biosEntry.toString(16)}, expected 0x4a00`);
    }
    if (img.biosEntry + img.biosWords > window) {
      fail.push(`BIOS 0x${img.biosEntry.toString(16)}..0x${(img.biosEntry + img.biosWords - 1).toString(16)} ` +
                `(${img.biosWords} words) overruns the image window at 0x${window.toString(16)}`);
    }
    const unexpected = (img.outOfWindow ?? []).filter((a) => a !== 0xF0064);
    if (unexpected.length) {
      fail.push('words outside the window: ' + unexpected.map((a) => '0x' + a.toString(16)).join(', '));
    }
    if ((img.collisions ?? []).length && img.segmented !== false) {
      fail.push('blocks overwrite live kernel words at ' +
                img.collisions.map((a) => '0x' + a.toString(16)).join(', '));
    }
    if (fail.length) throw new Error('image is not valid:\n  - ' + fail.join('\n  - '));
    return true;
  }

  static biosWords(result) {
    const entry = result.symbols.bios_entry;
    let hi = 0;
    for (const c of result.memoryChanges) {
      if (c.address >= entry && c.address < 0x10000) hi = Math.max(hi, c.address);
    }
    return hi - entry + 1;
  }

  // The generic D16nano console used by the IDE. CONSOLE_PS2 keeps the
  // CONSOLE_UART output path, but reads input from the D16nano keyboard FIFO
  // instead of the serial UART.
  static buildNano({ kernel, softfloat = null, forthFloat = null, bdosBlock = null,
                     illBlock = null, defines = {} } = {}) {
    const image = this.assembleNano({
      kernel,
      softfloat,
      forthFloat,
      bdosBlock,
      illBlock,
      defines: { CONSOLE_MIRROR: 1, CONSOLE_PS2: 1, ...defines },
    });
    const result = image.result;
    const img = {
      words: image.words,
      outOfWindow: image.outOfWindow,
      bdos: image.bdos,
      sys: image.sys,
      collisions: [],
      dictFree: result.symbols.dict_free,
      biosEntry: result.symbols.bios_entry,
      biosWords: this.biosWords(result),
      fpu: softfloat !== null,
      fpuWords: forthFloat !== null,
      symbols: result.symbols,
    };
    this.checkImage(img);
    return img;
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
  // Format-2 table entries: one destination each. The DS mirror and the
  // system copy repeat source ranges intentionally; the flat image is copied
  // by the canonical payload pass and is not listed.
  static chapterTable(bdosWindows = [], imageWords = 0x7000) {
    const entries = [
      { id: 1, seg: 0x1000, base: 0x3000, src: 0x3000, count: 0x57DC - 0x3000 + 1 },
      { id: 2, seg: 0x3000, base: 0x0000, src: 0x4A00, count: imageWords - 0x4A00 },
    ];
    for (const win of bdosWindows) {
      entries.push({ id: 3, seg: 0x4000, base: win.dst, src: win.src, count: win.len });
    }
    return entries.map((e) => ({ ...e, srcPairStart: e.src >> 1, flags: e.src & 1 }));
  }

  static scatterD16SEG(words, { bootPtr = null, bdos = null, sys = null, table = null, memory = null } = {}) {
    if (!words || typeof words.length !== 'number') {
      throw new Error('D16SEG scatter needs an image word array');
    }

    const writes = new Map();
    const put = (address, value) => writes.set(address >>> 0, value & 0xFFFF);
    const last = words.length - 1;

    for (let offset = 0; offset <= last; offset++) put(offset, words[offset]);
    if (table) {
      // Phase 4b: the same table the flash loader reads. Source indices are
      // flat image words; an odd source starts on the high half of its pair.
      for (const entry of table) {
        const src = (entry.srcPairStart << 1) + (entry.flags & 1);
        const dst = (entry.seg << 4) + entry.base;
        for (let i = 0; i < entry.count; i++) put(dst + i, words[src + i]);
      }
    } else {
      for (let offset = 0x3000; offset <= Math.min(0x57DC, last); offset++) {
        put(0x10000 + offset, words[offset]);
      }
      for (let offset = 0x4A00; offset <= last; offset++) {
        put(0x30000 + (offset - 0x4A00), words[offset]);
      }

      // Phase 3: the system chapter (ILL handler) is placed after the BIOS copy,
      // which copied FILL over its old flat range. Its words are offsets.
      if (sys && sys.words) {
        for (let offset = 0; offset < sys.words.length; offset++) {
          if (sys.words[offset] !== 0xFFFF) put(0x30000 + offset, sys.words[offset]);
        }
      }

      // Phase 2c: the BDOS chapter is its own segment. Its words are offsets,
      // so the destination is 0x40000 + offset. FILL words are already erased.
      if (bdos && bdos.words) {
        for (let offset = 0; offset < bdos.words.length; offset++) {
          if (bdos.words[offset] !== 0xFFFF) put(0x40000 + offset, bdos.words[offset]);
        }
      }
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

  static build({ kernel, softfloat = null, forthFloat = null, bdosBlock = null,
                 illBlock = null, showcase, flappy, flappyDefs,
                 pacmanMap, pacmanGame, frogger, defines = {}, packs = {},
                 layouts = null, layoutBase = 0x6a90 } = {}) {
    if (typeof kernel !== 'string' || !kernel.trim()) throw new Error('D16D image needs kernel source');
    if (typeof showcase !== 'string') throw new Error('D16D image needs the showcase source');

    // The board image carries the soft-float library so the D16D ILL handler
    // can execute trapped FPU words from the BIOS segment. Callers that do not
    // pass it get the pre-P4 image, which is what the generic nano builder uses.
    const kernelImage = this.assembleNano({
      kernel,
      softfloat,
      forthFloat,
      bdosBlock,
      illBlock,
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
    // Pac-Man is only a config-flash slice; the block returned below feeds the
    // slice manifest, and the image itself never carries it.

    // PS/2 layout data lives in the free BIOS-image tail. The browser build
    // receives it from the generator; without it the ASCII host path still
    // works, but the image is not the board image.
    if (layouts) {
      for (let i = 0; i < layouts.length; i++) {
        const a = layoutBase + i;
        if (a >= WINDOW) throw new Error(`PS/2 layout table over the image at 0x${a.toString(16)}`);
        if (words[a] !== 0xFFFF) throw new Error(`PS/2 layout table overwrites 0x${a.toString(16)}`);
        words[a] = layouts[i] & 0xFFFF;
      }
    }

    // Phase 4a: put the chapter payloads into free flat words for the board
    // loader. This runs after the showcase and layouts so the staging checks
    // see the final image.
    const staged = defines.D16SEG !== 0
      ? this.stageChapters(words, { bdos: kernelImage.bdos, sys: kernelImage.sys })
      : { bdosWindows: [] };

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

    const img = {
      words,
      outOfWindow: [...outOfWindow].sort((a, b) => a - b),
      bdos: kernelImage.bdos,
      sys: kernelImage.sys,
      bdosWindows: staged.bdosWindows,
      format: defines.D16SEG !== 0 ? 2 : 1,
      chapterTable: defines.D16SEG !== 0
        ? this.chapterTable(staged.bdosWindows, words.length) : null,
      collisions,
      dictFree: kres.symbols.dict_free,
      biosEntry: kres.symbols.bios_entry,
      biosWords: Math.max(this.biosWords(kres),
                         layouts ? layoutBase + layouts.length - kres.symbols.bios_entry : 0),
      fpu: softfloat !== null,
      fpuWords: forthFloat !== null,
      // The flat D16SEG=0 render harness deliberately lays the menu over the
      // flat BIOS at 0x4A00; only the segmented map has room for both.
      segmented: defines.D16SEG !== 0,
      symbols: kres.symbols,
      showcase: { words: sres.memoryChanges.map((c) => [c.address, c.value & 0xFFFF]) },
      flappy: block(fres, 0x5000, packs.flappy, packs.flappySprites),
      frogger: block(gres, 0x0600, packs.frogger, packs.froggerSprites),
      pacman: (() => {
        const b = block(pres, 0x2000, packs.pacman);
        return b && { ...b, codeEnd: pres.symbols.p_code_end };
      })(),
    };
    this.checkImage(img);
    return img;
  }
}
