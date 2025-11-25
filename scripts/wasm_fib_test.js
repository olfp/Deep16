import initDefault, {init, load_program, set_segments, run_steps, get_memory_slice, get_segments} from '../wasm/pkg/deep16_wasm.js';
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

async function main(){
  await initDefault({ module_or_path: new WebAssembly.Module(fs.readFileSync('./wasm/pkg/deep16_wasm_bg.wasm')) });
  init(1048576);
  for(const ch of res.memoryChanges){
    load_program(ch.address, new Uint16Array([ch.value]));
  }
  set_segments(0x0000, 0x0000, 0x0000, 0x2000);
  for(let i=0;i<20000;i++){
    if(!run_steps(200)) break;
  }
  const slice = Array.from(get_memory_slice(0x0200, 16)).map(v=>v.toString(16));
  console.log('mem[0x200..]', slice);
  console.log('segs', Array.from(get_segments()).map(x=>x.toString(16)));
}

main();
