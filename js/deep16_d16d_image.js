/* deep16_d16d_image.js - build the D16D code image in the browser.
 *
 * The image is code only: the nano kernel from the editor plus the showcase
 * menu. Flappy, Frogger and Pac-Man are type-4 slices loaded from the config
 * flash by BDOS at run time; the builder still assembles them so the renderer
 * and the tests can place them at their segments.
 *
 * Placement mirrors scripts/make_image.mjs + make_showcase.mjs:
 *   - kernel assembled with CONSOLE_UART, D16NANO, D16D (and D16SEG by default);
 *   - menu words at physical 0x4A00 + their segment offset;
 *   - fill 0xFFFF; anything outside 0x0000..0x5FFF is reported, not written.
 */
class Deep16D16DImage {
  static build({ kernel, showcase, flappy, flappyDefs, pacmanMap, pacmanGame, frogger, defines = {},
                 bakePacman = false, packs = {} } = {}) {
    if (typeof Deep16Assembler !== 'function') throw new Error('Deep16Assembler is not loaded');
    if (typeof kernel !== 'string' || !kernel.trim()) throw new Error('D16D image needs kernel source');
    if (typeof showcase !== 'string') throw new Error('D16D image needs the showcase source');

    const defs = {
      CONSOLE_UART: 1,
      D16NANO: 1,
      D16D: 1,
      D16SEG: 1,
      ...defines,
    };

    const kres = new Deep16Assembler().assemble(kernel, { defines: defs });
    if (!kres.success) throw new Error('kernel does not assemble: ' + kres.errors.join('; '));

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

    const WINDOW = 0x6000;
    const SHOWCASE_BASE = 0x4A00;
    const PACMAN_BASE = 0x4330;
    const words = new Uint16Array(WINDOW).fill(0xFFFF);
    const outOfWindow = new Set();

    for (const change of kres.memoryChanges) {
      if (change.address >= 0 && change.address < WINDOW) {
        words[change.address] = change.value & 0xFFFF;
      } else {
        outOfWindow.add(change.address);
      }
    }
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
        if (change.address < 0 || change.address >= 0x6D0) {
          throw new Error(`pacman address out of range: 0x${change.address.toString(16)}`);
        }
        const pa = PACMAN_BASE + change.address;
        if (pa < WINDOW) words[pa] = change.value & 0xFFFF;
        else outOfWindow.add(pa);
      }
    }

    const block = (res, seg, pack) => res === null ? null : (() => {
      const words = res.memoryChanges.map((c) => [c.address, c.value & 0xFFFF])
        .sort((a, b) => a[0] - b[0]);
      const codeMax = words.reduce((m, [a]) => Math.max(m, a), 0);
      if (pack) {
        for (let i = 0; i < pack.length; i++) words.push([0x1000 + i, pack[i] & 0xFFFF]);
        words.sort((a, b) => a[0] - b[0]);
      }
      return {
        words,
        seg,
        entry: 0,
        codeMax,
        max: pack ? 0x1000 + pack.length - 1 : codeMax,
      };
    })();

    return {
      words,
      outOfWindow: [...outOfWindow].sort((a, b) => a - b),
      collisions,
      dictFree: kres.symbols.dict_free,
      biosEntry: kres.symbols.bios_entry,
      symbols: kres.symbols,
      showcase: { words: sres.memoryChanges.map((c) => [c.address, c.value & 0xFFFF]) },
      flappy: block(fres, 0x5000, packs.flappy),
      frogger: block(gres, 0x0600, packs.frogger),
      pacman: (() => {
        const b = block(pres, 0x2000, packs.pacman);
        return b && { ...b, codeEnd: pres.symbols.p_code_end };
      })(),
    };
  }
}
