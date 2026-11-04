const fs = require('fs');
const path = require('path');
const Deep16Assembler = require('./js/deep16_assembler.js');

async function build() {
    console.log("Building ROM from asm/deep16_rom.asm...");
    
    const assembler = new Deep16Assembler();
    const sourcePath = path.resolve('asm/deep16_rom.asm');
    const source = fs.readFileSync(sourcePath, 'utf-8');
    
    const result = await assembler.assemble(source, {
        fileWriter: (filename, data) => {
            console.log(`Writing binary to ${filename} (${data.length} bytes)`);
            fs.writeFileSync(filename, data);
        }
    });
    
    if (result.success) {
        console.log("Assembly successful!");
        console.log("Symbols:");
        for (const [label, addr] of Object.entries(result.symbols)) {
            if (addr >= 0xF8000 && addr <= 0xF8FFF) {
                 console.log(`  ${label}: 0x${addr.toString(16)} (Offset: 0x${(addr & 0xFFFF).toString(16)})`);
            }
        }
        verifyRom();
    } else {
        console.error("Assembly failed:", result.errors);
        process.exit(1);
    }
}

function verifyRom() {
    console.log("Verifying ROM content...");
    const romPath = 'deep16_rom.bin';
    if (!fs.existsSync(romPath)) {
        console.error("ROM file not found!");
        return;
    }
    
    const buffer = fs.readFileSync(romPath);
    const magic = buffer.slice(0, 10).toString();
    if (magic !== 'DeepSeek16') {
        console.error("Invalid magic:", magic);
        return;
    }
    
    const versionMajor = buffer[10];
    const versionMinor = buffer[11];
    console.log(`Binary Format Version: ${versionMajor}.${versionMinor}`);
    
    // Header 15 bytes
    let offset = 15;
    const addrLen = (versionMajor >= 2) ? 4 : 2;
    let foundStartup = false;
    
    // Buffer[14] is segment count
    const segmentCount = buffer[14];
    console.log(`Segment Count: ${segmentCount}`);
    
    for (let i = 0; i < segmentCount; i++) {
        if (offset >= buffer.length) break;
        
        const type = buffer[offset];
        offset++;
        
        let addr = 0;
        if (addrLen === 4) {
            addr = buffer.readUInt32BE(offset);
            offset += 4;
        } else {
            addr = buffer.readUInt16BE(offset);
            offset += 2;
        }
        
        const len = buffer.readUInt16BE(offset); // Length in words
        offset += 2;
        
        console.log(`Segment ${i}: Type=${type}, Address=0x${addr.toString(16)}, Length=${len} words`);
        
        if (addr === 0xFFFF0) {
            foundStartup = true;
            console.log("Found startup segment!");
            
            // Verify first few words are valid instructions (non-zero or specific pattern if stable)
            for (let j = 0; j < Math.min(len, 4); j++) {
                const w = buffer.readUInt16BE(offset + j * 2);
                console.log(`  Word ${j}: 0x${w.toString(16).padStart(4, '0')}`);
            }
        }
        
        offset += len * 2;
    }
    
    if (foundStartup) {
        console.log("Startup ROM segment verified.");
    } else {
        console.error("Startup ROM segment MISSING!");
    }
}

build();
