/* deep16_terminal.js - a minimal VT terminal for the serial console.
 *
 * The UART console (D16MINI.md §7) is a dumb byte pipe: the machine sends plain
 * bytes plus a tiny ANSI subset, and the host terminal owns the screen. This
 * class is that host terminal - it turns the byte stream back into an 80x24
 * grid so the IDE can show it where the screen buffer used to be.
 *
 * The whole emitted set is supported (D16MINI.md §7.5):
 *   printable ASCII   the character, autowrapping at the right edge
 *   CR  (0x0D)        column 0 of the current row
 *   LF  (0x0A)        next row, scrolling when past the last visible row
 *   BS  (0x08)        one column left (the erase is "BS SP BS" on the wire)
 *   ESC [ <params> <final>
 *                     CSI. "J" clears and homes. Anything else - and every
 *                     non-CSI escape, i.e. an arrow key's ESC [ A - is consumed
 *                     and ignored, so input never leaks parser junk.
 *
 * There are no colours: the console drops attributes (D16MINI decision C2), so
 * a cell is one character and nothing else.
 */
class SerialTerminal {
    constructor(width = 80, height = 24) {
        this.width = width;
        this.height = height;
        this.reset();
    }

    reset() {
        this.cells = new Array(this.width * this.height).fill(32); // spaces
        this.row = 0;
        this.col = 0;
        // Escape parser state: null (idle), 'esc' (saw ESC), 'csi' (saw ESC [).
        this.esc = null;
        this.csi = '';
    }

    // One byte from the UART. The escape state machine is checked first so a
    // parameter byte can never be mistaken for a printable character.
    writeByte(byte) {
        const b = byte & 0xFF;

        if (this.esc === 'esc') {
            if (b === 0x5B) {                 // '['
                this.esc = 'csi';
                this.csi = '';
            } else {
                this.esc = null;              // not a CSI: drop ESC and this byte
            }
            return;
        }
        if (this.esc === 'csi') {
            if (b >= 0x40 && b <= 0x7E) {     // a final byte ends the sequence
                this.applyCsi(this.csi, String.fromCharCode(b));
                this.esc = null;
            } else if (this.csi.length < 16) {
                this.csi += String.fromCharCode(b);
            } else {
                this.esc = null;              // runaway sequence: give up
            }
            return;
        }

        if (b === 0x1B) { this.esc = 'esc'; return; }

        switch (b) {
            case 0x0D: this.col = 0; return;          // CR
            case 0x0A: this.lineFeed(); return;       // LF
            case 0x08: if (this.col > 0) this.col--; return;   // BS
            case 0x09: this.tab(); return;            // TAB
            default:
                if (b >= 0x20 && b <= 0x7E) this.putChar(b);
                // every other control byte is ignored
        }
    }

    writeBytes(bytes) {
        if (!bytes) return;
        for (let i = 0; i < bytes.length; i++) this.writeByte(bytes[i]);
    }

    applyCsi(params, final) {
        if (final === 'J') this.clear();            // ESC[2J and friends
        else if (final === 'H' || final === 'f') {  // home / position: homes only
            this.row = 0;
            this.col = 0;
        }
        // anything else: consumed and ignored
    }

    clear() {
        this.cells.fill(32);
        this.row = 0;
        this.col = 0;
    }

    lineFeed() {
        this.row++;
        if (this.row >= this.height) {
            this.scroll();
            this.row = this.height - 1;
        }
    }

    scroll() {
        this.cells.copyWithin(0, this.width);       // drop row 0
        this.cells.fill(32, (this.height - 1) * this.width);
    }

    putChar(code) {
        // Deferred wrap: the cursor may rest one past the last column, and the
        // next character wraps. Matches a real terminal closely enough for a REPL.
        if (this.col >= this.width) {
            this.col = 0;
            this.lineFeed();
        }
        this.cells[this.row * this.width + this.col] = code & 0xFF;
        this.col++;
    }

    tab() {
        const next = (Math.floor(this.col / 8) + 1) * 8;
        if (next >= this.width) { this.col = 0; this.lineFeed(); }
        else this.col = next;
    }

    // --- read side, for the view ---

    charAt(index) {
        return (index >= 0 && index < this.cells.length) ? this.cells[index] : 32;
    }

    cellCount() {
        return this.cells.length;
    }

    // Pending wrap means the cursor visually sits on the last cell of the row.
    cursorIndex() {
        const col = Math.min(this.col, this.width - 1);
        return this.row * this.width + col;
    }

    // Rows as strings, spaces kept - for tests and quick inspection.
    text() {
        const rows = [];
        for (let r = 0; r < this.height; r++) {
            rows.push(String.fromCharCode(...this.cells.slice(r * this.width, (r + 1) * this.width)));
        }
        return rows;
    }
}
