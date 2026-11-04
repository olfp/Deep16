const { Deep16Assembler } = require('./js/deep16_assembler.js');

async function testLineInfo() {
    const assembler = new Deep16Assembler();
    
    // Test with a simple source that includes another file
    const testSource = `
; Main file
.org 0x0000
LDI 0x1234
.include "test_include.asm"
LDI 0x5678
`;

    const includeSource = `
; Included file
LDI 0x9ABC
LDI 0xDEF0
`;

    const options = {
        includeResolver: (filename, parentPath) => {
            if (filename === 'test_include.asm') {
                return {
                    content: includeSource,
                    path: '/test/test_include.asm'
                };
            }
            throw new Error(`File not found: ${filename}`);
        }
    };

    try {
        const preprocessed = await assembler.preprocess(testSource, options);
        console.log('Processed source:');
        console.log(preprocessed.source);
        console.log('\nLine info:');
        console.log(preprocessed.lineInfo);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testLineInfo();