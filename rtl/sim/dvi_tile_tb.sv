// dvi_tile_tb - Verilator wrapper for the CPU-driven tile console.
//
// The board synchronises the CPU's tile/control writes into the pixel domain;
// for the renderer test the wrapper drives that port directly. No UART parser
// remains in dvi_tile.
module dvi_tile_tb (
  input  logic        clk,
  input  logic        rst,
  input  logic        cpu_we,
  input  logic        cpu_ctrl,
  input  logic [1:0]  cpu_tgt,
  input  logic [11:0] cpu_addr,
  input  logic [15:0] cpu_data,
  output logic [7:0]  red,
  output logic [7:0]  green,
  output logic [7:0]  blue,
  output logic        hsync,
  output logic        vsync,
  output logic        de,
  output logic [11:0] dbg_x,
  output logic [9:0]  dbg_y,
  output logic [15:0] dbg_cell0,
  output logic [15:0] dbg_cell40,
  output logic [4:0]  dbg_row,
  output logic [6:0]  dbg_col,
  output logic [4:0]  dbg_row_off,
  output logic [3:0]  dbg_scroll_x,
  output logic [4:0]  dbg_scroll_y,
  output logic [3:0]  dbg_fill,
  input  logic [11:0] dbg_addr,
  output logic [15:0] dbg_cell
);
  // The functional sim runs both sides from one clock. The hardware ratio is
  // 25.5 MHz render / 74.25 MHz pixel; here the render line is stretched to
  // 3300 clocks so one render line is exactly two 1650-clock output lines.
  dvi_tile #(.R_H_TOTAL(3300), .R_V_TOTAL(375)) u_tile (
    .clk_render (clk),
    .clk_pixel  (clk),
    .rst_render (rst),
    .rst_pixel  (rst),
    .cpu_we   (cpu_we),
    .cpu_ctrl (cpu_ctrl),
    .cpu_tgt  (cpu_tgt),
    .cpu_addr (cpu_addr),
    .cpu_data (cpu_data),
    .red      (red),
    .green    (green),
    .blue     (blue),
    .hsync    (hsync),
    .vsync    (vsync),
    .de       (de)
  );

  assign dbg_x       = u_tile.sx;
  assign dbg_y       = u_tile.sy;
  assign dbg_cell0   = u_tile.tilemap[0];
  assign dbg_cell40  = u_tile.tilemap[40];
  assign dbg_row     = u_tile.cur_row;
  assign dbg_col     = u_tile.cur_col;
  assign dbg_row_off = u_tile.row_off;
  assign dbg_scroll_x = u_tile.scroll_x;
  assign dbg_scroll_y = u_tile.scroll_y;
  assign dbg_fill    = u_tile.fstate;
  assign dbg_cell    = u_tile.tilemap[dbg_addr];

endmodule
