// flash608k_model - behavioural model of Gowin's FLASH608K user flash.
//
// 304 rows x 64 columns x 32 bits = 76 KB, word address = row*64 + column.
// Page erase is 2,048 bytes (eight rows); program is one 32-bit word. The
// controller handles the real timing; this model only changes state on the
// rising edge of PROG/ERASE, so it can be used by the installer test as well
// as by the boot loader.
//
// Define FLASH_PRELOAD to fill it from image.flash.hex (the boot-loader test).
module flash608k_model (
  input  logic        clk,
  input  logic [8:0]  XADR,
  input  logic [5:0]  YADR,
  input  logic        XE,
  input  logic        YE,
  input  logic        SE,
  input  logic        ERASE,
  input  logic        PROG,
  input  logic        NVSTR,
  input  logic [31:0] DIN,
  output logic [31:0] DOUT
);
  localparam int ROWS = 304;
  localparam int COLS = 64;
  localparam int WORDS = ROWS * COLS;

  logic [31:0] mem [0:WORDS-1];
  logic        ye_q, nvstr_q;

  integer i, j;
  initial begin
    for (i = 0; i < WORDS; i++) mem[i] = 32'hFFFFFFFF;
`ifdef FLASH_PRELOAD
    $readmemh("image.flash.hex", mem);
`endif
  end

  wire [14:0] addr = {XADR, 6'b000000} | {9'b0, YADR};

  assign DOUT = mem[addr];

  // The Gowin primitive writes on the YE pulse (PROG and NVSTR already high)
  // and erases on NVSTR rising while ERASE is asserted. This model changes the
  // array at those edges; the controller owns the microseconds.
  always_ff @(posedge clk) begin
    ye_q    <= YE;
    nvstr_q <= NVSTR;
    if (YE && !ye_q && PROG && NVSTR && !SE && XE) mem[addr] <= DIN;
    if (NVSTR && !nvstr_q && ERASE && !YE && XE) begin
      // One page = XADR[8:3], eight rows of 64 words.
      for (j = 0; j < 8 * COLS; j++)
        mem[{XADR[8:3], 3'b000} * COLS + j] <= 32'hFFFFFFFF;
    end
  end
endmodule
