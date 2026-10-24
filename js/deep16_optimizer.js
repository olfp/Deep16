/* deep16_optimizer.js
 *
 * A source-to-source peephole optimizer for the Deep16 assembler language.
 *
 * It reads assembly text and writes assembly text; labels stay symbolic, so
 * the existing two-pass assembler re-resolves every branch offset and label
 * after we have deleted or fused an instruction. Nothing here touches memory
 * images or addresses, which is why a deletion costs no relocation work.
 *
 * The rules are built around the opcodes that exist to absorb a second
 * instruction - the MOV imm2 function select above all (doc/ARCHREV.md):
 *
 *   imm2 = 0  Rd <- Rs          MOV Rd, Rs
 *   imm2 = 1  Rd <- Rs << 1     MOV Rd, Rs << 1
 *   imm2 = 2  Rd <- Rs + 2      MOV Rd, Rs + 2
 *   imm2 = 3  Rd <- (Rs << 1)|1 MOV Rd, Rs << 1 + 1
 *
 * plus LSI (5-bit immediate), the literal-immediate ALU forms (ADD/SUB/CMP,
 * 0..15) and the bit-index forms (OR/XOR/TBC/TBS/CLRB, 1 << imm). All of these
 * replace an LDI plus a copy/operation, and several of them are what a
 * compiler would rather emit than `LDI k; MOV Rd, R0`.
 *
 * Scope of the analysis
 * ---------------------
 * Liveness and copy propagation are exact WITHIN a basic block and
 * conservative at block boundaries (block end = every register and flag is
 * live). That is deliberate: Deep16 control flow is largely computed -
 * `LDI label; MOV PC, R0` and register dispatch appear throughout the Forth
 * kernel - so a whole-program liveness claim would have to seed every block
 * from an unknown predecessor anyway, and would collapse to the same thing.
 * The intra-block analysis is what the local rules need, and it cannot be
 * wrong in either direction.
 *
 * Safety
 * ------
 *  - The instruction after a branch/jump always executes (delay slot). It is
 *    never deleted and no fusing window may include it, because removing that
 *    word would promote the next instruction into the slot.
 *  - `LDI`/`LWI` always write R0. Any rule that drops one has to prove R0 is
 *    dead afterwards, or that R0 is the rule's own destination.
 *  - Every fusion that replaces a shift or an ALU op with a flag-free MOV is
 *    guarded by flag liveness (N, Z, V and C tracked separately).
 *  - Opaque instructions (PSW/segment/shadow/system) are read-everything
 *    barriers: they block deletion and copy propagation, never participate in
 *    a fusion.
 */
class Deep16Optimizer {
    constructor() {
        this.regAliases = {};   // .equ NAME, Rx  ->  NAME is a register alias
        this.stats = null;
    }

    // ------------------------------------------------------------- public API

    // optimize(source, options) -> { source, stats, changed }
    //
    // Options: copyProp, deadCode, fusions, maxSweeps all default on/8.
    // `fuseAllowed` and `deadAllowed` narrow the work to specific rule names
    // or mnemonics; they exist for tests and for bisecting a miscompile.
    optimize(source, options = {}) {
        const opts = {
            copyProp: true, deadCode: true, fusions: true, maxSweeps: 8,
            ...options,
        };

        this.regAliases = {};
        this.stats = {
            byRule: {}, fusions: 0, copies: 0, dead: 0, identities: 0,
            wordsRemoved: 0, wordsRewritten: 0, blocks: 0, sweeps: 0,
        };

        const records = this.parse(source);
        this.collectAliases(records);
        this.markDelaySlots(records);

        const blocks = this.buildBlocks(records);
        for (const block of blocks) {
            this.stats.blocks++;
            this.optimizeBlock(block.insns, opts);
        }

        // Which words were dropped, by original line, so a caller can point at
        // them (or measure the dynamic saving) without diffing text.
        this.stats.removed = records
            .filter(r => r.kind === 'insn' && r.deleted)
            .map(r => ({ line: r.line, text: r.raw.split(';')[0].trim() }));

        const out = records.map(r => this.emit(r)).filter(t => t !== null).join('\n');
        return { source: out, stats: this.stats, changed: out !== source };
    }

    fire(rule) {
        this.stats.byRule[rule] = (this.stats.byRule[rule] || 0) + 1;
        this.stats.fusions++;
        this.stats.wordsRemoved++;
    }

    // ------------------------------------------------------------------ parse

    // Split a line into indent / code / trailing comment without touching the
    // comment's exact text, so untouched lines re-emit byte for byte.
    parseLine(raw) {
        let inStr = false, semi = -1;
        for (let i = 0; i < raw.length; i++) {
            const c = raw[i];
            if (c === '"' && raw[i - 1] !== '\\') inStr = !inStr;
            else if (c === ';' && !inStr) { semi = i; break; }
        }
        const code = semi >= 0 ? raw.slice(0, semi) : raw;
        const commentSuffix = semi >= 0 ? raw.slice(semi) : '';
        const indent = (code.match(/^\s*/) || [''])[0];
        const gap = code.slice(code.replace(/\s+$/, '').length);
        return { code, commentSuffix, gap, indent };
    }

    parse(source) {
        const records = [];
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const { code, commentSuffix, gap, indent } = this.parseLine(raw);
            const trimmed = code.trim();

            if (!trimmed) {
                records.push({ kind: trimmed ? 'comment' : 'blank', raw, indent, commentSuffix, gap, line: i + 1 });
                continue;
            }

            // A leading `name:` label, optionally followed by an instruction.
            const lm = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
            let label = null, body = trimmed;
            if (lm) { label = lm[1]; body = lm[2].trim(); }

            if (!body) {
                records.push({ kind: 'label', name: label, raw, indent, commentSuffix, gap, line: i + 1 });
                continue;
            }
            if (body.startsWith('.')) {
                records.push({ kind: 'directive', label, text: body, raw, indent, commentSuffix, gap, line: i + 1 });
                continue;
            }

            // Instruction: split on commas exactly like the assembler does
            // (chunks[0] carries the mnemonic and usually the first operand).
            const chunks = body.split(',').map(c => c.trim()).filter(Boolean);
            const firstWords = chunks[0].split(/\s+/).filter(Boolean);
            const mn = firstWords[0].toUpperCase();
            const ops = [];
            if (firstWords.length > 1) ops.push(firstWords.slice(1).join(' '));
            for (let k = 1; k < chunks.length; k++) ops.push(chunks[k]);

            records.push({
                kind: 'insn', mn, ops, label, raw, indent, commentSuffix, gap,
                line: i + 1, dirty: false, deleted: false, isDelay: false,
            });
        }
        return records;
    }

    collectAliases(records) {
        for (const rec of records) {
            if (rec.kind !== 'directive') continue;
            const m = rec.raw.split(';')[0].trim().match(/^\.equ\s+([^\s,]+)[\s,]+(\S[\s\S]*)$/i);
            if (!m) continue;
            const name = m[1].toUpperCase();
            const value = m[2].trim().split(/\s+/)[0].toUpperCase().replace(/^RO$/, 'R0');
            const canon = this.regNameFromTables(value);
            if (canon) this.regAliases[name] = canon;
        }
    }

    // ------------------------------------------------------------- registers

    regNameFromTables(upper) {
        const base = {
            R0: 0, R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6, R7: 7,
            R8: 8, R9: 9, R10: 10, R11: 11, R12: 12, R13: 13, R14: 14, R15: 15,
            FP: 12, SP: 13, LR: 14, PC: 15,
        };
        if (upper in base) return 'R' + base[upper];
        if (this.regAliases[upper]) return this.regAliases[upper];
        return null;
    }

    // Canonical 'Rn' for a register token, or null (segment/special/expression).
    regName(tok) {
        if (typeof tok !== 'string') return null;
        let t = tok.trim().toUpperCase();
        if (t === 'RO') t = 'R0';
        return this.regNameFromTables(t);
    }

    // ---------------------------------------------------------------- effects

    // Unknown effect: reads everything, so it blocks deletion and copy
    // propagation and never takes part in a fusion.
    barrier(e) {
        for (let i = 0; i < 16; i++) e.uses.add('R' + i);
        e.flagUse = new Set(['N', 'Z', 'V', 'C']);
        e.barrier = true;
        e.opaque = true;
        e.deletable = false;
        return e;
    }

    // Known instruction with a side effect this analysis does not model (a
    // PSW/segment/shadow write, an interrupt enable): it cannot be deleted or
    // crossed, but it does not read any register.
    sideEffect(e, flagDef) {
        e.opaque = true;
        e.deletable = false;
        if (flagDef) for (const f of flagDef) e.flagDef.add(f);
        return e;
    }

    newEffect() {
        return {
            defs: new Set(), uses: new Set(),
            flagDef: new Set(), flagUse: new Set(),
            control: 'none', deletable: false,
            barrier: false, opaque: false, memory: false,
        };
    }

    effects(rec) {
        const e = this.newEffect();
        if (rec.kind !== 'insn' || rec.deleted) return e;
        const mn = rec.mn, ops = rec.ops;

        switch (mn) {
            case 'NOP':
                return e;

            case 'LDI':
            case 'LWI':
                e.defs.add('R0');
                e.deletable = true;
                return e;

            case 'LSI': {
                const rd = this.regName(ops[0]);
                if (rd) { e.defs.add(rd); e.deletable = true; }
                return e;
            }

            case 'MOV':
                return this.effectsMOV(rec, e);

            case 'ADD': case 'SUB': case 'AND': case 'OR': case 'XOR':
            case 'MUL': case 'DIV':
                return this.effectsALU(rec, e, true);

            // MUL32 writes the pair Rd:Rd+1 and reads only Rd; DIV32 reads the
            // pair as well, because Rd:Rd+1 is the dividend it divides. Leaving
            // the low half out of the use set makes the store that sets the
            // dividend up look dead, and it is dropped: the quotient is then
            // computed from whatever the register happened to hold.
            case 'MUL32':
                return this.effectsALU(rec, e, true, true);

            case 'DIV32': {
                const e2 = this.effectsALU(rec, e, true, true);
                const rd = this.regName(ops[0]);
                if (rd && rd !== 'R15') e2.uses.add('R' + (parseInt(rd.slice(1), 10) + 1));
                return e2;
            }

            // Test-only operations: no register result, flags only.
            case 'CMP': case 'TBC': case 'TBS': {
                const rd = this.regName(ops[0]); if (rd) e.uses.add(rd);
                const rs = this.regName(ops[1] || ''); if (rs) e.uses.add(rs);
                e.flagDef = new Set(['N', 'Z', 'V', 'C']);
                e.deletable = true;
                return e;
            }

            case 'CLRB': {
                const rd = this.regName(ops[0]);
                if (rd) { e.defs.add(rd); e.uses.add(rd); }
                e.flagDef = new Set(['N', 'Z', 'V', 'C']);
                e.deletable = true;
                return e;
            }

            case 'SL': case 'SLA': case 'SLAC':
            case 'SR': case 'SRC': case 'SRA': case 'SRAC':
            case 'ROL': case 'ROR':
            case 'SWB': {
                const rd = this.regName(ops[0]);
                if (rd) { e.defs.add(rd); e.uses.add(rd); }
                e.flagDef = new Set(['C']);
                e.deletable = true;
                return e;
            }
            case 'RLC': case 'RRC': {
                const rd = this.regName(ops[0]);
                if (rd) { e.defs.add(rd); e.uses.add(rd); }
                e.flagUse = new Set(['C']);
                e.flagDef = new Set(['C']);
                e.deletable = true;
                return e;
            }

            // Kept conservative: their flag behaviour is not pinned down in the
            // one-line tables this optimizer trusts, so they are barriers.
            case 'INV': case 'NEG':
                return this.barrier(e);

            case 'LD': {
                const rd = this.regName(ops[0]);
                const rb = this.memBase(ops);
                if (rd) e.defs.add(rd);
                if (rb) e.uses.add(rb);
                e.memory = true;
                return e;
            }
            case 'ST': {
                const rd = this.regName(ops[0]);
                const rb = this.memBase(ops);
                if (rd) e.uses.add(rd);
                if (rb) e.uses.add(rb);
                e.memory = true;
                return e;
            }
            case 'LDS': case 'STS': {
                const rd = this.regName(ops[0]);
                const rb = this.regName(ops[2] || '');
                if (rd) (mn === 'LDS' ? e.defs.add(rd) : e.uses.add(rd));
                if (rb) e.uses.add(rb);
                e.memory = true;
                return e;
            }

            case 'LNK': case 'ALNK': {
                const rd = this.regName(ops[0]);
                if (rd) { e.defs.add(rd); e.deletable = true; }
                return e;
            }
            case 'LINK': case 'ALINK':
                e.defs.add('R14');
                e.deletable = true;
                return e;

            case 'JZ': case 'JNZ':
                e.control = 'branch'; e.flagUse = new Set(['Z']); return e;
            case 'JC': case 'JNC':
                e.control = 'branch'; e.flagUse = new Set(['C']); return e;
            case 'JN': case 'JNN':
                e.control = 'branch'; e.flagUse = new Set(['N']); return e;
            case 'JO': case 'JNO':
                e.control = 'branch'; e.flagUse = new Set(['V']); return e;

            case 'JMP': {
                const r = this.regName(ops[0]);
                if (r) { e.control = 'indirect'; e.uses.add(r); e.flagUse = new Set(); }
                else e.control = 'jump';
                return e;
            }
            case 'JML': {
                const r = this.regName(ops[0]);
                e.control = 'indirect';
                if (r) e.uses.add(r);
                return e;
            }
            case 'RETI':
                e.control = 'indirect';
                return e;

            case 'HLT': case 'HALT':
                e.control = 'halt';
                return e;
            case 'SWI': case 'FSH':
                return this.barrier(e);

            // Interrupt mask only; it reads no register and does not touch
            // N/Z/V/C, but it is a side effect we must keep.
            case 'SETI': case 'CLRI':
                return this.sideEffect(e);

            // PSW bit operations and their flag aliases. Only the alias for a
            // real flag kills that flag; anything else is left opaque. The bit
            // index in SET/CLR is a PSW bit number, 0..3 being N/Z/V/C.
            case 'SETN': case 'CLRN': return this.sideEffect(e, ['N']);
            case 'SETZ': case 'CLRZ': return this.sideEffect(e, ['Z']);
            case 'SETV': case 'CLRV': return this.sideEffect(e, ['V']);
            case 'SETC': case 'CLRC': return this.sideEffect(e, ['C']);
            case 'SET': case 'CLR': {
                const bit = this.literal(rec.ops[0]);
                const flag = (bit !== null && bit >= 0 && bit <= 3)
                    ? ['N', 'Z', 'V', 'C'][bit] : null;
                return this.sideEffect(e, flag ? [flag] : null);
            }

            case 'SET2': case 'CLR2': case 'SETS': case 'CLRS':
                return this.sideEffect(e);

            // Stack/extra bank select writes: they read the register that
            // names the bank.
            case 'SRS': case 'SRD': case 'ERS': case 'ERD': {
                const rx = this.regName(rec.ops[0]);
                if (rx) e.uses.add(rx);
                return this.sideEffect(e);
            }

            // MVS Rd, Sx reads a segment into Rd; MVS Sx, Rd writes Rd into a
            // segment. Only the second spelling reads a GPR.
            case 'MVS': {
                const first = this.regName(rec.ops[0]);
                if (first) e.defs.add(first);
                else {
                    const rs = this.regName(rec.ops[1]);
                    if (rs) e.uses.add(rs);
                }
                return this.sideEffect(e);
            }

            // SMV Rx, <shadow> reads a shadow register into Rx.
            // SMV ARy, Rx writes the *inactive* bank's R[y] from the active Rx,
            // so the first operand is not a GPR and the second is a use.
            case 'SMV': {
                const dest = this.regName(rec.ops[0]);
                if (dest) e.defs.add(dest);
                else {
                    const rs = this.regName(rec.ops[1]);
                    if (rs) e.uses.add(rs);
                }
                return this.sideEffect(e);
            }

            // LPSW Rx loads the PSW into Rx; SPSW Rx stores Rx into the PSW.
            case 'LPSW': {
                const rx = this.regName(rec.ops[0]);
                if (rx) e.defs.add(rx);
                return this.sideEffect(e);
            }
            case 'SPSW': {
                const rx = this.regName(rec.ops[0]);
                if (rx) e.uses.add(rx);
                return this.sideEffect(e);
            }

            default:
                // Anything not in the tables above.
                return this.barrier(e);
        }
    }

    // MOV reads its source and writes its destination; several spellings land
    // on the same effect. A destination of PC is an indirect transfer.
    effectsMOV(rec, e) {
        const ops = rec.ops;
        const rd = this.regName(ops[0]);
        if (rd === null) return this.barrier(e);      // MOV Sx/PSW, ... or MOV Rd, Sx/PSW
        const rs = this.regName(ops[1] || '');
        const shiftSrc = this.movSourceReg(ops[1] || '');
        const src = rs || shiftSrc;
        if (src === null) return this.barrier(e);      // source is a segment/special register

        e.uses.add(src);
        if (rd === 'R15') {
            e.control = 'indirect';
            e.deletable = false;
            return e;
        }
        e.defs.add(rd);
        e.deletable = true;
        return e;
    }

    effectsALU(rec, e, setsFlags, pair) {
        const rd = this.regName(rec.ops[0]);
        const rs = this.regName(rec.ops[1] || '');
        if (rd) { e.defs.add(rd); e.uses.add(rd); }
        if (rs) e.uses.add(rs);
        if (pair && rd && rd !== 'R15') e.defs.add('R' + (parseInt(rd.slice(1), 10) + 1));
        if (setsFlags) e.flagDef = new Set(['N', 'Z', 'V', 'C']);
        e.deletable = true;
        return e;
    }

    // The base register of LD/ST, in either the bracket or the comma spelling.
    memBase(ops) {
        const second = ops[1] || '';
        const bm = second.match(/^\[\s*([^\]]+?)\s*\]$/);
        const inner = bm ? bm[1] : second;
        const lead = inner.trim().match(/^([A-Za-z][A-Za-z0-9]*)/);
        return lead ? this.regName(lead[1]) : null;
    }

    // ------------------------------------------------------------- dataflow

    regDeadAfter(list, i, reg) {
        for (let j = i + 1; j < list.length; j++) {
            const rec = list[j];
            if (rec.deleted) continue;
            const e = this.effects(rec);
            // A transfer may read the value at its target, which is outside
            // this block. Until the value is redefined, treat it as live.
            if (e.control !== 'none') return false;
            if (e.uses.has(reg)) return false;
            if (e.defs.has(reg)) return true;
        }
        return false;   // reach the block end: conservative, treat as live
    }

    flagsDeadAfter(list, i, flags) {
        const need = new Set(flags);
        for (let j = i + 1; j < list.length; j++) {
            const rec = list[j];
            if (rec.deleted) continue;
            const e = this.effects(rec);
            // Same reason as regDeadAfter: a branch target may read the flags.
            if (e.control !== 'none') return false;
            if (e.flagUse) for (const f of e.flagUse) if (need.has(f)) return false;
            if (e.flagDef) for (const f of e.flagDef) need.delete(f);
            if (need.size === 0) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- blocks

    buildBlocks(records) {
        const blocks = [];
        let cur = null;
        const flush = () => { if (cur && cur.insns.length) blocks.push(cur); cur = null; };
        for (const rec of records) {
            if (rec.kind === 'insn') {
                if (rec.label) flush();          // a label is a block entry
                if (!cur) cur = { insns: [] };
                cur.insns.push(rec);
            } else if (rec.kind === 'label' || rec.kind === 'directive') {
                flush();
            }
            // blank/comment lines are transparent: they do not break a block
        }
        flush();
        return blocks;
    }

    markDelaySlots(records) {
        let pending = false;
        for (const rec of records) {
            if (rec.kind === 'insn') {
                rec.isDelay = pending;
                pending = false;
                const c = this.effects(rec).control;
                if (c === 'branch' || c === 'jump' || c === 'indirect') pending = true;
            } else if (rec.kind === 'directive') {
                pending = false;
            }
        }
    }

    // ------------------------------------------------------------ block pass

    optimizeBlock(insns, opts) {
        let sweeps = 0, changed = true;
        while (changed && sweeps < opts.maxSweeps) {
            sweeps++;
            changed = false;
            const live = () => insns.filter(r => !r.deleted);
            if (opts.copyProp) changed = this.copyPropBlock(live(), opts) || changed;
            if (opts.fusions) changed = this.fuseBlock(live(), opts) || changed;
            if (opts.deadCode) changed = this.deadBlock(live(), opts) || changed;
        }
        this.stats.sweeps += sweeps;
    }

    // ---- copy propagation (intra-block available copies)

    copyPropBlock(list, opts) {
        const map = new Map();
        let changed = false;
        for (const rec of list) {
            if (rec.deleted) continue;
            const e = this.effects(rec);
            if (e.barrier || e.opaque || e.control !== 'none') { map.clear(); continue; }

            if (this.substituteUses(rec, map)) changed = true;

            for (const d of e.defs) {
                map.delete(d);
                for (const [k, v] of map) if (v === d) map.delete(k);
            }
            if (rec.mn === 'MOV') {
                const mv = this.movForm(rec);
                // PC is not a stable value: a later read of PC would differ
                // from the captured one, so it never becomes a copy.
                if (mv && mv.imm === 0 && mv.rd !== 'R15' && mv.rs !== 'R15') {
                    map.set(mv.rd, mv.rs);
                    this.stats.copies++;
                }
            }
        }
        return changed;
    }

    // Which operands may carry a copy substitution. A register used as an
    // address base must NOT: the LD/ST segment is chosen by the base register
    // NUMBER (isStackRegister / isExtraRegister in the core, and PSW.SR/ER at
    // run time), so two registers holding equal values are not interchangeable
    // as a base. Only value operands are substituted.
    substituteUses(rec, map) {
        if (map.size === 0) return false;
        let idxs;
        switch (rec.mn) {
            case 'MOV': idxs = [1]; break;
            case 'ADD': case 'SUB': case 'AND': case 'OR': case 'XOR':
            case 'MUL': case 'DIV': case 'MUL32': case 'DIV32':
                idxs = [1]; break;
            case 'CMP': case 'TBC': case 'TBS':
                idxs = [0, 1]; break;
            case 'ST': idxs = [0]; break;      // the stored value, not the base
            case 'STS': idxs = [0]; break;
            default: idxs = [];
        }
        let changed = false;
        for (const k of idxs) {
            if (k >= rec.ops.length) continue;
            const next = this.substOperand(rec.ops[k], map);
            if (next !== rec.ops[k]) { rec.ops[k] = next; rec.dirty = true; changed = true; }
        }
        return changed;
    }

    substOperand(op, map) {
        const whole = this.regName(op);
        if (whole && map.has(whole)) return map.get(whole);
        const bm = op.match(/^(\s*)\[\s*([^\]]+?)\s*\](\s*)$/);
        if (bm) {
            const inner = this.substLeadingReg(bm[2], map);
            return bm[1] + '[' + inner + ']' + bm[3];
        }
        return this.substLeadingReg(op, map);
    }

    substLeadingReg(s, map) {
        const m = s.match(/^(\s*)([A-Za-z][A-Za-z0-9]*)([\s\S]*)$/);
        if (!m) return s;
        const canon = this.regName(m[2]);
        if (canon && map.has(canon)) return m[1] + map.get(canon) + m[3];
        return s;
    }

    // ---- peephole fusions

    fuseBlock(list, opts) {
        const rules = ['A6', 'A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5', 'C2'];
        const allowed = opts.fuseAllowed ? rules.filter(r => opts.fuseAllowed.includes(r)) : rules;
        let changed = false;
        // Rebuild the live list after every hit: matches are rare relative to
        // block size, and this keeps index bookkeeping trivial.
        for (let guard = 0; guard <= list.length; guard++) {
            const live = list.filter(r => !r.deleted);
            let applied = false;
            for (let i = 0; i < live.length && !applied; i++) {
                for (const rn of allowed) {
                    if (this['rule' + rn](live, i)) { applied = true; changed = true; break; }
                }
            }
            if (!applied) break;
        }
        return changed;
    }

    // No fusing window may cross a control instruction or contain a delay slot.
    windowOk(list, i, n) {
        for (let k = i; k < i + n; k++) {
            if (!list[k] || list[k].deleted) return false;
            if (list[k].isDelay) return false;
            const e = this.effects(list[k]);
            if (e.control !== 'none' || e.opaque) return false;
        }
        return true;
    }

    // MOV Rd, Rs[., imm] -> { rd, rs, imm } when it is a plain GPR move.
    movForm(rec) {
        if (!rec || rec.mn !== 'MOV') return null;
        const rd = this.regName(rec.ops[0]);
        if (!rd) return null;
        const t = (rec.ops[1] || '').trim();
        let m;
        if ((m = t.match(/^([A-Za-z][A-Za-z0-9]*)\s*<<\s*1\s*\+\s*1$/))) {
            const rs = this.regName(m[1]); return rs ? { rd, rs, imm: 3 } : null;
        }
        if ((m = t.match(/^([A-Za-z][A-Za-z0-9]*)\s*<<\s*1$/))) {
            const rs = this.regName(m[1]); return rs ? { rd, rs, imm: 1 } : null;
        }
        if ((m = t.match(/^([A-Za-z][A-Za-z0-9]*)\s*\+\s*2$/))) {
            const rs = this.regName(m[1]); return rs ? { rd, rs, imm: 2 } : null;
        }
        const rs = this.regName(t);
        if (rs) {
            let imm = 0;
            if (rec.ops.length >= 3) {
                const v = this.literal(rec.ops[2]);
                if (v === 0) imm = 0;
                else if (v === 2) imm = 2;
                else return null;
            }
            return { rd, rs, imm };
        }
        return null;
    }

    movSourceReg(tok) {
        const t = tok.trim();
        let m;
        if ((m = t.match(/^([A-Za-z][A-Za-z0-9]*)\s*<<\s*1\s*\+\s*1$/))) return this.regName(m[1]);
        if ((m = t.match(/^([A-Za-z][A-Za-z0-9]*)\s*<<\s*1$/))) return this.regName(m[1]);
        if ((m = t.match(/^([A-Za-z][A-Za-z0-9]*)\s*\+\s*2$/))) return this.regName(m[1]);
        return null;
    }

    literal(tok) {
        if (typeof tok !== 'string') return null;
        const t = tok.trim();
        if (/^-?0[xX][0-9a-fA-F]+$/.test(t)) {
            const neg = t.startsWith('-');
            const v = parseInt(t.replace('-', ''), 16);
            return neg ? -v : v;
        }
        if (/^-?\d+$/.test(t)) return parseInt(t, 10);
        return null;
    }

    setMOV(rec, rd, source) {
        rec.mn = 'MOV';
        rec.ops = [rd, source];
        rec.dirty = true;
    }

    ruleA1(list, i) {   // MOV Rd,Rs ; SL Rd,1 -> MOV Rd, Rs << 1
        if (!this.windowOk(list, i, 2)) return false;
        const a = list[i], b = list[i + 1];
        const mv = this.movForm(a);
        if (!mv || mv.imm !== 0 || a.ops.length !== 2) return false;
        if (b.mn !== 'SL' || b.ops.length < 2 || this.literal(b.ops[1]) !== 1) return false;
        if (this.regName(b.ops[0]) !== mv.rd) return false;
        if (!this.flagsDeadAfter(list, i + 1, ['C'])) return false;
        this.setMOV(a, mv.rd, mv.rs + ' << 1');
        b.deleted = true;
        this.fire('A1');
        return true;
    }

    ruleA2(list, i) {   // SL Rs,1 ; MOV Rd,Rs -> MOV Rd, Rs << 1 (or drop the copy)
        if (!this.windowOk(list, i, 2)) return false;
        const a = list[i], b = list[i + 1];
        if (a.mn !== 'SL' || a.ops.length < 2 || this.literal(a.ops[1]) !== 1) return false;
        const rs = this.regName(a.ops[0]);
        const mv = this.movForm(b);
        if (!mv || mv.imm !== 0 || mv.rs !== rs || b.ops.length !== 2) return false;
        if (mv.rd === rs) {                 // identity copy: SL already did the work
            b.deleted = true;
            this.stats.identities++;
            this.stats.wordsRemoved++;
            return true;
        }
        if (!this.flagsDeadAfter(list, i + 1, ['C'])) return false;
        this.setMOV(a, mv.rd, rs + ' << 1');
        b.deleted = true;
        this.fire('A2');
        return true;
    }

    ruleA3(list, i) {   // MOV Rd,Rs ; ADD Rd,2 -> MOV Rd, Rs + 2
        if (!this.windowOk(list, i, 2)) return false;
        const a = list[i], b = list[i + 1];
        const mv = this.movForm(a);
        if (!mv || mv.imm !== 0 || a.ops.length !== 2) return false;
        if (b.mn !== 'ADD' || this.regName(b.ops[0]) !== mv.rd) return false;
        if (this.literal(b.ops[1]) !== 2) return false;
        if (!this.flagsDeadAfter(list, i + 1, ['N', 'Z', 'V', 'C'])) return false;
        this.setMOV(a, mv.rd, mv.rs + ' + 2');
        b.deleted = true;
        this.fire('A3');
        return true;
    }

    ruleA4(list, i) {   // MOV Rd,Rs ; ADD Rd,Rs -> MOV Rd, Rs << 1
        if (!this.windowOk(list, i, 2)) return false;
        const a = list[i], b = list[i + 1];
        const mv = this.movForm(a);
        if (!mv || mv.imm !== 0 || a.ops.length !== 2) return false;
        if (b.mn !== 'ADD' || this.regName(b.ops[0]) !== mv.rd) return false;
        if (this.regName(b.ops[1]) !== mv.rs) return false;
        if (!this.flagsDeadAfter(list, i + 1, ['N', 'Z', 'V', 'C'])) return false;
        this.setMOV(a, mv.rd, mv.rs + ' << 1');
        b.deleted = true;
        this.fire('A4');
        return true;
    }

    ruleA5(list, i) {   // MOV Rd,Rs<<1 ; OR Rd,0 / ADD Rd,1 -> MOV Rd, Rs<<1 + 1
        if (!this.windowOk(list, i, 2)) return false;
        const a = list[i], b = list[i + 1];
        const mv = this.movForm(a);
        if (!mv || mv.imm !== 1) return false;
        const rd = this.regName(b.ops[0]);
        if (rd !== mv.rd) return false;
        const v = this.literal(b.ops[1]);
        const ok = (b.mn === 'OR' && v === 0) || (b.mn === 'ADD' && v === 1);
        if (!ok) return false;
        if (!this.flagsDeadAfter(list, i + 1, ['N', 'Z', 'V', 'C'])) return false;
        this.setMOV(a, mv.rd, mv.rs + ' << 1 + 1');
        b.deleted = true;
        this.fire('A5');
        return true;
    }

    ruleA6(list, i) {   // LDI k ; MOV Rd,R0 ; SL Rd,1 -> LDI k ; MOV Rd, R0 << 1
        if (!this.windowOk(list, i, 3)) return false;
        const a = list[i], b = list[i + 1], c = list[i + 2];
        if (a.mn !== 'LDI' || this.literal(a.ops[0]) === null) return false;
        const mv = this.movForm(b);
        if (!mv || mv.imm !== 0 || mv.rs !== 'R0' || b.ops.length !== 2) return false;
        if (c.mn !== 'SL' || this.literal(c.ops[1]) !== 1) return false;
        if (this.regName(c.ops[0]) !== mv.rd) return false;
        if (!this.flagsDeadAfter(list, i + 2, ['C'])) return false;
        this.setMOV(b, mv.rd, 'R0 << 1');
        c.deleted = true;
        this.fire('A6');
        return true;
    }

    // LDI/LWI's loaded value: the immediate is a 15-bit pattern sign-extended
    // from bit 14 (spec 3.4), so `LDI 0x4000` holds 0xC000.
    ldiLoaded(tok) {
        const v = this.literal(tok);
        if (v === null) return null;
        const f = v & 0x7FFF;
        return (f & 0x4000) ? (f | 0x8000) : f;
    }

    ruleB1(list, i) {   // LDI k ; MOV Rd,R0 -> LSI Rd, k   (k in -16..15)
        if (!this.windowOk(list, i, 2)) return false;
        const a = list[i], b = list[i + 1];
        if (a.mn !== 'LDI' && a.mn !== 'LWI') return false;
        const k = this.literal(a.ops[0]);
        if (k === null || k < -16 || k > 15) return false;
        const mv = this.movForm(b);
        if (!mv || mv.imm !== 0 || mv.rs !== 'R0' || b.ops.length !== 2) return false;
        if (mv.rd !== 'R0' && !this.regDeadAfter(list, i + 1, 'R0')) return false;
        a.mn = 'LSI';
        a.ops = [mv.rd, a.ops[0].trim()];
        a.dirty = true;
        b.deleted = true;
        this.fire('B1');
        return true;
    }

    // Shared guard for the ALU folds: the second operand still has to be R0 at
    // the operation, which it is only if the destination is not R0 itself, and
    // R0 must be dead afterwards. Returns true when the fold is safe.
    reduceWithR0(list, i, rd, rs) {
        if (rs !== 'R0') return false;
        if (rd === 'R0') return false;
        return this.regDeadAfter(list, i + 1, 'R0');
    }

    ruleB2(list, i) {   // LDI k ; CMP Rd,R0 -> CMP Rd, k   (k in 0..15)
        if (!this.windowOk(list, i, 2)) return false;
        const a = list[i], b = list[i + 1];
        if (a.mn !== 'LDI' && a.mn !== 'LWI') return false;
        const k = this.literal(a.ops[0]);
        if (k === null || k < 0 || k > 15) return false;
        if (b.mn !== 'CMP') return false;
        const rd = this.regName(b.ops[0]);
        if (!this.reduceWithR0(list, i, rd, this.regName(b.ops[1]))) return false;
        b.ops = [rd, a.ops[0].trim()];
        b.dirty = true;
        a.deleted = true;
        this.fire('B2');
        return true;
    }

    ruleB3(list, i) {   // LDI k ; ADD/SUB Rd,R0 -> ADD/SUB Rd, k
        if (!this.windowOk(list, i, 2)) return false;
        const a = list[i], b = list[i + 1];
        if (a.mn !== 'LDI' && a.mn !== 'LWI') return false;
        const k = this.literal(a.ops[0]);
        if (k === null || k < 0 || k > 15) return false;
        if (b.mn !== 'ADD' && b.mn !== 'SUB') return false;
        const rd = this.regName(b.ops[0]);
        if (!this.reduceWithR0(list, i, rd, this.regName(b.ops[1]))) return false;
        b.ops = [rd, a.ops[0].trim()];
        b.dirty = true;
        a.deleted = true;
        this.fire('B3');
        return true;
    }

    ruleB4(list, i) {   // LDI 1<<b ; OR/XOR/TBC/TBS Rd,R0 -> ... Rd, b
        if (!this.windowOk(list, i, 2)) return false;
        const a = list[i], b = list[i + 1];
        if (a.mn !== 'LDI' && a.mn !== 'LWI') return false;
        const loaded = this.ldiLoaded(a.ops[0]);
        if (loaded === null) return false;
        if (!['OR', 'XOR', 'TBC', 'TBS'].includes(b.mn)) return false;
        const bit = this.singleBitIndex(loaded);
        if (bit === null || bit > 15) return false;
        const rd = this.regName(b.ops[0]);
        if (!this.reduceWithR0(list, i, rd, this.regName(b.ops[1]))) return false;
        b.ops = [rd, String(bit)];
        b.dirty = true;
        a.deleted = true;
        this.fire('B4');
        return true;
    }

    ruleB5(list, i) {   // LDI ~(1<<b) ; AND Rd,R0 -> CLRB Rd, b
        if (!this.windowOk(list, i, 2)) return false;
        const a = list[i], b = list[i + 1];
        if (a.mn !== 'LDI' && a.mn !== 'LWI') return false;
        const loaded = this.ldiLoaded(a.ops[0]);
        if (loaded === null) return false;
        if (b.mn !== 'AND') return false;
        const inv = (~loaded) & 0xFFFF;
        const bit = this.singleBitIndex(inv);
        if (bit === null || bit > 15) return false;
        const rd = this.regName(b.ops[0]);
        if (!this.reduceWithR0(list, i, rd, this.regName(b.ops[1]))) return false;
        b.mn = 'CLRB';
        b.ops = [rd, String(bit)];
        b.dirty = true;
        a.deleted = true;
        this.fire('B5');
        return true;
    }

    singleBitIndex(v) {
        if (v <= 0) return null;
        if ((v & (v - 1)) !== 0) return null;
        return Math.log2(v);
    }

    ruleC2(list, i) {   // MOV Rd,Rd -> nothing
        if (!this.windowOk(list, i, 1)) return false;
        const a = list[i];
        const mv = this.movForm(a);
        if (!mv || mv.imm !== 0 || mv.rd !== mv.rs || mv.rd === 'R15') return false;
        if (a.ops.length !== 2) return false;
        a.deleted = true;
        this.stats.identities++;
        this.stats.wordsRemoved++;
        return true;
    }

    // ---- dead code

    deadBlock(list, opts) {
        let changed = false;
        const allow = opts.deadAllowed;
        for (let i = 0; i < list.length; i++) {
            const rec = list[i];
            if (rec.deleted || rec.isDelay) continue;
            if (allow && !allow.includes(rec.mn)) continue;
            const e = this.effects(rec);
            if (e.barrier || e.opaque || e.control !== 'none' || !e.deletable) continue;

            let ok = true;
            for (const d of e.defs) {
                if (d === 'R15') { ok = false; break; }
                if (!this.regDeadAfter(list, i, d)) { ok = false; break; }
            }
            if (ok) {
                for (const f of e.flagDef) {
                    if (!this.flagsDeadAfter(list, i, [f])) { ok = false; break; }
                }
            }
            if (ok) {
                rec.deleted = true;
                this.stats.dead++;
                this.stats.wordsRemoved++;
                changed = true;
            }
        }
        return changed;
    }

    // ------------------------------------------------------------------ emit

    emit(rec) {
        if (rec.kind !== 'insn') return rec.raw;
        if (rec.deleted) return rec.label ? rec.indent + rec.label + ':' : null;
        if (!rec.dirty) return rec.raw;
        const body = (rec.label ? rec.label + ': ' : '')
            + rec.mn + (rec.ops.length ? ' ' + rec.ops.join(', ') : '');
        const comment = rec.commentSuffix ? (rec.gap || '') + rec.commentSuffix : '';
        return rec.indent + body + comment;
    }
}
