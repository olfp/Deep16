const fs = require('fs');

// Read the assembler file and evaluate it
const assemblerCode = fs.readFileSync('./js/deep16_assembler.js', 'utf8');
eval(assemblerCode);

// Create assembler instance
const assembler = new Deep16Assembler();

// Read test file
const source = fs.readFileSync('test_bios_minimal.asm', 'utf8');

// Test assembly
assembler.assemble(source, {
  includeResolver: (filename, parentPath) => {
    throw new Error('File not found: ' + filename);
  }
}).then(result => {
  if (result.success) {
    console.log('Assembly successful');
  } else {
    console.log('Assembly failed:');
    result.errors.forEach(error => console.log('  ' + error));
  }
}).catch(err => {
  console.log('Error:', err.message);
});