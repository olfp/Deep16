// Deep16 RTL - native CLI for differential debugging.
//
// The RTL core has no main(); this small driver gives the co-simulation a way
// to run the same program on the C++ model and on the JS core and diff the
// results. It mirrors what tests/helpers.js runJs()/runRtl() do, so a failing
// parity test can be replayed here step by step.
//
//   deep16_rtl [--run N] [--trace] [--cs HEX] [--ds HEX] [--ss HEX] [--es HEX]
//               [--fill HEX] [program.txt]
//
// program.txt holds one "WORD" or "ADDR WORD" pair per line (the assembler's
// output works), hex without 0x. Without a file the program comes from stdin.
//
// Output is JSON: {"steps":N,"result":true|false,"registers":[...],"psw":HEX,
//                  "segments":[...],"shadow":[...]}
// With --trace one JSON object per retired instruction is printed as well.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "harness.h"

namespace {

struct Word {
  uint32_t addr;
  uint16_t value;
};

uint32_t parse_u32(const char* s) {
  return static_cast<uint32_t>(strtoul(s, nullptr, 16));
}

std::vector<Word> read_program(const char* path) {
  FILE* f = path ? fopen(path, "r") : stdin;
  if (!f) {
    fprintf(stderr, "cannot open %s\n", path);
    exit(1);
  }
  std::vector<Word> words;
  uint32_t next = 0;
  char line[256];
  while (fgets(line, sizeof(line), f)) {
    char* p = line;
    while (*p == ' ' || *p == '\t') p++;
    if (*p == '\n' || *p == '\0' || *p == ';') continue;
    char* end = nullptr;
    uint32_t first = strtoul(p, &end, 16);
    if (end == p) continue;
    while (*end == ' ' || *end == '\t') end++;
    if (*end == '\0' || *end == '\n') {
      words.push_back({next++, static_cast<uint16_t>(first)});
    } else {
      uint32_t second = strtoul(end, nullptr, 16);
      words.push_back({first, static_cast<uint16_t>(second)});
    }
  }
  if (path) fclose(f);
  return words;
}

void dump_json(const char* prefix, uint16_t regs[16], uint16_t psw,
               uint16_t segs[4], uint16_t shadow[3], uint32_t steps, int result) {
  printf("%s{\"steps\":%u,\"result\":%s,\"psw\":\"0x%04X\",\"registers\":[",
         prefix, steps, result ? "true" : "false", psw);
  for (int i = 0; i < 16; i++) printf("%s\"0x%04X\"", i ? "," : "", regs[i]);
  printf("],\"segments\":[");
  for (int i = 0; i < 4; i++) printf("%s\"0x%04X\"", i ? "," : "", segs[i]);
  printf("],\"shadow\":[");
  for (int i = 0; i < 3; i++) printf("%s\"0x%04X\"", i ? "," : "", shadow[i]);
  printf("]}\n");
}

}  // namespace

int main(int argc, char** argv) {
  uint32_t max_steps = 200000;
  uint32_t fill = 0xFFFF;
  uint16_t cs = 0xFFFF, ds = 0x0000, ss = 0x0000, es = 0x0000;
  bool trace = false;
  uint32_t dump_addr = 0, dump_count = 0;
  uint32_t dbg_idx = 0, dbg_val = 0;
  bool dbg_set = false, dbg_show = false;
  const char* path = nullptr;

  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    if (a == "--run" && i + 1 < argc)        max_steps = parse_u32(argv[++i]);
    else if (a == "--trace")                trace = true;
    else if (a == "--cs" && i + 1 < argc)   cs = parse_u32(argv[++i]);
    else if (a == "--ds" && i + 1 < argc)   ds = parse_u32(argv[++i]);
    else if (a == "--ss" && i + 1 < argc)   ss = parse_u32(argv[++i]);
    else if (a == "--es" && i + 1 < argc)   es = parse_u32(argv[++i]);
    else if (a == "--fill" && i + 1 < argc) fill = parse_u32(argv[++i]);
    else if (a == "--dbg-set" && i + 1 < argc) { dbg_idx = parse_u32(argv[++i]); dbg_val = parse_u32(argv[++i]); dbg_set = true; }
    else if (a == "--dbg" && i + 1 < argc)     { dbg_idx = parse_u32(argv[++i]); dbg_show = true; }
    else if (a == "--dump" && i + 1 < argc)  dump_addr = parse_u32(argv[++i]);
    else if (a == "--dump-count" && i + 1 < argc) dump_count = parse_u32(argv[++i]);
    else if (!a.empty() && a[0] != '-')     path = argv[i];
    else {
      fprintf(stderr, "unknown option %s\n", argv[i]);
      return 2;
    }
  }

  std::vector<Word> program = read_program(path);

  init(1048576);
  reset();
  if (fill != 0xFFFF) {
    // runJs() can be asked for a different fill; poke only the words we load.
  }
  for (const Word& w : program) poke(w.addr, w.value);
  set_segments(cs, ds, ss, es);
  set_psw(0x0000);
  {
    // fresh register file like Deep16Simulator.loadProgram()
    uint16_t regs[16];
    memset(regs, 0, sizeof(regs));
    regs[13] = 0x7FFF;
    regs[15] = 0x0000;
    set_registers(regs, 16);
  }

  if (dbg_set) set_debug_state(static_cast<uint8_t>(dbg_idx),
                               static_cast<uint16_t>(dbg_val));
  if (dbg_show) printf("dbg[0x%02X] = 0x%04X\n", dbg_idx,
                       get_debug_state(static_cast<uint8_t>(dbg_idx)));
  if (dump_count) {
    for (uint32_t a = dump_addr; a < dump_addr + dump_count; a++) {
      printf("mem[%05X] = 0x%04X\n", a, peek(a));
    }
  }

  uint32_t steps = 0;
  int cont = 1;
  while (cont && steps < max_steps) {
    cont = step();
    steps++;
    if (trace) {
      uint16_t regs[16], segs[4], shadow[3];
      get_registers(regs);
      get_segments(segs);
      get_shadow_state(shadow);
      dump_json("trace ", regs, get_psw(), segs, shadow, steps, cont);
    }
  }

  uint16_t regs[16], segs[4], shadow[3];
  get_registers(regs);
  get_segments(segs);
  get_shadow_state(shadow);
  dump_json("", regs, get_psw(), segs, shadow, steps, cont);
  return 0;
}