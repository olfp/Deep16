// core3_pole_bench_tb.cpp - run the Pole road renderer on the D16nano core
// and report the cycle and instruction counts.
//
// The program image is a $readmemh file (one hex word per line, with @ADDR
// marks), the same format the Verilog $readmemh uses. Usage:
//
//   core3_pole_bench_tb <image.hex> [dump-file] [max-cycles]
//
// The harness prints one line per run:
//
//   CYCLES <cycles> INSTR <instructions> HALT <0|1>
//
// With a dump file it also writes the visible map and the OAM, so the caller
// can check the result against the host model.
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <string>
#include "Vcore3_pole_bench_tb.h"
#include "Vcore3_pole_bench_tb___024root.h"
#include "verilated.h"

namespace {

constexpr uint32_t MEM_WORDS = 0x100000;

Vcore3_pole_bench_tb* top = nullptr;

// The public memory array of the testbench.
inline uint16_t& memWord(uint32_t addr) {
  return top->rootp->core3_pole_bench_tb__DOT__mem[addr];
}

void tick() {
  top->clk = 0;
  top->eval();
  top->clk = 1;
  top->eval();
}

// The boot ROM, the same ten words the behavioural cores use: it zeroes
// DS/SS, builds the entry point 0x0100 in R1 and jumps to CS:R1.
const uint16_t BOOT_ROM[] = {
  0x0000,  // LDI 0          -> R0 = 0
  0xFF41,  // MVS DS, R0     -> flat data addressing
  0xFF42,  // MVS SS, R0     -> the stack sits at physical 0x0000
  0xFC21,  // LSI R1, 1
  0xD818,  // ROL R1, 8      -> R1 = 0x0100, the entry point
  0xA200,  // ST R1, [R0+0]  -> the breadcrumb at 0x0000
  0xA201,  // ST R1, [R0+1]
  0xA202,  // ST R1, [R0+2]
  0xFFE0,  // JML R0         -> CS = 0, PC = 0x0100
  0xFFF0,  // NOP (delay slot)
};

// Load a $readmemh style image. Returns false if the file cannot be read.
bool loadImage(const char* path) {
  std::ifstream in(path);
  if (!in) {
    std::printf("FAIL cannot open the image file %s\n", path);
    return false;
  }
  uint32_t addr = 0;
  std::string token;
  while (in >> token) {
    if (token.empty()) continue;
    if (token[0] == '@') {
      addr = static_cast<uint32_t>(std::strtoul(token.c_str() + 1, nullptr, 16));
      continue;
    }
    if (token[0] == '/' || token[0] == '#') {
      std::string rest;
      std::getline(in, rest);
      continue;
    }
    const uint32_t word = static_cast<uint32_t>(std::strtoul(token.c_str(), nullptr, 16));
    if (addr < MEM_WORDS) memWord(addr) = static_cast<uint16_t>(word & 0xFFFF);
    addr++;
  }
  return true;
}

// The visible map and the OAM, so the caller can check the result against the
// host model. The map is 80x24 cells at 0xF1000 with a stride of 82 words;
// the OAM is 16 words at 0xF6000.
bool dumpRender(const char* path) {
  std::ofstream out(path);
  if (!out) {
    std::printf("FAIL cannot write %s\n", path);
    return false;
  }
  out << "CELLS 1920 OAM 16\n";
  for (int row = 0; row < 24; row++) {
    for (int col = 0; col < 80; col++) {
      const uint32_t addr = 0xF1000u + row * 82u + col;
      out << std::hex << memWord(addr) << "\n";
    }
  }
  for (int i = 0; i < 16; i++) out << std::hex << memWord(0xF6000u + i) << "\n";
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  if (argc < 2) {
    std::printf("usage: %s <image.hex> [dump-file] [max-cycles]\n", argv[0]);
    return 2;
  }
  const char* dumpPath = (argc > 2 && argv[2][0] != '\0') ? argv[2] : nullptr;
  const long maxCycles = (argc > 3) ? std::strtol(argv[3], nullptr, 10) : 20000000L;

  top = new Vcore3_pole_bench_tb;
  top->clk = 0;
  top->rst = 1;
  // The reset is synchronous: it needs clock edges, not just an assignment.
  for (int i = 0; i < 8; i++) tick();

  // Fill the memory, install the boot ROM, then load the program.
  for (uint32_t i = 0; i < MEM_WORDS; i++) memWord(i) = 0xFFFF;
  for (size_t i = 0; i < sizeof(BOOT_ROM) / sizeof(BOOT_ROM[0]); i++) {
    memWord(0xFFFF0 + i) = BOOT_ROM[i];
  }
  if (!loadImage(argv[1])) {
    delete top;
    return 2;
  }

  // Release the reset and run until the program halts.
  top->rst = 0;
  long cycles = 0;
  while (cycles < maxCycles && !top->o_halt) {
    tick();
    cycles++;
  }
  if (top->o_halt) tick();  // let the halt land in the counters

  std::printf("CYCLES %u INSTR %u HALT %d\n",
              static_cast<unsigned>(top->o_cycle_count),
              static_cast<unsigned>(top->o_instr_count),
              static_cast<int>(top->o_halt));
  if (!top->o_halt) {
    std::printf("FAIL the cycle cap of %ld was reached\n", maxCycles);
    delete top;
    return 1;
  }
  if (dumpPath && !dumpRender(dumpPath)) {
    delete top;
    return 1;
  }
  delete top;
  return 0;
}
