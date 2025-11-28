import initDefault, {init, reset, load_program, set_segments, run_steps, get_memory_slice, get_segments, get_registers} from '../wasm/pkg/deep16_wasm.js';
import fs from 'fs';
import vm from 'node:vm';
global.window = {};

const assemblerCode = fs.readFileSync('./js/deep16_assembler.js','utf8');
vm.runInThisContext(assemblerCode);
const asm = new Deep16Assembler();
const src = fs.readFileSync('./asm/fibonacci.a16','utf8');
  const res = asm.assemble(src);
  if(!res.success){
    console.log('assemble failed', res.errors);
    process.exit(1);
  }
  // Debug: show assembled listing around 0x0100
  const listing = res.listing || [];
  const around = listing.filter(it => it.address >= 0x0100 && it.address < 0x0120);
  console.log('listing 0x0100..0x011F');
  for(const it of around){
    const instr = it.instruction !== undefined ? it.instruction.toString(16).padStart(4,'0') : '----';
    console.log(`0x${it.address.toString(16).padStart(4,'0')}  ${instr}  ${it.line || ''}`);
  }

async function main(){
  await initDefault({ module_or_path: new WebAssembly.Module(fs.readFileSync('./wasm/pkg/deep16_wasm_bg.wasm')) });
  init(1048576);
  for(const ch of res.memoryChanges){
    load_program(ch.address, new Uint16Array([ch.value]));
  }
  // Let the autoload ROM run to set segments and jump to program
  for(let i=0;i<20000;i++){
    if(!run_steps(200)) break;
  }
  console.log('regs', Array.from(get_registers()).map(v=>v.toString(16)));
  const slice = Array.from(get_memory_slice(0x0200, 16)).map(v=>v.toString(16));
  console.log('mem[0x200..]', slice);
  console.log('segs', Array.from(get_segments()).map(x=>x.toString(16)));

  // Now test ALU2/Shift execution in WASM
  reset();
  init(1048576);
  const srcShift = `\.org 0x0100\nLDI 0x4001\nMOV R1, R0\nSL R1, 1\nSLC R1, 1\nSR R1, 2\nSRA R1, 1\nROL R1, 4\nROR R1, 4\nHALT\n`;
  const resShift = asm.assemble(srcShift);
  for(const ch of resShift.memoryChanges){
    load_program(ch.address, new Uint16Array([ch.value]));
  }
  for(let i=0;i<2000;i++){
    if(!run_steps(50)) break;
  }
  const regs2 = Array.from(get_registers()).map(v=>v & 0xFFFF);
  console.log('shift regs R1=', regs2[1].toString(16), 'PSW=', regs2);
}

main();

// Additional assembler/disassembler validation for ALU2 shift/rotate
try {
  const disCode = fs.readFileSync('./js/deep16_disassembler.js','utf8');
  vm.runInThisContext(disCode);
  const dis = new Deep16Disassembler();
  const src2 = `\.org 0x0100\n`
    + `SL R1, 1\nSLA R1, 1\nSLAC R1, 2\nSLC R1, 3\n`
    + `SR R1, 1\nSRC R1, 2\nSRA R1, 1\nSRAC R1, 2\n`
    + `ROL R1, 4\nRLC R1, 5\nROR R1, 4\nRRC R1, 5\n`
    + `ADD R2, 3\nAND R2, R3\nTBS R2, 7\nTBC R2, 6\n`
    + `MUL R4, R5\nDIV R6, R7\nMUL32 R9, R10\nDIV32 R11, R12\n`;
  const res2 = asm.assemble(src2);
  if(!res2.success){
    console.log('assemble2 failed', res2.errors);
  } else {
    console.log('ALU2/Shift encode+disassemble check:');
    for(const it of res2.listing){
      if(it.instruction !== undefined){
        const w = it.instruction & 0xFFFF;
        const txt = dis.disassemble(w);
        console.log(`0x${it.address.toString(16).padStart(4,'0')}  0x${w.toString(16).padStart(4,'0')}  ${txt}`);
      }
    }
  }
} catch(err){
  console.log('disassembler test error', err);
}
