/* deep16_assembler.js */
class Deep16Assembler {
    constructor() {
        this.labels = {};
        this.symbols = {};
        this.unresolvedRefs = [];
        this.aliases = {};
    }

    assemble(source, options = {}) {
        this.labels = {};
        this.symbols = {};
        this.unresolvedRefs = [];
        this.aliases = {};
        const errors = [];
        const memoryChanges = [];
        const assemblyListing = [];
        const segmentMap = new Map();
        let currentSegment = 'code';
        let address = 0;

        if (window.Deep16Debug) console.log('=== ASSEMBLER FIRST PASS ===');
        // Conditional assembly is resolved first: inactive branches become empty
        // lines, so both passes below (and their line numbers) see the source
        // the caller actually asked for.
        const lines = this.applyConditionals(source.split('\n'), options.defines, errors);
        
        // First pass: collect ALL labels and calculate addresses
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith(';')) continue;

            try {
                if (line.startsWith('.org')) {
                    const orgValue = this.parseImmediate(line.split(/\s+/)[1], true); // First pass only
                    address = orgValue;
                } else if (line.startsWith('.code')) {
                    currentSegment = 'code';
                } else if (line.startsWith('.data')) {
                    currentSegment = 'data';
                } else if (line.split(';')[0].trim().endsWith(':')) {
                    const label = line.split(';')[0].trim().slice(0, -1).trim();
                    this.labels[label] = address;
                    this.symbols[label] = address;
                    segmentMap.set(address, currentSegment);
                    if (window.Deep16Debug) console.log(`LABEL: ${label} at 0x${address.toString(16)}`);
                } else if (line.startsWith('.word')) {
                    const cleanLine = line.split(';')[0].trim();
                    const tokens = cleanLine.substring(5).trim().split(',').map(v => v.trim()).filter(v => v);
                    for (const tok of tokens) {
                        const m = tok.match(/^(.+)\*(\d+)$/);
                        const count = m ? parseInt(m[2], 10) : 1;
                        const reps = Math.max(0, count);
                        for (let r = 0; r < reps; r++) {
                            segmentMap.set(address, 'data');
                            address++;
                        }
                    }
                } else if (line.startsWith('.text')) {
                    const cleanLine = line.split(';')[0].trim();
                    const textContent = cleanLine.substring(5).trim();
                    const stringValue = this.parseStringLiteral(textContent);
                    for (let j = 0; j < stringValue.length; j++) {
                        segmentMap.set(address, 'data');
                        address++;
                    }
                    // Add null terminator
                    segmentMap.set(address, 'data');
                    address++;
                } else if (line.startsWith('.string')) {
                    const cleanLine = line.split(';')[0].trim();
                    const textContent = cleanLine.substring(7).trim();
                    const stringValue = this.parseStringLiteral(textContent);
                    const words = Math.ceil(stringValue.length / 2);
                    for (let j = 0; j < words; j++) {
                        segmentMap.set(address, 'data');
                        address++;
                    }
                    segmentMap.set(address, 'data');
                    address++;
                } else if (line.startsWith('.equ')) {
                    const cleanLine = line.split(';')[0].trim();
                    const rest = cleanLine.substring(4).trim();
                    // The value is everything after the name, so that
                    // ".equ D, f0 - f1" keeps the whole expression. Splitting on
                    // every separator kept only the first token and threw the
                    // rest away in silence, leaving D bound to f0.
                    const eq = rest.match(/^([^\s,]+)[\s,]+(\S[\s\S]*)$/);
                    if (eq) {
                        const name = eq[1];
                        const value = eq[2].trim();
                        const upperVal = value.toUpperCase();
                        if (this.isRegister(upperVal)) {
                            this.aliases[name.toUpperCase()] = upperVal;
                        } else {
                            try {
                                const imm = this.parseImmediate(value, true);
                                this.symbols[name] = imm;
                            } catch {}
                        }
                    }
                } else if (!this.isDirective(line)) {
                    segmentMap.set(address, currentSegment);
                    address++;
                }
            } catch (error) {
                // Ignore most errors in first pass - they'll be caught in second pass
            }
        }

        // Second pass: resolve all instructions and data
        if (window.Deep16Debug) console.log('=== ASSEMBLER SECOND PASS ===');
        address = 0;
        currentSegment = 'code';
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const originalLine = lines[i];
            const lineLower = line.toLowerCase();
            
            if (!line || line.startsWith(';')) {
                assemblyListing.push({ line: originalLine });
                continue;
            }

            try {
                if (lineLower.startsWith('.org')) {
                    const orgValue = this.parseImmediate(line.split(/\s+/)[1], false);
                    address = orgValue;
                    assemblyListing.push({ address: address, line: originalLine, segment: currentSegment });
                } else if (lineLower.startsWith('.code')) {
                    currentSegment = 'code';
                    assemblyListing.push({ line: originalLine, segment: currentSegment });
                } else if (lineLower.startsWith('.data')) {
                    currentSegment = 'data';
                    assemblyListing.push({ line: originalLine, segment: currentSegment });
                } else if (line.split(';')[0].trim().endsWith(':')) {
                    assemblyListing.push({ address: address, line: originalLine, segment: currentSegment });
                } else if (lineLower.startsWith('.word')) {
                    const cleanLine = line.split(';')[0].trim();
                    const tokens = cleanLine.substring(5).trim().split(',').map(v => v.trim()).filter(v => v);
                    let total = 0;
                    for (const tok of tokens) {
                        const m = tok.match(/^(.+)\*(\d+)$/);
                        const valStr = m ? m[1].trim() : tok;
                        const count = m ? parseInt(m[2], 10) : 1;
                        const reps = Math.max(0, count);
                        const value = this.parseImmediate(valStr, false);
                        for (let r = 0; r < reps; r++) {
                            memoryChanges.push({ address: address, value: value & 0xFFFF, segment: 'data' });
                            assemblyListing.push({ 
                                address: address, 
                                instruction: value,
                                line: originalLine,
                                segment: 'data'
                            });
                            address++;
                            total++;
                        }
                    }
                    if (window.Deep16Debug) console.log(`DATA (pass2): ${total} words at 0x${address.toString(16)}`);
                } else if (lineLower.startsWith('.text')) {
                    const cleanLine = line.split(';')[0].trim();
                    const textContent = cleanLine.substring(5).trim();
                    const stringValue = this.parseStringLiteral(textContent);
                    if (window.Deep16Debug) console.log(`TEXT (pass2): "${stringValue}" at 0x${address.toString(16)}`);
                    for (let j = 0; j < stringValue.length; j++) {
                        const charCode = stringValue.charCodeAt(j);
                        memoryChanges.push({ address: address, value: charCode & 0xFFFF, segment: 'data' });
                        assemblyListing.push({ 
                            address: address, 
                            instruction: charCode,
                            line: originalLine,
                            segment: 'data'
                        });
                        address++;
                    }
                    // Store null terminator
                    memoryChanges.push({ address: address, value: 0, segment: 'data' });
                    assemblyListing.push({ 
                        address: address, 
                        instruction: 0,
                        line: originalLine,
                        segment: 'data'
                    });
                    address++;
                } else if (lineLower.startsWith('.string')) {
                    const cleanLine = line.split(';')[0].trim();
                    const textContent = cleanLine.substring(7).trim();
                    const stringValue = this.parseStringLiteral(textContent);
                    if (window.Deep16Debug) console.log(`STRING (pass2): "${stringValue}" at 0x${address.toString(16)}`);
                    for (let j = 0; j < stringValue.length; j += 2) {
                        const c1 = stringValue.charCodeAt(j) & 0xFF;
                        const c2 = (j + 1 < stringValue.length) ? (stringValue.charCodeAt(j + 1) & 0xFF) : 0;
                        const word = ((c1 << 8) | c2) & 0xFFFF;
                        memoryChanges.push({ address: address, value: word, segment: 'data' });
                        assemblyListing.push({ 
                            address: address, 
                            instruction: word,
                            line: originalLine,
                            segment: 'data'
                        });
                        address++;
                    }
                    memoryChanges.push({ address: address, value: 0, segment: 'data' });
                    assemblyListing.push({ 
                        address: address, 
                        instruction: 0,
                        line: originalLine,
                        segment: 'data'
                    });
                    address++;
                } else if (lineLower.startsWith('.equ')) {
                    const cleanLine = line.split(';')[0].trim();
                    const rest = cleanLine.substring(4).trim();
                    const eq = rest.match(/^([^\s,]+)[\s,]+(\S[\s\S]*)$/);
                    if (eq) {
                        const name = eq[1];
                        const value = eq[2].trim();
                        const upperVal = value.toUpperCase();
                        if (this.isRegister(upperVal)) {
                            this.aliases[name.toUpperCase()] = upperVal;
                        } else {
                            const imm = this.parseImmediate(value, false);
                            this.symbols[name] = imm;
                        }
                    }
                    assemblyListing.push({ line: originalLine, segment: currentSegment });
                } else {
                    const instruction = this.encodeInstruction(line, address, i + 1);
                    if (instruction !== null) {
                        memoryChanges.push({ address: address, value: instruction, segment: currentSegment });
                        assemblyListing.push({ 
                            address: address, 
                            instruction: instruction,
                            line: originalLine,
                            segment: currentSegment
                        });
                        address++;
                    } else {
                        assemblyListing.push({ address: address, line: originalLine, segment: currentSegment });
                    }
                }
            } catch (error) {
                errors.push(`Line ${i + 1}: ${error.message}`);
                assemblyListing.push({ 
                    address: address,
                    error: error.message,
                    line: originalLine,
                    segment: currentSegment
                });
                // Still advance address to maintain alignment
                if (!line.startsWith('.') && !line.split(';')[0].trim().endsWith(':')) {
                    address++;
                }
            }
        }

        // Check for unresolved references
        if (this.unresolvedRefs.length > 0) {
            for (const ref of this.unresolvedRefs) {
                errors.push(`Unresolved reference: ${ref.label} at line ${ref.line}`);
            }
        }

        return {
            success: errors.length === 0,
            memoryChanges: memoryChanges,
            symbols: this.symbols,
            errors: errors,
            listing: assemblyListing,
            segmentMap: segmentMap
        };
    }

    isDirective(line) {
        const l = (typeof line === 'string') ? line.toLowerCase() : '';
        return l.startsWith('.org') || 
               l.startsWith('.word') || 
               l.startsWith('.text') ||
               l.startsWith('.string') ||
               l.startsWith('.equ'); 
    }

    // Conditional assembly: `.if NAME` / `.ifdef NAME` / `.ifndef NAME` (and the
    // `.ifnot` alias), `.else`, `.endif`, with NAME taken from the caller's
    // `defines`. It is resolved before either pass: a line in an inactive branch
    // is replaced with an empty string, not removed, so the pass line numbers
    // still match the source. Nesting is tracked on a stack.
    applyConditionals(lines, defines, errors) {
        const defined = new Set();
        const add = (name) => { if (typeof name === 'string') defined.add(name.trim().toUpperCase()); };
        if (Array.isArray(defines)) defines.forEach(add);
        else if (defines && typeof defines === 'object') {
            for (const [key, value] of Object.entries(defines)) if (value) add(key);
        }

        const out = lines.slice();
        const stack = [];
        let active = true;
        for (let i = 0; i < lines.length; i++) {
            // Only directives matter here, so a comment split is harmless: a
            // non-matching line is never interpreted.
            const code = lines[i].split(';')[0].trim();
            const m = /^\.(ifdef|ifndef|ifnot|if|else|endif)\b(.*)$/i.exec(code);
            if (!m) {
                if (!active) out[i] = '';
                continue;
            }
            const kind = m[1].toLowerCase();
            const name = m[2].trim().toUpperCase();
            out[i] = '';
            if (kind === 'if' || kind === 'ifdef') {
                stack.push({ parent: active, cond: defined.has(name), seenElse: false });
                active = active && defined.has(name);
            } else if (kind === 'ifnot' || kind === 'ifndef') {
                stack.push({ parent: active, cond: !defined.has(name), seenElse: false });
                active = active && !defined.has(name);
            } else if (kind === 'else') {
                const frame = stack[stack.length - 1];
                if (!frame) { errors.push(`Line ${i + 1}: .else without .if`); continue; }
                if (frame.seenElse) { errors.push(`Line ${i + 1}: duplicate .else`); continue; }
                frame.seenElse = true;
                active = frame.parent && !frame.cond;
            } else { // endif
                const frame = stack.pop();
                if (!frame) { errors.push(`Line ${i + 1}: .endif without .if`); continue; }
                active = frame.parent;
            }
        }
        if (stack.length) errors.push(`Unterminated .if (${stack.length} still open)`);
        return out;
    }

    parseRegister(reg) {
        if (typeof reg !== 'string') {
            throw new Error(`Invalid register: ${reg}`);
        }
        
        const regMap = {
            // Standard register numbers
            'R0': 0, 'R1': 1, 'R2': 2, 'R3': 3, 'R4': 4, 'R5': 5, 'R6': 6, 'R7': 7,
            'R8': 8, 'R9': 9, 'R10': 10, 'R11': 11, 'R12': 12, 'R13': 13, 'R14': 14, 'R15': 15,
            // Aliases
            'FP': 12, 'SP': 13, 'LR': 14, 'PC': 15
        };
        
        let upperReg = reg.toUpperCase();
        if (upperReg === 'RO') upperReg = 'R0';
        if (this.aliases && this.aliases[upperReg]) {
            upperReg = this.aliases[upperReg];
        }
        if (upperReg in regMap) return regMap[upperReg];
        
        // Also support case variations of aliases
        const lowerReg = reg.toLowerCase() === 'ro' ? 'r0' : reg.toLowerCase();
        const lowerMap = {
            'fp': 12, 'sp': 13, 'lr': 14, 'pc': 15
        };
        if (lowerReg in lowerMap) return lowerMap[lowerReg];
        
        throw new Error(`Invalid register: ${reg}`);
    }

    parseStringLiteral(text) {
        const trimmed = text.trim();
        if (!trimmed.startsWith('"')) {
            throw new Error('String literal must be enclosed in double quotes');
        }

        let endIdx = -1;
        for (let i = 1; i < trimmed.length; i++) {
            if (trimmed[i] === '"' && trimmed[i - 1] !== '\\') {
                endIdx = i;
                break;
            }
        }
        if (endIdx === -1) {
            throw new Error('String literal must be enclosed in double quotes');
        }

        const content = trimmed.substring(1, endIdx);
        let result = '';
        let i = 0;

        while (i < content.length) {
            const currentChar = content[i];

            if (currentChar === '\\') {
                if (i + 1 >= content.length) {
                    throw new Error('Incomplete escape sequence');
                }
                const nextChar = content[i + 1];
                switch (nextChar) {
                    case 'n': result += '\n'; break;
                    case 'r': result += '\r'; break;
                    case 't': result += '\t'; break;
                    case '0': result += '\0'; break;
                    case '\\': result += '\\'; break;
                    case '"': result += '"'; break;
                    default:
                        // Gracefully accept unknown escapes: treat as literal next char
                        result += nextChar;
                        break;
                }
                i += 2;
            } else {
                result += currentChar;
                i += 1;
            }
        }

        return result;
    }

    // Updated parseImmediate to handle forward references
    parseImmediate(value, firstPass) {
        if (typeof value !== 'string') {
            throw new Error(`Invalid immediate value: ${value}`);
        }
        
        // An optional leading "#" marks an immediate literal, matching the
        // syntax the disassembler prints (e.g. "ADD R1, #0x3").
        const trimmed = value.trim().replace(/^#/, '').trim();
    
        // Character constants
        if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
            return this.parseCharLiteral(trimmed, value);
        }
        
        // Numeric literals (handle signed decimal and signed hex before expression logic)
        if (/^[-+]?\d+$/.test(trimmed)) {
            return parseInt(trimmed, 10);
        }
        if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(trimmed)) {
            // parseInt supports signed hex like -0x1
            return parseInt(trimmed, 16);
        }

        // An operator or a parenthesis makes this a full expression. This test was
        // "+" and "-" only, so "100 * 8" missed it and fell through to the
        // parseInt below, which assembled it to 100 without a word of warning.
        if (/[+\-*/()]/.test(trimmed)) {
            return this.parseExpression(trimmed, firstPass);
        }
        
        // Hex (no sign) and decimal parsing
        if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
            return parseInt(trimmed.substring(2), 16);
        } else if (trimmed.startsWith('$')) {
            return parseInt(trimmed.substring(1), 16);
        } else {
            // A bare decimal is already handled above, so anything still here
            // that begins with a digit is malformed. This parseInt used to
            // take the leading number and drop the rest, so ".word 1 @ 2"
            // assembled to 1 without a word of complaint.
            if (/^\d+$/.test(trimmed)) {
                return parseInt(trimmed, 10);
            }
            // Label/symbol resolution (works in both passes now)
            if (this.labels && this.labels[trimmed] !== undefined) {
                return this.labels[trimmed];
            }
            if (this.symbols && this.symbols[trimmed] !== undefined) {
                return this.symbols[trimmed];
            }
            
            if (firstPass) {
                // In first pass, we don't have the label yet - return 0 as placeholder
                return 0;
            } else {
                // In second pass, this is an error
                throw new Error(`Unknown label: ${value}`);
            }
        }
    }

    // Character constants, shared by the plain-literal path in parseImmediate
    // and the expression tokenizer, so that "LDI 'a' + 1" means what it says.
    parseCharLiteral(trimmed, original) {
        const inner = trimmed.slice(1, -1);
        if (inner.length === 1) {
            return inner.charCodeAt(0);
        }
        if (inner.startsWith('\\') && inner.length === 2) {
            const esc = inner[1];
            switch (esc) {
                case 'n': return 10;
                case 'r': return 13;
                case 't': return 9;
                case '0': return 0;
                case '\\': return 92;
                case "'": return 39;
                case '"': return 34;
                default: throw new Error(`Invalid character escape: \\${esc}`);
            }
        }
        throw new Error(`Invalid character literal: ${original}`);
    }

    // Resolve a name to its address. Forward references are expected in the
    // first pass, which only fixes up addresses, so they read as 0 there and
    // are reported in the second.
    lookupSymbol(name, firstPass) {
        if (this.labels && this.labels[name] !== undefined) {
            return this.labels[name];
        }
        if (this.symbols && this.symbols[name] !== undefined) {
            return this.symbols[name];
        }
        if (firstPass) {
            return 0;
        }
        throw new Error(`Unknown label in expression: ${name}`);
    }

    // Split an expression into numbers, names, operators and parentheses.
    // Anything else is an error here, so a stray character in an operand can
    // never be quietly dropped.
    tokenizeExpression(expr) {
        const tokens = [];
        let i = 0;
        while (i < expr.length) {
            const c = expr[i];
            if (/\s/.test(c)) { i++; continue; }

            if ('+-*/()'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }

            // Character constant, including the backslash escapes.
            if (c === "'") {
                const end = expr.indexOf("'", i + 1);
                if (end === -1) throw new Error(`Unterminated character constant: ${expr}`);
                tokens.push({ type: 'num', value: this.parseCharLiteral(expr.slice(i, end + 1), expr) });
                i = end + 1;
                continue;
            }

            // Hex, either 0x.. or $.., then decimal.
            const hex = c === '$'
                ? /^\$[0-9a-fA-F]+/.exec(expr.slice(i))
                : /^0[xX][0-9a-fA-F]+/.exec(expr.slice(i));
            if (hex) {
                tokens.push({ type: 'num', value: parseInt(hex[0].replace(/^\$|^0[xX]/, ''), 16) });
                i += hex[0].length;
                continue;
            }
            const dec = /^\d+/.exec(expr.slice(i));
            if (dec) {
                tokens.push({ type: 'num', value: parseInt(dec[0], 10) });
                i += dec[0].length;
                continue;
            }

            if (/[a-zA-Z_]/.test(c)) {
                const name = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(expr.slice(i))[0];
                tokens.push({ type: 'id', value: name });
                i += name.length;
                continue;
            }

            throw new Error(`Invalid character '${c}' in expression: ${expr}`);
        }
        return tokens;
    }

    // Evaluate a full integer expression: labels and symbols, decimal, hex and
    // character literals, the operators + - * / and parentheses. This used to
    // be two regular expressions covering "label + 4" and "label - 4" only,
    // so "f0 - f1" was rejected outright while "100 * 8" fell through to
    // parseInt and assembled to 100 without a word of complaint.
    parseExpression(expr, firstPass) {
        const tokens = this.tokenizeExpression(expr);
        if (tokens.length === 0) throw new Error(`Invalid expression: ${expr}`);

        let pos = 0;
        const peek = () => tokens[pos];
        const next = () => tokens[pos++];

        const parseSum = () => {
            let value = parseProduct();
            while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
                const op = next().value;
                const rhs = parseProduct();
                value = op === '+' ? value + rhs : value - rhs;
            }
            return value;
        };

        const parseProduct = () => {
            let value = parsePrimary();
            while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
                const op = next().value;
                const rhs = parsePrimary();
                if (op === '*') {
                    value = value * rhs;
                } else {
                    if (rhs === 0) throw new Error(`Division by zero in expression: ${expr}`);
                    value = Math.trunc(value / rhs);
                }
            }
            return value;
        };

        const parsePrimary = () => {
            const token = next();
            if (!token) throw new Error(`Invalid expression: ${expr}`);

            if (token.type === 'num') return token.value;
            if (token.type === 'id') return this.lookupSymbol(token.value, firstPass);

            // Unary sign, and the opening parenthesis of a bracketed sum.
            if (token.type === 'op' && (token.value === '+' || token.value === '-')) {
                const value = parsePrimary();
                return token.value === '-' ? -value : value;
            }
            if (token.type === 'op' && token.value === '(') {
                const value = parseSum();
                const close = next();
                if (!close || close.type !== 'op' || close.value !== ')') {
                    throw new Error(`Unbalanced parenthesis in expression: ${expr}`);
                }
                return value;
            }

            throw new Error(`Invalid expression: ${expr}`);
        };

        const result = parseSum();
        if (pos !== tokens.length) {
            throw new Error(`Trailing text in expression: ${expr}`);
        }
        return result;
    }

    isRegister(value) {
        if (typeof value !== 'string') return false;
        let upper = value.toUpperCase();
        const lower = value.toLowerCase();
        if (this.aliases && this.aliases[upper]) {
            upper = this.aliases[upper];
        }
        
        // Check for R0-R15
        if (upper.startsWith('R') && !isNaN(parseInt(upper.substring(1)))) {
            const num = parseInt(upper.substring(1));
            return num >= 0 && num <= 15;
        }
        
        // Check for aliases (case insensitive)
        const aliases = ['FP', 'SP', 'LR', 'PC', 'fp', 'sp', 'lr', 'pc'];
        return aliases.includes(upper) || aliases.includes(lower);
    }

    encodeInstruction(line, address, lineNumber) {
        const cleanLine = line.split(';')[0].trim();
        if (!cleanLine) return null;

        // Operands are comma-separated, so split on commas and let each chunk
        // keep its internal spaces. Splitting on whitespace as well used to
        // truncate an operand expression at its first space, so "ADD R3,
        // BIOS_JTABLE - bios_jtab_add" arrived as the single label BIOS_JTABLE
        // and was assembled as a jump table that pointed nowhere.
        const chunks = cleanLine.split(',').map(c => c.trim()).filter(Boolean);
        if (chunks.length === 0) return null;
        const firstWords = chunks[0].split(/\s+/).filter(Boolean);
        const mnemonic = firstWords[0].toUpperCase();
        // The first chunk holds the mnemonic and, usually, the first operand.
        // Keep the rest of it as one part, so "LDI ' '" and "MOV R3, a - b"
        // survive the round trip.
        const parts = [mnemonic];
        if (firstWords.length > 1) parts.push(firstWords.slice(1).join(' '));
        for (let i = 1; i < chunks.length; i++) parts.push(chunks[i]);

        try {
            switch (mnemonic) {
                case 'MOV': return this.encodeMOV(parts, address, lineNumber);
                case 'ADD': return this.encodeALU(parts, 'ADD', address, lineNumber);
                case 'SUB': return this.encodeALU(parts, 'SUB', address, lineNumber);
                case 'CMP': return this.encodeALU(parts, 'CMP', address, lineNumber);
                case 'AND': return this.encodeALU(parts, 'AND', address, lineNumber);
                case 'TBC': return this.encodeALU(parts, 'TBC', address, lineNumber);
                case 'OR':  return this.encodeALU(parts, 'OR', address, lineNumber);
                case 'XOR': return this.encodeALU(parts, 'XOR', address, lineNumber);
                case 'TBS': return this.encodeALU(parts, 'TBS', address, lineNumber);
                case 'CLRB': return this.encodeALU(parts, 'CLRB', address, lineNumber);
                case 'MUL': return this.encodeALU(parts, 'MUL', address, lineNumber);
                case 'MUL32': return this.encodeALU(parts, 'MUL32', address, lineNumber);
                case 'DIV': return this.encodeALU(parts, 'DIV', address, lineNumber);
                case 'DIV32': return this.encodeALU(parts, 'DIV32', address, lineNumber);
                case 'ST':  return this.encodeMemory(parts, true, address, lineNumber);
                case 'LD':  return this.encodeMemory(parts, false, address, lineNumber);
                case 'JZ':  return this.encodeJump(parts, 0b000, address, lineNumber);
                case 'JNZ': return this.encodeJump(parts, 0b001, address, lineNumber);
                case 'JC':  return this.encodeJump(parts, 0b010, address, lineNumber);
                case 'JNC': return this.encodeJump(parts, 0b011, address, lineNumber);
                case 'JN':  return this.encodeJump(parts, 0b100, address, lineNumber);
                case 'JNN': return this.encodeJump(parts, 0b101, address, lineNumber);
                case 'JO':  return this.encodeJump(parts, 0b110, address, lineNumber);
                case 'JNO': return this.encodeJump(parts, 0b111, address, lineNumber);
                
                // JMP alias
                case 'JMP': 
                    if (parts.length >= 2 && this.isRegister(parts[1])) {
                        const rx = this.parseRegister(parts[1]);
                        // Encode as MOV PC, Rx
                        return 0b1111100000000000 | (15 << 6) | (rx << 2) | 0;
                    }
                    throw new Error('JMP requires register operand');
                
                case 'LPSW':
                    if (parts.length >= 2) {
                        const rx = this.parseRegister(parts[1]);
                        return 0xFF80 | (0b11 << 4) | rx;
                    }
                    throw new Error('LPSW requires register operand');
                case 'SPSW':
                    if (parts.length >= 2) {
                        const rx = this.parseRegister(parts[1]);
                        return 0xFF80 | (0b10 << 4) | rx;
                    }
                    throw new Error('SPSW requires register operand');
                case 'LNK': // LNK Rx => MOV Rx, PC, 2
                    if (parts.length >= 2) {
                        const rd = this.parseRegister(parts[1]);
                        return 0b1111100000000000 | (rd << 6) | (15 << 2) | 2;
                    }
                    throw new Error('LNK requires destination register');
                case 'LINK': // LINK => MOV LR, PC, 2
                    return 0b1111100000000000 | (14 << 6) | (15 << 2) | 2;
                case 'ALNK': // ALNK Rx => SMV Rx, APC (spec Table R: architectural read of the active PC, bypasses forwarding)
                    if (parts.length >= 2) {
                        return this.encodeSMV([null, parts[1], 'APC'], address, lineNumber);
                    }
                    throw new Error('ALNK requires destination register');
                case 'ALINK': // ALINK => SMV LR, APC (spec Table R)
                    return this.encodeSMV([null, 'LR', 'APC'], address, lineNumber);
                
                // Shift operations
                case 'SL':   return this.encodeShift(parts, 'SL', address, lineNumber);
                case 'SLA':  return this.encodeShift(parts, 'SLA', address, lineNumber);
                case 'SLAC': return this.encodeShift(parts, 'SLAC', address, lineNumber);
                case 'SLC':  return this.encodeShift(parts, 'SLC', address, lineNumber);
                case 'SR':   return this.encodeShift(parts, 'SR', address, lineNumber);
                case 'SRC':  return this.encodeShift(parts, 'SRC', address, lineNumber);
                case 'SRA':  return this.encodeShift(parts, 'SRA', address, lineNumber);
                case 'SRAC': return this.encodeShift(parts, 'SRAC', address, lineNumber);
                case 'ROL':  return this.encodeShift(parts, 'ROL', address, lineNumber);
                case 'RLC':  return this.encodeShift(parts, 'RLC', address, lineNumber);
                case 'ROR':  return this.encodeShift(parts, 'ROR', address, lineNumber);
                case 'RRC':  return this.encodeShift(parts, 'RRC', address, lineNumber);
                
                // PSW operations
                case 'SRS': return this.encodeSRS(parts, address, lineNumber);
                case 'SRD': return this.encodeSRD(parts, address, lineNumber);
                case 'ERS': return this.encodeERS(parts, address, lineNumber);
                case 'ERD': return this.encodeERD(parts, address, lineNumber);
                
                // Segment operations
                case 'MVS': return this.encodeMVS(parts, address, lineNumber);
                
                // Special moves
                case 'SMV': return this.encodeSMV(parts, address, lineNumber);
                
                // Long jump
                case 'JML': return this.encodeJML(parts, address, lineNumber);
                
                // Flag operations
                case 'SET': return this.encodeSET(parts, address, lineNumber);
                case 'CLR': return this.encodeCLR(parts, address, lineNumber);
                case 'SET2': return this.encodeSET2(parts, address, lineNumber);
                case 'CLR2': return this.encodeCLR2(parts, address, lineNumber);
                
                // Flag aliases (spec 5.3: SETN = SET 0 ... CLRC = CLR 3)
                case 'SETN': return this.encodeSETAlias(0b0000);
                case 'CLRN': return this.encodeCLRAlias(0b0000);
                case 'SETZ': return this.encodeSETAlias(0b0001);
                case 'CLRZ': return this.encodeCLRAlias(0b0001);
                case 'SETV': return this.encodeSETAlias(0b0010);
                case 'CLRV': return this.encodeCLRAlias(0b0010);
                case 'SETC': return this.encodeSETAlias(0b0011);
                case 'CLRC': return this.encodeCLRAlias(0b0011);
                case 'SETI': return this.encodeSystem(0b100);
                case 'CLRI': return this.encodeSystem(0b101);
                case 'SETS': return this.encodeSET2Alias(0b0001);
                case 'CLRS': return this.encodeCLR2Alias(0b0001);
                
                // System instructions
                case 'FSH': return this.encodeSystem(0b001);
                case 'SWI': return this.encodeSystem(0b010);
                case 'RETI': return this.encodeSystem(0b011);
                case 'NOP':  return this.encodeSystem(0b000);
                case 'HALT': 
                case 'HLT': return 0xFFFF;
                
                case 'LDI':  return this.encodeLDIFromLine(cleanLine, address, lineNumber);
                case 'LWI':  return this.encodeLWIFromLine(cleanLine, address, lineNumber);
                case 'LSI':  return this.encodeLSI(parts, address, lineNumber);

                case 'LDS': return this.encodeLDSSTS(parts, false, address, lineNumber);
                case 'STS': return this.encodeLDSSTS(parts, true, address, lineNumber);
                
                // Complete SOP operations
                case 'SWB': return this.encodeSWB(parts, address, lineNumber);
                case 'INV': return this.encodeINV(parts, address, lineNumber);
                case 'NEG': return this.encodeNEG(parts, address, lineNumber);
                
                default: 
                    if (this.labels[mnemonic] !== undefined) {
                        return null;
                    }
                    throw new Error(`Unknown instruction: ${mnemonic}`);
            }
        } catch (error) {
            throw new Error(`${error.message}`);
        }
    }

    // Encode SRS instruction
    encodeSRS(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // SRS: [1111111110][1000][Rx4]
            return 0b1111111110000000 | (0b1000 << 4) | rx;
        }
        throw new Error('SRS requires register operand');
    }

    // Encode SRD instruction (swapped mapping)
    encodeSRD(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // SRD: [1111111110][0001][Rx4]
            return 0b1111111110000000 | (0b0001 << 4) | rx;
        }
        throw new Error('SRD requires register operand');
    }

    // Encode ERS instruction
    encodeERS(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // ERS: [1111111110][1010][Rx4]
            return 0b1111111110000000 | (0b1010 << 4) | rx;
        }
        throw new Error('ERS requires register operand');
    }

    // Encode ERD instruction (updated mapping)
    encodeERD(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // ERD: [1111111110][0011][Rx4]
            return 0b1111111110000000 | (0b0011 << 4) | rx;
        }
        throw new Error('ERD requires register operand');
    }

    // Update the encodeMVS method to handle both read and write operations:
    encodeMVS(parts, address, lineNumber) {
        if (parts.length >= 3) {
            // Check if first operand is a segment register (write operation)
            const firstOperand = parts[1].toUpperCase();
            const secondOperand = parts[2].toUpperCase();
            
            const segMap = {
                'CS': 0b00, 'DS': 0b01, 'SS': 0b10, 'ES': 0b11
            };
            
            if (firstOperand in segMap) {
                const seg = segMap[firstOperand];
                const rd = this.parseRegister(parts[2]);
                return 0b1111111101000000 | (rd << 2) | seg;
            } else if (secondOperand in segMap) {
                const rd = this.parseRegister(parts[1]);
                const seg = segMap[secondOperand];
                return 0b1111111100000000 | (rd << 2) | seg;
            }
            throw new Error(`Invalid MVS operands: ${parts[1]}, ${parts[2]}`);
        }
        throw new Error('MVS requires destination register and segment register');
    }

    // Encode SMV instruction (updated 8-bit encoding)
    encodeSMV(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rx = this.parseRegister(parts[1]);
            const alt = parts[2].toUpperCase();
            const altMap = {
                'ACS': 0b0000,
                'ADS': 0b0001,
                'ASS': 0b0010,
                'AES': 0b0011,
                'APSW': 0b0100,
                'AR0': 0b1000,
                'AR1': 0b1001,
                'AR2': 0b1010,
                'AR3': 0b1011,
                'AR13': 0b1101,
                'AR14': 0b1110,
                'APC': 0b1111,
            };
            if (!(alt in altMap)) {
                throw new Error(`Invalid SMV source: ${alt}`);
            }
        return 0b1111111000000000 | (rx << 4) | altMap[alt];
        }
        throw new Error('SMV requires destination register and source');
    }

    encodeJML(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            return 0b1111111111100000 | (rx & 0xF);
        }
        throw new Error('JML requires register operand (even register)');
    }

    // Replace the encodeMOV method with this version that calls existing encoding methods:
    encodeMOV(parts, address, lineNumber) {
        if (parts.length >= 3) {
            let rd, rs, imm;
            
            // Check if we're using the plus syntax by looking for + in the joined parts
            const joinedParts = parts.join(' ');
            if (window.Deep16Debug) console.log(`MOV joined parts: "${joinedParts}"`);
            
            // Shift syntax: MOV Rd, Rs << 1      -> imm2=1 (Rd = Rs << 1)
            //                MOV Rd, Rs << 1 + 1 -> imm2=3 (Rd = (Rs << 1) | 1)
            // Checked before the '+' branch because the shift-or-1 form contains a '+'.
            if (joinedParts.includes('<<')) {
                const shiftMatch = joinedParts.match(/^MOV\s+(\S+)\s+(\S+)\s*<<\s*1(\s*\+\s*1)?$/i);
                if (!shiftMatch) {
                    throw new Error(`Invalid MOV shift syntax: ${joinedParts}. Expected 'MOV Rd, Rs << 1' (Rd = Rs << 1) or 'MOV Rd, Rs << 1 + 1' (Rd = (Rs << 1) | 1)`);
                }
                rd = this.parseRegister(shiftMatch[1]);
                rs = this.parseRegister(shiftMatch[2]);
                imm = shiftMatch[3] ? 3 : 1;
                // Regular MOV encoding: [111110][Rd4][Rs4][imm2]
                return 0b1111100000000000 | (rd << 6) | (rs << 2) | imm;
            }
            
            if (joinedParts.includes('+')) {
                // Plus syntax: MOV R1, R2+2 or MOV R1, R2 + 2
                // (+1/+3 are rejected below: imm2=1/3 now encode the shift forms)
                if (window.Deep16Debug) console.log("Detected MOV plus syntax");
                
                // Extract the register+immediate part using regex
                const movMatch = joinedParts.match(/MOV\s+([A-Za-z0-9]+)\s+([A-Za-z0-9]+)\s*\+\s*(\d+)/);
                if (window.Deep16Debug) console.log(`MOV match:`, movMatch);
                
                if (!movMatch) {
                    throw new Error(`Invalid MOV plus syntax: ${joinedParts}`);
                }
                
                rd = this.parseRegister(movMatch[1].trim());
                rs = this.parseRegister(movMatch[2].trim());
                imm = this.parseImmediate(movMatch[3].trim(), false);
                
                // Handle regular MOV with offset
                if (window.Deep16Debug) console.log(`MOV parsed: rd=${rd}, rs=${rs}, imm=${imm}`);
                
                if (imm < 0 || imm > 3) {
                    throw new Error(`MOV immediate ${imm} out of range (0-3)`);
                }
                
                // imm2=1/3 changed meaning: they now encode the shift forms
                // 'Rs << 1' and '(Rs << 1) | 1', not 'Rs + 1' / 'Rs + 3'.
                // Reject instead of silently shifting an old source.
                if (imm === 1 || imm === 3) {
                    throw new Error(`MOV '+${imm}' rejected: imm2=${imm} now means '${imm === 1 ? 'Rs << 1' : '(Rs << 1) | 1'}', not 'Rs + ${imm}'. Write 'MOV ${movMatch[1]}, ${movMatch[2]} << 1${imm === 3 ? ' + 1' : ''}' (or '+2' for an even offset)`);
                }
                
                // Regular MOV encoding: [111110][Rd4][Rs4][imm2]
                return 0b1111100000000000 | (rd << 6) | (rs << 2) | imm;
            } 
            // Original syntax: MOV R1, R2 or MOV R1, R2, 0
            else if (parts.length >= 3) {
                if (window.Deep16Debug) console.log("Detected original MOV syntax");
                rd = this.parseRegister(parts[1]);
                
                // Check if second operand is a segment register or special register
                const secondOperand = parts[2].toUpperCase();
                
                // Handle MOV between segment registers and general registers
                if (this.isSegmentRegister(secondOperand)) {
                    // MOV Rd, Sx -> MVS Rd, Sx (read from segment register)
                    if (window.Deep16Debug) console.log(`Detected MOV from segment register: ${secondOperand}`);
                    return this.encodeMVS([null, parts[1], parts[2]], address, lineNumber);
                }
                else if (secondOperand === 'PSW') {
                    return 0b1111111111100000 | rd;
                }
                else if (this.isSpecialRegister(secondOperand)) {
                    // MOV Rd, special -> SMV Rd, special
                    if (window.Deep16Debug) console.log(`Detected MOV from special register: ${secondOperand}`);
                    return this.encodeSMV([null, parts[1], parts[2]], address, lineNumber);
                }
                else {
                    // Regular register to register move
                    rs = this.parseRegister(parts[2]);
                    
                    if (parts.length >= 4) {
                        imm = this.parseImmediate(parts[3], false);
                    } else {
                        imm = 0; // Default immediate is 0 if not specified
                    }
                    
                    if (window.Deep16Debug) console.log(`MOV parsed: rd=${rd}, rs=${rs}, imm=${imm}`);
                    
                    if (imm < 0 || imm > 3) {
                        throw new Error(`MOV immediate ${imm} out of range (0-3)`);
                    }
                    
                    // imm2=1/3 changed meaning: they now encode the shift forms
                    // 'Rs << 1' and '(Rs << 1) | 1', not 'Rs + 1' / 'Rs + 3'.
                    // Reject instead of silently shifting an old source.
                    if (imm === 1 || imm === 3) {
                        throw new Error(`MOV '${parts[1]}, ${parts[2]}, ${imm}' rejected: imm2=${imm} now means '${imm === 1 ? 'Rs << 1' : '(Rs << 1) | 1'}', not 'Rs + ${imm}'. Write 'MOV ${parts[1]}, ${parts[2]} << 1${imm === 3 ? ' + 1' : ''}'`);
                    }
                    
                    // Regular MOV encoding: [111110][Rd4][Rs4][imm2]
                    return 0b1111100000000000 | (rd << 6) | (rs << 2) | imm;
                }
            }
            else {
                throw new Error('MOV requires destination register and source register');
            }
        }
        
        // Handle MOV with segment register as destination
        if (parts.length >= 3) {
            const firstOperand = parts[1].toUpperCase();
            
            if (this.isSegmentRegister(firstOperand)) {
                // MOV Sx, Rd -> MVS Sx, Rd (write to segment register)
                if (window.Deep16Debug) console.log(`Detected MOV to segment register: ${firstOperand}`);
                // For MVS with write, we need to call encodeMVS with the right parameters
                // But encodeMVS expects [MVS, Rd, seg] format, so we need to rearrange
                const tempParts = ['MVS', parts[2], parts[1]]; // Swap operands for MVS encoding
                return this.encodeMVS(tempParts, address, lineNumber);
            }
        }
        
        throw new Error('MOV requires destination register and source register');
    }

    // Helper method to check if a string is a segment register
    isSegmentRegister(reg) {
        const segRegs = ['CS', 'DS', 'SS', 'ES'];
        return segRegs.includes(reg.toUpperCase());
    }

    // Helper method to check if a string is a special register
    isSpecialRegister(reg) {
        const specialRegs = ['APC', 'APSW', 'PSW', 'ACS'];
        return specialRegs.includes(reg.toUpperCase());
    }
    
    // Encode LDS/STS instructions
    encodeLDSSTS(parts, isStore, address, lineNumber) {
        if (parts.length > 4) {
            // Type I.B has no offset field. Silently dropping the operand
            // would store to an address the writer never named, so reject it.
            throw new Error(`${isStore ? 'STS' : 'LDS'} has no offset operand (register, segment, base register)`);
        }
        if (parts.length >= 4) {
            const rd = this.parseRegister(parts[1]);
            const seg = parts[2].toUpperCase();
            const rs = this.parseRegister(parts[3]);
            
            const segMap = {
                'CS': 0b00, 'DS': 0b01, 'SS': 0b10, 'ES': 0b11
            };
            
            if (seg in segMap) {
                // LDS/STS: [11110][d][seg2][Rd4][Rs4]
                // Bits: 15-11: opcode=11110, 10: d, 9-8: seg, 7-4: Rd, 3-0: Rs
                return 0b1111000000000000 | 
                       (isStore ? 0x0400 : 0) | 
                       (segMap[seg] << 8) | 
                       (rd << 4) | 
                       rs;
            }
            throw new Error(`Invalid segment register: ${seg}`);
        }
        throw new Error(`${isStore ? 'STS' : 'LDS'} requires register, segment, and base register`);
    }

    encodeShift(parts, shiftName, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            const count = this.parseImmediate(parts[2], false);
            if (count < 0 || count > 15) {
                throw new Error(`Shift count ${count} out of range (0-15)`);
            }
            let func5 = 0;
            switch (shiftName) {
                case 'SL': func5 = 0b10000; break;
                case 'SLA': func5 = 0b10001; break;
                case 'SLAC': func5 = 0b10010; break;
                case 'SLC': func5 = 0b10011; break;
                case 'SR': func5 = 0b10100; break;
                case 'SRC': func5 = 0b10101; break;
                case 'SRA': func5 = 0b10110; break;
                case 'SRAC': func5 = 0b10111; break;
                case 'ROL': func5 = 0b11000; break;
                case 'RLC': func5 = 0b11001; break;
                case 'ROR': func5 = 0b11010; break;
                case 'RRC': func5 = 0b11011; break;
                default: throw new Error(`Unknown shift mnemonic ${shiftName}`);
            }
            return (0b110 << 13) | (func5 << 8) | (rd << 4) | (count & 0xF);
        }
        throw new Error('Shift operation requires register and count');
    }

    // Encode SWB (Swap Bytes)
    encodeSWB(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // Alias: SWB Rx => ROL Rx, 8 (ALU2 group)
            const func5 = 0b11000; // ROL
            const count = 8;
            return (0b110 << 13) | (func5 << 8) | (rx << 4) | (count & 0xF);
        }
        throw new Error('SWB requires register operand');
    }

    // Encode INV (Invert) using SOP type2 mapping
    encodeINV(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            return 0xFF80 | (0b00 << 4) | rx;
        }
        throw new Error('INV requires register operand');
    }

    // Encode NEG (Negate) using SOP type2 mapping
    encodeNEG(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            return 0xFF80 | (0b01 << 4) | rx;
        }
        throw new Error('NEG requires register operand');
    }

    encodeALU(parts, kind, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            const op = parts[2];
            const isReg = this.isRegister(op);
            // The ALU group has two forms and no third (spec Table 6,
            // doc/Deep16-Arch.md 3.4): `Rd, Rs` computes Rd <- Rd OP Rs,
            // `Rd, imm` computes Rd <- Rd OP imm. Both are two-operand, so a
            // third operand used to be dropped in silence and the line did
            // something other than what it said: in the Forth kernel
            // `ADD R11, R9, 1` assembled as `R11 <- R11 + R9`, which put a
            // garbage address into a compiled string. Rejected, not ignored.
            if (isReg && parts.length >= 4) {
                const symbol = { ADD: '+', SUB: '-', CMP: '-', TBC: '&', OR: '|', XOR: '^', TBS: '&' }[kind] || kind;
                throw new Error(
                    `${kind} '${parts[1]}, ${parts[2]}, ${parts[3]}' rejected: there is no three-operand ${kind}. ` +
                    `'${kind} ${parts[1]}, ${parts[2]}' computes ${parts[1]} <- ${parts[1]} ${symbol} ${parts[2]}, ` +
                    `'${kind} ${parts[1]}, ${parts[3]}' computes ${parts[1]} <- ${parts[1]} ${symbol} ${parts[3]}; ` +
                    `the operand in the middle would be dropped.`
                );
            }
            let func5 = null;
            if (kind === 'ADD') {
                func5 = isReg ? 0b00000 : 0b00001;
            } else if (kind === 'SUB') {
                func5 = isReg ? 0b00010 : 0b00011;
            } else if (kind === 'CMP') {
                func5 = isReg ? 0b00100 : 0b00101;
            } else if (kind === 'AND') {
                // Spec Table 6 dropped AND Rd, imm: slot 110 00111 belongs to CLRB.
                if (!isReg) {
                    throw new Error('AND has no immediate form - 110 00111 is CLRB. Clear a bit with CLRB Rd, bit, or load a mask (LDI/LSI) and use AND Rd, Rs');
                }
                func5 = 0b00110;
            } else if (kind === 'TBC') {
                func5 = isReg ? 0b01000 : 0b01001;
            } else if (kind === 'OR') {
                func5 = isReg ? 0b01010 : 0b01011;
            } else if (kind === 'XOR') {
                func5 = isReg ? 0b01100 : 0b01101;
            } else if (kind === 'TBS') {
                func5 = isReg ? 0b01110 : 0b01111;
            } else if (kind === 'CLRB') {
                if (isReg) throw new Error('CLRB requires an immediate bit number (0-15)');
                func5 = 0b00111;
            } else if (kind === 'MUL') {
                if (!isReg) throw new Error('MUL requires register operand');
                func5 = 0b11100;
            } else if (kind === 'MUL32') {
                if (!isReg) throw new Error('MUL32 requires register operand');
                // 32-bit result lands in R[d]:R[d+1], so the pair must be aligned (spec Table 8)
                if (rd % 2 !== 0) throw new Error('MUL32 requires EVEN destination register (32-bit result in Rd:Rd+1)');
                func5 = 0b11101;
            } else if (kind === 'DIV') {
                if (!isReg) throw new Error('DIV requires register operand');
                func5 = 0b11110;
            } else if (kind === 'DIV32') {
                if (!isReg) throw new Error('DIV32 requires register operand');
                if (rd % 2 !== 0) throw new Error('DIV32 requires EVEN destination register (32-bit operand in Rd:Rd+1)');
                func5 = 0b11111;
            }
            if (func5 === null) throw new Error('Unsupported ALU operation');
            if (isReg) {
                const rs = this.parseRegister(op);
                return (0b110 << 13) | (func5 << 8) | (rd << 4) | rs;
            } else {
                const imm = this.parseImmediate(op, false);
                if (imm < 0 || imm > 15) {
                    throw new Error(`Immediate value ${imm} out of range (0-15)`);
                }
                // ADD/SUB/CMP take the 4-bit literal as-is. TBC/OR/XOR/TBS/CLRB
                // take a bit INDEX (spec Table 6): the field holds 0-15 and the
                // core expands it to 1 << imm, so it is stored unshifted here.
                return (0b110 << 13) | (func5 << 8) | (rd << 4) | (imm & 0xF);
            }
        }
        throw new Error('ALU operation requires destination and operand');
    }
    
    encodeMemory(parts, isStore, address, lineNumber) {
        if (window.Deep16Debug) console.log(`encodeMemory parts:`, parts, `isStore:`, isStore);
        
        if (parts.length >= 3) {
            let rd, rb, offset;
            
            // Check if we're using bracket syntax by looking for [ in any part
            const joinedParts = parts.join(' ');
            if (window.Deep16Debug) console.log(`Joined parts: "${joinedParts}"`);
            
            if (joinedParts.includes('[') && joinedParts.includes(']')) {
                // Bracket syntax: LD R1, [R2+5] or ST R1, [R2] or LD R1, [R2 + 5] or LD R1, [R2-3]
                if (window.Deep16Debug) console.log("Detected bracket syntax");
                
                // Extract the entire bracket content from joined parts
                const bracketMatch = joinedParts.match(/\[([^\]]+)\]/);
                if (window.Deep16Debug) console.log(`Bracket match:`, bracketMatch);
                
                if (!bracketMatch) {
                    throw new Error(`Invalid bracket syntax in ${isStore ? 'ST' : 'LD'}`);
                }
                
                const bracketContent = bracketMatch[1];
                if (window.Deep16Debug) console.log(`Bracket content: "${bracketContent}"`);
                
                // Parse Rb and optional signed offset (+imm or -imm), imm can be dec or hex
                const memoryMatch = bracketContent.match(/^([A-Za-z0-9]+)\s*(([+\-])\s*(0[xX][0-9a-fA-F]+|\d+))?$/);
                if (window.Deep16Debug) console.log(`Memory match:`, memoryMatch);
                
                if (!memoryMatch) {
                    throw new Error(`Invalid memory address syntax: "${bracketContent}"`);
                }
                
                rb = this.parseRegister(memoryMatch[1].trim());
                if (memoryMatch[2]) {
                    const sign = memoryMatch[3];
                    const immStr = memoryMatch[4].trim();
                    const signedStr = (sign === '-') ? ('-' + immStr) : ('+' + immStr);
                    offset = this.parseImmediate(signedStr, false);
                } else {
                    offset = 0;
                }
                
                // Rd is the part before the brackets
                const beforeBracket = joinedParts.split('[')[0].trim();
                if (window.Deep16Debug) console.log(`Before bracket: "${beforeBracket}"`);
                const rdParts = beforeBracket.split(/\s+/);
                if (window.Deep16Debug) console.log(`Rd parts:`, rdParts);
                rd = this.parseRegister(rdParts[rdParts.length - 1]);
            } 
            // Old syntax: LD R1, R2, 5 (only positive offsets 0-31)
            else if (parts.length >= 4) {
                if (window.Deep16Debug) console.log("Detected old syntax");
                rd = this.parseRegister(parts[1]);
                rb = this.parseRegister(parts[2]);
                offset = this.parseImmediate(parts[3], false);
            } else if (parts.length === 3) {
                // Old syntax without explicit offset: default to 0
                if (window.Deep16Debug) console.log("Detected old syntax (implicit offset 0)");
                rd = this.parseRegister(parts[1]);
                rb = this.parseRegister(parts[2]);
                offset = 0;
            }
            else {
                throw new Error(`${isStore ? 'ST' : 'LD'} requires register, base register, and offset`);
            }
            
            if (window.Deep16Debug) console.log(`Parsed: rd=${rd}, rb=${rb}, offset=${offset}`);
            
            // Deep16 LD/ST use 5-bit SIGNED offset (-16..15)
            if (offset < -16 || offset > 15) {
                throw new Error(`Offset ${offset} out of range (-16..15)`);
            }
            
            // LD/ST: [10][d1][Rd4][Rb4][offset5]
            // Bits: 15-14: opcode, 13: d, 12-9: Rd, 8-5: Rb, 4-0: offset
            return (isStore ? 0b1010000000000000 : 0b1000000000000000) | 
                   (rd << 9) | (rb << 5) | (offset & 0x1F);
        }
        throw new Error(`${isStore ? 'ST' : 'LD'} requires register, base register, and offset`);
    }

    encodeLDI(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1], false);
            // LDI's operand is a 15-BIT PATTERN, not a signed range: spec
            // doc/Deep16-Arch.md 3.4 (Table 2) reads `R0 <- sign_extend(imm15)`,
            // so all 32768 patterns are legal. The sign extension happens in
            // the CPU, not in the assembler — that is why `LDI 0x4000` yields
            // 0xC000 (= -16384) on both cores and why that is correct, not a
            // defect. Only values that do not fit the 15-bit field at all are
            // rejected, and the check keeps the sign spelling too:
            // 0..0x7FFF (raw pattern) or -16384..-1 (the same patterns, signed).
            // `LDI 0x4000` measuring -16384 on both cores is the documented
            // behaviour in book/kap06.md 6.2 / probe_kap06.mjs case P4, and
            // tests/disassembler.test.js locks the round trip (the
            // disassembler prints raw hex, which must stay assemblable).
            if (imm >= 0) {
                if (imm > 0x7FFF) {
                    throw new Error(`LDI immediate ${imm} out of range (0..0x7FFF)`);
                }
            } else {
                if (imm < -16384) {
                    throw new Error(`LDI immediate ${imm} out of range (-16384..16383)`);
                }
            }
            return imm & 0x7FFF;
        }
        throw new Error('LDI requires immediate value');
    }

    // LWI writes the 16-bit bit pattern the author wants in R0, instead of the
    // 15-bit field LDI carries. It is an assembler mnemonic, not a new opcode:
    // the ISA has no such instruction and the cores are untouched.
    //
    // Why it cannot be one instruction: the field is sign-extended from bit 14,
    // so LDI reaches exactly 0x0000-0x3FFF (bit 14 clear) and 0xC000-0xFFFF
    // (bit 14 set, which puts 1 in bit 15). The middle third, 0x4000-0xBFFF,
    // is unreachable - measured over all 32768 fields, not inferred. That is
    // why bios_f1 needs "LDI 0x0070; SL R0, 8" for 0x7000.
    //
    // So: a pattern LDI can already express is emitted as one LDI, and a
    // pattern it cannot is an error rather than a guess.
    // The instruction sequence that really does put `pattern` in R0, for the
    // message above. Two LDI values must not be suggested here: writing the low
    // 15 bits of a 0x4xxx-0x7xxx pattern gives 0xCxxx-0xFFFF, because bit 14 of
    // the field is a sign bit, so "LDI 0x7000" loads 0xF000.
    //
    // The working recipe is to load the low 14 bits - bit 14 clear, so the value
    // comes back exactly - and then set whichever of bits 14 and 15 the pattern
    // wants. OR Rd, imm is "Rd OR (1 << imm)" (spec Table 6), so it sets one bit
    // and leaves the rest. Note TBC is NOT that: it is test-and-clear, "Rd AND
    // (1 << imm)", so suggesting it here would silently clear a bit instead.
    recipeForLWIPattern(pattern) {
        const low = pattern & 0x3FFF;
        const parts = [`LDI 0x${low.toString(16).toUpperCase()}`];
        if (pattern & 0x4000) parts.push('OR R0, 14');
        if (pattern & 0x8000) parts.push('OR R0, 15');
        return parts.join(' then ');
    }

    encodeLWIFromLine(line, address, lineNumber) {
        const cleaned = line.split(';')[0].trim();
        const rest = cleaned.replace(/^LWI\s+/i, '').replace(/,$/, '').trim();
        if (!rest) {
            throw new Error('LWI requires a 16-bit value');
        }
        const value = this.parseImmediate(rest, false);
        if (value < -32768 || value > 0xFFFF) {
            throw new Error(`LWI value ${value} is not a 16-bit pattern (-32768..65535)`);
        }
        const pattern = value & 0xFFFF;
        const field = this.b15(pattern);
        if (field === null) {
            throw new Error(
                `LWI ${pattern} (0x${pattern.toString(16)}) is not representable by LDI: `
                + 'the immediate is 15 bits and sign-extended from bit 14, so one LDI can only '
                + `put 0x0000-0x3FFF or 0xC000-0xFFFF in R0. Build it instead: ${this.recipeForLWIPattern(pattern)}`);
        }
        return field;
    }

    // b15(X) = the 15-bit field F for which sign_extend(F) = X, or null if there
    // is none. This is the whole definition of LWI: "LWI X" assembles as
    // "LDI b15(X)", and no field means no LWI.
    //
    // sign_extend copies bit 14 of the field into bit 15. So the two high bits
    // of F cannot be chosen independently - they must agree, and they become
    // bits 14 and 15 of the result:
    //   F bits 14,15 = 0,0 -> X has bits 14,15 = 0,0   (0x0000-0x3FFF)
    //   F bits 14,15 = 1,1 -> X has bits 14,15 = 1,1   (0xC000-0xFFFF)
    // Asking for the other two combinations - 0x4000-0x7FFF and 0x8000-0xBFFF -
    // is asking for a sign extension that does not exist, so there is no F.
    // When a field does exist it is simply X with its top bit cleared.
    b15(pattern) {
        const value = pattern & 0xFFFF;
        if (((value >> 14) & 0x3) === 0b01 || ((value >> 14) & 0x3) === 0b10) return null;
        return value & 0x7FFF;
    }

    encodeLDIFromLine(line, address, lineNumber) {
        const cleaned = line.split(';')[0].trim();
        const rest = cleaned.replace(/^LDI\s+/i, '').replace(/,$/, '').trim();
        if (!rest) {
            throw new Error('LDI requires immediate value');
        }
        const imm = this.parseImmediate(rest, false);
        // Same rule as in encodeLDI: imm is a 15-bit pattern, see the comment
        // there. Both spellings (0..0x7FFF raw, -16384..-1 signed) are accepted
        // because both denote the same 32768 patterns.
        if (imm >= 0) {
            if (imm > 0x7FFF) {
                throw new Error(`LDI immediate ${imm} out of range (0..0x7FFF)`);
            }
        } else {
            if (imm < -16384) {
                throw new Error(`LDI immediate ${imm} out of range (-16384..16383)`);
            }
        }
        return imm & 0x7FFF;
    }

    encodeLSI(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            const imm = this.parseImmediate(parts[2], false);
            
            if (imm < -16 || imm > 15) {
                throw new Error(`LSI immediate ${imm} out of range (-16 to 15)`);
            }
            
            const imm5 = imm & 0x1F;
            // Correct encoding: [1111110][Rd4][imm5]
            // Bits: 15-9: opcode, 8-5: Rd, 4-0: imm5
            return 0b1111110000000000 | (rd << 5) | imm5;
        }
        throw new Error('LSI requires register and immediate value');
    }

    // Fix jump condition encoding
    // The single place a Jcc is encoded. It used to be duplicated: a copy of
    // this logic sat inline in encodeInstruction, above the switch, and returned
    // before ever reaching here. Two copies of the branch-offset contract is
    // one too many, and the inline one was the live code, so encodeJump's
    // error handling was untested - "Unknown jump condition" could never fire.
    //
    // The offset is target - (address + 1): all three cores post-increment the
    // PC before executing, so they add the stored value to the address AFTER
    // the branch. Pinned by "a taken conditional branch lands on its label" in
    // tests/cores.test.js.
    encodeJump(parts, condition, address, lineNumber) {
        if (parts.length < 2) {
            throw new Error('Jump requires target label');
        }
        const targetLabel = parts[1];
        const targetAddress = this.labels[targetLabel];
        if (targetAddress === undefined) {
            throw new Error(`Unknown label: ${targetLabel}`);
        }
        const offset = targetAddress - (address + 1);
        if (offset < -256 || offset > 255) {
            throw new Error(`Jump target too far: ${offset} words from current position`);
        }
        // [1110][condition3][offset9]
        return 0b1110000000000000 | (condition << 9) | (offset & 0x1FF);
    }

    encodeSET(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1], false);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`SET immediate ${imm} out of range (0-15)`);
            }
            return 0b1111111111000000 | (0 << 4) | (imm & 0xF);
        }
        throw new Error('SET requires immediate value');
    }

    encodeCLR(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1], false);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`CLR immediate ${imm} out of range (0-15)`);
            }
            return 0b1111111111000000 | (1 << 4) | (imm & 0xF);
        }
        throw new Error('CLR requires immediate value');
    }

    encodeSET2(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1], false);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`SET2 immediate ${imm} out of range (0-15)`);
            }
            return 0b1111111111000000 | (0 << 4) | (imm & 0xF);
        }
        throw new Error('SET2 requires immediate value');
    }

    encodeCLR2(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1], false);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`CLR2 immediate ${imm} out of range (0-15)`);
            }
            // Same as CLR: [11111111110][1][imm4]. The old encoding
            // (0xFFF0|imm) collided with the SYS range (NOP/SWI/SETI/HLT).
            return 0xFFD0 | (imm & 0xF);
        }
        throw new Error('CLR2 requires immediate value');
    }

    // Alias methods for flag operations. Spec Table 4: SET/CLR use
    // [11111111110][d1][imm4] (0xFFC0-0xFFDF). The old encodings
    // (0xFFA0/0xFFB0) fell into the SOP range (INV/NEG/SPSW/LPSW), so e.g.
    // SETZ assembled to SPSW R1 and silently clobbered the PSW.
    encodeSETAlias(imm) {
        return 0xFFC0 | (imm & 0xF);
    }

    encodeCLRAlias(imm) {
        return 0xFFD0 | (imm & 0xF);
    }

    encodeSET2Alias(imm) {
        return 0xFFC0 | ((imm + 4) & 0xF);
    }

    encodeCLR2Alias(imm) {
        return 0xFFD0 | ((imm + 4) & 0xF);
    }

    encodeSystem(sysOp) {
        // SYS: [1111111111110][op3]
        // Bits: 15-13: opcode=1111111111110, 2-0: sysOp
        return 0b1111111111110000 | sysOp;
    }
}
