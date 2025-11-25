import fs from 'fs';
import vm from 'node:vm';
global.window = {};

// Load assembler and simulator into Node VM
vm.runInThisContext(fs.readFileSync('./js/deep16_assembler.js','utf8'));
vm.runInThisContext(fs.readFileSync('./js/deep16_simulator.js','utf8'));

const asm = new Deep16Assembler();
const src = fs.readFileSync('./asm/fibonacci.a16','utf8');
const res = asm.assemble(src);
if(!res.success){
  console.log('assemble failed', res.errors);
  process.exit(1);
}

// Build memory array from assembly result
const mem = new Array(1048576).fill(0xFFFF);
for(const ch of res.memoryChanges){
  mem[ch.address] = ch.value & 0xFFFF;
}

const sim = new Deep16Simulator();
sim.loadProgram(mem);
// Ensure segments are zero for flat addressing
sim.segmentRegisters.CS = 0x0000;
sim.segmentRegisters.DS = 0x0000;
sim.segmentRegisters.SS = 0x0000;
sim.segmentRegisters.ES = 0x2000;
sim.registers[15] = 0x0100; // PC
sim.running = true;

let steps = 0;
while(sim.running && steps < 50000){
  sim.step();
  steps++;
}

const slice = [];
for(let i=0;i<16;i++) slice.push(sim.memory[0x0200+i].toString(16));
console.log('JS mem[0x200..]', slice);
console.log('JS segs', sim.segmentRegisters);
console.log('JS regs PC', sim.registers[15].toString(16));
