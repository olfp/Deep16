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

// Enqueue input: "6 7 * ." and Enter
const input = ['6',' ','7',' ','*',' ','.','\n'];
for(const ch of input){
  if(ch === '\n') sim.enqueueKeyCode(10);
  else sim.enqueueKeyCode(ch.charCodeAt(0));
}

// Step while processing input and printing result and ok/prompt
stepN(200000);
console.log('Final state:', { PC: sim.registers[15].toString(16), CS: sim.segmentRegisters.CS.toString(16), ES: sim.segmentRegisters.ES.toString(16), PSW: sim.psw.toString(16) });

// Inspect last few lines of screen memory
const base = 0xF1000;
const width = 80;
const height = 25;
function readChar(pa){
  const w = sim.memory[pa] & 0xFFFF;
  const ch = w & 0x00FF;
  return String.fromCharCode(ch);
}

// Force cursor near end of last line and press Enter to test scroll+ok
sim.registers[8] = 0x1000 + 24*80 + 78;
sim.enqueueKeyCode(10);
stepN(200000);

// Extract visible characters from the first and last 3 lines
const lines = [];
for(let row=0; row<3; row++){
  let s = '';
  for(let col=0; col<width; col++){
    const pa = base + row*width + col;
    s += readChar(pa);
  }
  lines.push(s);
}
lines.push('---');
for(let row=height-3; row<height; row++){
  let s = '';
  for(let col=0; col<width; col++){
    const pa = base + row*width + col;
    s += readChar(pa);
  }
  lines.push(s);
}

console.log('Top 3 lines + separator + last 3 lines:');
for(const s of lines) console.log(s);

// Simple checks: presence of greeting, "42" and " ok"
const joined = lines.join('\n');
const hasHello = joined.includes('Hello DeepForth!');
const hasResult = joined.includes('42');
const hasOk = joined.includes(' ok');
console.log('Checks:', { hasHello, hasResult, hasOk });

// Show current SCR and derived row/col
const SCR = sim.registers[8] & 0xFFFF;
const offset = SCR - 0x1000;
const row = Math.floor(offset / width);
const col = offset % width;
console.log('Cursor:', { SCR: SCR.toString(16), row, col });
const lastRowStart = base + (height-1)*width;
let lastRowHead = '';
for(let col2=0; col2<4; col2++){
  lastRowHead += readChar(lastRowStart + col2);
}
console.log('Last row head:', lastRowHead);

// Mid-row Enter should advance to next line
sim.registers[8] = 0x1000 + 10*80 + 60;
sim.enqueueKeyCode(10);
stepN(120000);
const SCR2 = sim.registers[8] & 0xFFFF;
const offset2 = SCR2 - base;
const row2 = Math.floor(offset2 / width);
const col2 = offset2 % width;
console.log('After mid-row Enter:', { SCR: SCR2.toString(16), row2, col2 });
