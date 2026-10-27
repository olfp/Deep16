// spi_tb.cpp - loopback byte transfers, chip selects and the divider.
#include <cstdio>
#include <cstdint>
#include "Vspi_tb.h"
#include "verilated.h"

namespace {
Vspi_tb* top;
int fails = 0;

void tick() {
  // MISO is the same wire as MOSI: mode 0 drives MOSI on the falling edge and
  // samples MISO on the rising edge, so a loopback must return the sent byte.
  top->miso = top->mosi;
  top->clk = 0; top->eval();
  top->miso = top->mosi;
  top->clk = 1; top->eval();
}

void idle(int n) { for (int i = 0; i < n; i++) tick(); }

void write_reg(uint8_t addr, uint16_t value) {
  top->addr = addr; top->wdata = value; top->we = 1; tick();
  top->we = 0; tick();
}

uint16_t read_reg(uint8_t addr) {
  top->addr = addr; top->we = 0; top->eval();
  return (uint16_t)top->rdata;
}

void expect(const char* what, uint16_t got, uint16_t want) {
  if (got != want) {
    std::printf("FAIL %-30s got 0x%04x, want 0x%04x\n", what, got, want);
    fails++;
  }
}

uint8_t transfer(uint8_t byte, int* rising_edges = nullptr) {
  int rises = 0;
  int prev = top->sck;
  top->addr = 0x4; top->wdata = byte; top->we = 1;
  tick();
  if (!prev && top->sck) rises++;
  prev = top->sck;
  top->we = 0;
  tick();
  if (!prev && top->sck) rises++;
  prev = top->sck;
  for (int i = 0; i < 2000 && (read_reg(0x2) & 1); i++) {
    tick();
    if (!prev && top->sck) rises++;
    prev = top->sck;
  }
  if (rising_edges) *rising_edges = rises;
  return (uint8_t)(read_reg(0x4) & 0xff);
}
}  // namespace

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vspi_tb;
  top->clk = 0; top->rst = 1; top->we = 0; top->addr = 0; top->wdata = 0;
  top->miso = 0;
  idle(8);
  top->rst = 0;
  idle(4);

  expect("CTRL reset", read_reg(0x0), 0x0000);
  expect("STATUS reset", read_reg(0x2), 0x0000);
  expect("DIV reset", read_reg(0x6), 0x0000);
  expect("CS all high", top->cs_n, 0x3);

  // CS0 (SD), byte 0xA5, fastest divider.
  write_reg(0x0, 0x0001);
  expect("CS0 asserted", top->cs_n, 0x2);
  int rises = 0;
  expect("first byte", transfer(0xA5, &rises), 0xA5);
  expect("8 rising edges", (uint16_t)rises, 8);
  expect("done after transfer", (read_reg(0x2) >> 1) & 1, 1);
  expect("busy low after transfer", read_reg(0x2) & 1, 0);
  expect("SCK idle low", (uint16_t)top->sck, 0);

  // Second byte with CS0 still asserted.
  expect("second byte", transfer(0x3C), 0x3C);

  // CS1 (external flash), then deassert everything.
  write_reg(0x0, 0x0002);
  expect("CS1 asserted", top->cs_n, 0x1);
  expect("flash byte", transfer(0x5A), 0x5A);
  write_reg(0x0, 0x0000);
  expect("CS all high again", top->cs_n, 0x3);

  // Divider register and a slower transfer.
  write_reg(0x6, 8);
  expect("DIV readback", read_reg(0x6), 8);
  int slow_rises = 0;
  expect("slow byte", transfer(0xC3, &slow_rises), 0xC3);
  expect("slow: 8 rising edges", (uint16_t)slow_rises, 8);

  // Status chip-select field mirrors CTRL.
  write_reg(0x0, 0x0001);
  expect("status CS bits", (read_reg(0x2) >> 2) & 0x3, 1);

  delete top;
  std::printf("%s\n", fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
