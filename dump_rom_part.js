const fs = require('fs');

function parseROM() {
    const buffer = fs.readFileSync('deep16_rom.bin');
    const magic = buffer.slice(0, 10).toString();
    console.log(`Magic: ${magic}`);

    let offset = 10;
    const verMajor = buffer[offset++];
    const verMinor = buffer[offset++];
    const startAddr = (buffer[offset++] << 8) | buffer[offset++];
    const segCount = buffer[offset++];
    
    console.log(`Version: ${verMajor}.${verMinor}`);
    console.log(`Start Addr: 0x${startAddr.toString(16)}`);
    console.log(`Segments: ${segCount}`);

    for (let i = 0; i < segCount; i++) {
        const type = buffer[offset++];
        let addr = 0;
        if (verMajor >= 2) {
            addr = (buffer[offset++] << 24) | (buffer[offset++] << 16) | (buffer[offset++] << 8) | buffer[offset++];
            addr = addr >>> 0;
        } else {
            addr = (buffer[offset++] << 8) | buffer[offset++];
        }
        
        const len = (buffer[offset++] << 8) | buffer[offset++];
        
        console.log(`Segment ${i}: Addr=0x${addr.toString(16)}, Len=${len}, Type=${type}`);
        
        if (addr === 0xF8000) {
            console.log("Found BIOS segment (0xF8000). Inspecting content...");
            
            // Dump around 0x00dd (Loop)
            console.log("--- Loop Area ---");
            let targetOffset = 0x00dd;
            let range = 10;
            for (let j = targetOffset - range; j <= targetOffset + range; j++) {
                if (j >= 0 && j < len) {
                    const word = (buffer[offset + j * 2] << 8) | buffer[offset + j * 2 + 1];
                    const mark = (j === targetOffset) ? ' <--- Loop start' : '';
                    console.log(`  0x${(addr + j).toString(16)} (+0x${j.toString(16)}): 0x${word.toString(16).padStart(4, '0')}${mark}`);
                }
            }
            
            // Dump around 0x0137 (Jump Target)
            console.log("--- Jump Target Area ---");
            targetOffset = 0x0137;
            range = 10;
            for (let j = targetOffset - range; j <= targetOffset + range; j++) {
                if (j >= 0 && j < len) {
                    const word = (buffer[offset + j * 2] << 8) | buffer[offset + j * 2 + 1];
                    const mark = (j === targetOffset) ? ' <--- Target' : '';
                    console.log(`  0x${(addr + j).toString(16)} (+0x${j.toString(16)}): 0x${word.toString(16).padStart(4, '0')}${mark}`);
                }
            }
        }
        
        offset += len * 2;
    }
}

parseROM();
