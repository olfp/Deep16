import fs from 'fs';
import vm from 'node:vm';
global.window = {};

// Load assembler and simulator
vm.runInThisContext(fs.readFileSync('./js/deep16_assembler.js','utf8'));
vm.runInThisContext(fs.readFileSync('./js/deep16_simulator.js','utf8'));

// Assemble forth kernel
const asm = new Deep16Assembler();
const src = fs.readFileSync('./asm/forth.asm','utf8');
const res = asm.assemble(src);
if(!res.success){
  console.error('Assemble failed', res.errors);
  try{
    for(const err of res.errors){
      const m = err.match(/Line\s+(\d+)/);
      if(m){
        const ln = parseInt(m[1],10);
        const lines = src.split('\n');
        const ctxStart = Math.max(1, ln-3);
        const ctxEnd = Math.min(lines.length, ln+3);
        console.error(`Context for line ${ln}:`);
        for(let i=ctxStart;i<=ctxEnd;i++){
          console.error(`${i}: ${lines[i-1]}`);
        }
      }
    }
  }catch{}
  process.exit(1);
}

// Build memory image
const mem = new Array(1048576).fill(0xFFFF);
for(const ch of res.memoryChanges){
  mem[ch.address] = ch.value & 0xFFFF;
}

// Init simulator
const sim = new Deep16Simulator();
sim.loadProgram(mem);
// Flat segments; program will set ES to 0xF000 and SCR to 0x1000
sim.segmentRegisters.CS = 0x0000;
sim.segmentRegisters.DS = 0x0000;
sim.segmentRegisters.SS = 0x0000;
sim.segmentRegisters.ES = 0x0000;
sim.registers[15] = 0x0100; // entry at .org 0x0100
sim.running = true;

// Helper: step N cycles
function stepN(n){
  for(let i=0;i<n;i++){ if(!sim.step()) break; }
}

// Run a bit to print greeting and reach input loop
stepN(5000);
console.log('State after warmup:', { PC: sim.registers[15].toString(16), CS: sim.segmentRegisters.CS.toString(16), ES: sim.segmentRegisters.ES.toString(16), PSW: sim.psw.toString(16) });
// Step more to reach prompt
stepN(15000);

// Enqueue input: "3 4 + ." and Enter
const input = ['3',' ','4',' ','+',' ','.','\n'];
for(const ch of input){
  if(ch === '\n') sim.enqueueKeyCode(10);
  else sim.enqueueKeyCode(ch.charCodeAt(0));
}

// Step while processing input and printing result and ok/prompt
stepN(300000);
console.log('Registers TIB, >IN:', { TIB: (sim.registers[6] & 0xFFFF).toString(16), IN: (sim.registers[5] & 0xFFFF).toString(16) });
console.log('Final state:', { PC: sim.registers[15].toString(16), CS: sim.segmentRegisters.CS.toString(16), ES: sim.segmentRegisters.ES.toString(16), PSW: sim.psw.toString(16) });

// Inspect first 5 lines immediately
const base = 0xF1000;
const width = 80;
const height = 25;
function readChar(pa){
  const w = sim.memory[pa] & 0xFFFF;
  const ch = w & 0x00FF;
  return String.fromCharCode(ch);
}
const lines = [];
for(let row=0; row<5; row++){
  let s = '';
  for(let col=0; col<width; col++){
    const pa = base + row*width + col;
    s += readChar(pa);
  }
  lines.push(s);
}
console.log('Top 5 lines:');
for(const s of lines) console.log(s);
const joined = lines.join('\n');
const hasHello = joined.includes('Hello DeepForth!');
const hasResult = joined.includes(' 7 ');
const hasOk = joined.includes(' ok');
console.log('Checks:', { hasHello, hasResult, hasOk });

// Dump TIB buffer (first 64 words at physical DS:TIB)
const tibPhys = (sim.segmentRegisters.DS << 4) + (sim.registers[6] & 0xFFFF);
let tibDump = '';
for(let i=0;i<64;i++){
  const w = sim.memory[tibPhys + i] & 0xFFFF;
  const chCode = w & 0x00FF;
  tibDump += String.fromCharCode(chCode);
}
console.log('TIB dump (64 chars):', tibDump);
