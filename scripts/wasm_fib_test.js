import initDefault, {init, load_program, set_segments, run_steps, get_memory_slice, get_segments, get_registers} from '../wasm/pkg/deep16_wasm.js';
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
}

main();
