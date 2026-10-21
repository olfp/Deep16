// flash608k_core - the Gowin FLASH608K primitive, or its Verilator model.
//
// The primitive is asynchronous and vendor-specific; the wrapper keeps the
// controller and the installer test on the same pin-level interface.
module flash608k_core (
  input  logic        clk,       // model only; unused on the Gowin primitive
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
`ifdef GOWIN
  FLASH608K u_flash (
    .XADR(XADR), .YADR(YADR),
    .XE(XE), .YE(YE), .SE(SE),
    .ERASE(ERASE), .PROG(PROG), .NVSTR(NVSTR),
    .DIN(DIN), .DOUT(DOUT)
  );
`else
  flash608k_model u_model (
    .clk(clk),
    .XADR(XADR), .YADR(YADR),
    .XE(XE), .YE(YE), .SE(SE),
    .ERASE(ERASE), .PROG(PROG), .NVSTR(NVSTR),
    .DIN(DIN), .DOUT(DOUT)
  );
`endif
endmodule
