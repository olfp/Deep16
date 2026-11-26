/* deep16_linker.js - build-time chapter linker (MEMFIXPLAN phase 1).
 *
 * Phase 1 links exactly one chapter whose sources and addresses are today's
 * flat image, so the result is byte-identical to assembling directly. The
 * chapter schema, the two passes (placement, then import resolution) and the
 * constant-pool plumbing are already here for phases 2-3; no shipping source
 * uses imports or a pool yet, so nothing is emitted for them.
 *
 * Browser-safe: no node:fs, no crypto, no CLI side effects. index.html loads it
 * after the assembler and before the image builders; scripts/make_image.mjs
 * loads it with vm.runInThisContext the same way it loads the assembler.
 *
 * The contract:
 *   link({ chapters, defines, window, fill, imports, pool }) -> {
 *     chapters: [{ id, seg, base, physical, wordCount, sources }],
 *     symbols, flatView, manifest, pool
 *   }
 * `flatView` is the compatibility view the existing scatter and tests use:
 * { words, outOfWindow, memoryChanges, result, success, errors, pool }.
 */
class Deep16Linker {
  constructor(assemblerClass = null) {
    this.Assembler = assemblerClass ||
      (typeof Deep16Assembler === 'function' ? Deep16Assembler : null);
  }

  // One chapter covering today's flat image: physical 0, the whole 64K window.
  static flat({ id = 'flat', seg = 0, base = 0, sources = [], fill = 0xFFFF } = {}) {
    return { id, seg, base, fill, sources };
  }

  link({ chapters = [], defines = {}, window = 0x6000, fill = 0xFFFF,
         imports = {}, pool = null } = {}) {
    if (!this.Assembler) throw new Error('Deep16Linker needs Deep16Assembler');
    const list = chapters.map((chapter) => ({ fill, ...chapter }));
    if (list.length === 0) throw new Error('a link needs at least one chapter');
    this.checkLayout(list);

    // A pool index is deterministic from the entry list, so the CONST_ equ's
    // can be injected before assembly. Phase 1 passes no pool, which keeps the
    // source (and therefore the line numbers and the image) untouched.
    const poolInfo = Deep16Linker.constantPool(pool?.entries ?? []);
    const poolPrologue = Object.entries(poolInfo.equ)
      .map(([name, value]) => `.equ ${name}, ${value}`).join('\n');
    const basePrologue = poolPrologue ? poolPrologue + '\n' : '';

    // Placement pass: every chapter at its final origin, no imports yet.
    const placement = list.map((chapter) => this.assembleChapter(chapter, defines, basePrologue));

    // Resolve pass: a chapter with imports gets a generated .equ prologue with
    // the placement values of the chapters it names. Chapters without imports
    // are not re-assembled, so Phase 1 keeps one pass and identical output.
    const placedSymbols = {};
    for (const placed of placement) Object.assign(placedSymbols, placed.result.symbols);
    const resolved = placement.map((placed) => {
      const names = imports[placed.chapter.id] || [];
      if (names.length === 0) return placed;
      const equ = names.map((name) => {
        if (!Object.prototype.hasOwnProperty.call(placedSymbols, name)) {
          throw new Error(`chapter '${placed.chapter.id}' imports unknown symbol '${name}'`);
        }
        return `.equ ${name}, ${placedSymbols[name]}`;
      });
      return this.assembleChapter(placed.chapter, defines,
                                  basePrologue + equ.join('\n') + '\n');
    });

    const { memoryChanges, symbols, errors, success } = this.merge(resolved);
    const words = new Uint16Array(window).fill(fill);
    const outOfWindow = new Set();
    const written = new Map();
    for (const change of memoryChanges) {
      written.set(change.address, 'chapter');
      if (change.address >= 0 && change.address < window) {
        words[change.address] = change.value & 0xFFFF;
      } else {
        outOfWindow.add(change.address);
      }
    }

    const poolWords = [];
    if (pool && poolInfo.words.length) {
      if (!Number.isInteger(pool.address)) throw new Error('a non-empty pool needs an address');
      for (let i = 0; i < poolInfo.words.length; i++) {
        const address = pool.address + i;
        if (address < 0 || address >= window) {
          throw new Error(`pool word at 0x${address.toString(16)} is outside the ${window}-word image`);
        }
        if (written.has(address)) {
          throw new Error(`pool word at 0x${address.toString(16)} collides with chapter code`);
        }
        written.set(address, 'pool');
        words[address] = poolInfo.words[i];
        poolWords.push({ address, value: poolInfo.words[i] });
      }
    }

    const chapterInfo = list.map((chapter, i) => {
      const physical = ((chapter.seg << 4) + chapter.base) >>> 0;
      const wordCount = resolved[i].result.memoryChanges
        .filter((c) => c.address >= physical && c.address < physical + 0x10000).length;
      return {
        id: chapter.id,
        seg: chapter.seg,
        base: chapter.base,
        physical,
        fill: chapter.fill,
        sources: chapter.sources.map((s) => (typeof s === 'string' ? '<inline>' : (s.name || '<inline>'))),
        wordCount,
      };
    });

    const result = {
      success,
      errors,
      memoryChanges,
      symbols,
      listing: resolved[resolved.length - 1].result.listing,
      segmentMap: resolved[resolved.length - 1].result.segmentMap,
      overlap: resolved[resolved.length - 1].result.overlap ?? [],
    };
    const flatView = {
      words,
      outOfWindow: [...outOfWindow].sort((a, b) => a - b),
      memoryChanges,
      result,
      success,
      errors,
      pool: poolWords,
    };
    const manifest = {
      format: 1,
      window,
      fill,
      chapters: chapterInfo,
      pool: {
        indexLimit: 0x3FFF,
        entries: poolInfo.indices,
        words: poolWords.length,
      },
      symbols: Object.keys(symbols).length,
    };
    return { chapters: chapterInfo, symbols, flatView, manifest, pool: poolWords };
  }

  // Assemble one chapter's sources. The optional prologue is only for importer
  // resolution and pool equ's, so a chapter without either assembles exactly
  // the text the builders used before the linker existed.
  assembleChapter(chapter, defines, prologue = '') {
    const text = chapter.sources
      .map((source) => (typeof source === 'string' ? source : source.text))
      .join('\n');
    return {
      chapter,
      result: new this.Assembler().assemble(prologue + text, { defines }),
    };
  }

  merge(resolved) {
    const memoryChanges = [];
    const symbols = {};
    const errors = [];
    const seen = new Map();
    let success = true;
    for (const { chapter, result } of resolved) {
      if (!result.success) {
        success = false;
        for (const error of result.errors) {
          errors.push(resolved.length > 1 ? `${chapter.id}: ${error}` : error);
        }
      }
      for (const change of result.memoryChanges) {
        const previous = seen.get(change.address);
        if (previous) {
          success = false;
          errors.push(`chapters '${previous}' and '${chapter.id}' both write ` +
                      `0x${change.address.toString(16)}`);
          continue;
        }
        seen.set(change.address, chapter.id);
        memoryChanges.push(change);
      }
      Object.assign(symbols, result.symbols);
    }
    return { memoryChanges, symbols, errors, success: success && errors.length === 0 };
  }

  // A chapter is a 64K destination window in one segment. Two chapters in the
  // same segment would claim the same physical window even when their source
  // offsets differ, so reject that outright; the target map gives each chapter
  // its own segment.
  checkLayout(chapters) {
    const segments = new Map();
    for (const chapter of chapters) {
      if (!chapter.id) throw new Error('every chapter needs an id');
      if (!Number.isInteger(chapter.seg) || chapter.seg < 0 || chapter.seg > 0xFFFF) {
        throw new Error(`chapter '${chapter.id}' has an invalid segment ${chapter.seg}`);
      }
      if (!Number.isInteger(chapter.base) || chapter.base < 0 || chapter.base > 0xFFFF) {
        throw new Error(`chapter '${chapter.id}' has an invalid base ${chapter.base}`);
      }
      if (!Array.isArray(chapter.sources) || chapter.sources.length === 0) {
        throw new Error(`chapter '${chapter.id}' has no sources`);
      }
      const physical = ((chapter.seg << 4) + chapter.base) >>> 0;
      if (physical + 0xFFFF > 0xFFFFF) {
        throw new Error(`chapter '${chapter.id}' does not fit the 20-bit address space`);
      }
      if (segments.has(chapter.seg)) {
        throw new Error(`chapters '${segments.get(chapter.seg)}' and '${chapter.id}' ` +
                        `both claim segment 0x${chapter.seg.toString(16)}`);
      }
      segments.set(chapter.seg, chapter.id);
    }
  }

  // Assign small pool indices to constants a 15-bit LDI cannot hold. One word
  // for a plain constant, two for a far (seg, pc) pair. The caller decides
  // where the words live (link's `pool.address`); phase 1 passes no entries.
  static constantPool(entries = [], { firstIndex = 0, limit = 0x3FFF } = {}) {
    const equ = {};
    const indices = {};
    const words = [];
    let index = firstIndex;
    const used = new Set();
    for (const entry of entries) {
      if (!entry || !entry.name) throw new Error('a pool entry needs a name');
      if (used.has(entry.name)) throw new Error(`duplicate pool entry '${entry.name}'`);
      used.add(entry.name);
      const values = Array.isArray(entry.words) ? entry.words
        : (entry.value === undefined ? null : [entry.value]);
      if (!values || values.length === 0 || values.length > 2) {
        throw new Error(`pool entry '${entry.name}' needs a value or a two-word pair`);
      }
      if (index + values.length - 1 > limit) {
        throw new Error(`pool entry '${entry.name}' pushes the index past 0x${limit.toString(16)}`);
      }
      equ[`CONST_${entry.name}`] = index;
      indices[entry.name] = index;
      for (const value of values) words.push(value & 0xFFFF);
      index += values.length;
    }
    return { equ, indices, words, nextIndex: index, limit };
  }

  // Source forms for the pool. LDS is explicit: DS is rewritten all over the
  // kernel, and the pool lives in a code segment.
  static ldc(register, name) {
    return `LDI CONST_${name}\nLDS ${register}, CS, R0`;
  }

  static ldcFar(name, { segment = 'CS' } = {}) {
    return `LDI CONST_${name}\n` +
           `LDS R10, ${segment}, R0\n` +
           `ADD R0, 1\n` +
           `LDS R11, ${segment}, R0\n` +
           `JML R10`;
  }
}
