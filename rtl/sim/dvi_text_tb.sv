// dvi_text_tb - Verilator test for the DVI text renderer's terminal side.
//
// The Gowin PHY (rPLL, OSER10, ELVDS) cannot be simulated, but everything that
// decides what appears on screen can: the UART receiver, the ANSI parser, the
// packed cell memory and the pixel pipeline. The wrapper exposes x/y and three
// cell words for the C++ test.
module dvi_text_tb (
  input  logic       clk,
  input  logic       rst,
  input  logic       uart_rx,
  output logic [7:0] red,
  output logic [7:0] green,
  output logic [7:0] blue,
  output logic       hsync,
  output logic       vsync,
  output logic       de,
  output logic [9:0] dbg_x,
  output logic [9:0] dbg_y,
  output logic [15:0] dbg_cell0,
  output logic [15:0] dbg_cell40,
  output logic [15:0] dbg_cell164,
  output logic [4:0]  dbg_row,
  output logic [6:0]  dbg_col,
  output logic [1:0]  dbg_esc,
  output logic        dbg_busy,
  output logic [2:0]  dbg_fifo
);
  dvi_text u_text (
    .clk    (clk),
    .rst    (rst),
    .uart_rx(uart_rx),
    .red    (red),
    .green  (green),
    .blue   (blue),
    .hsync  (hsync),
    .vsync  (vsync),
    .de     (de)
  );

  assign dbg_x = u_text.x;
  assign dbg_y = u_text.y;
  assign dbg_cell0   = u_text.cells[0];
  assign dbg_cell40  = u_text.cells[40];
  assign dbg_cell164 = u_text.cells[164];
  assign dbg_row  = u_text.cur_row;
  assign dbg_col  = u_text.cur_col;
  assign dbg_esc  = u_text.esc_state;
  assign dbg_busy = u_text.clear_active || u_text.scroll_active;
  assign dbg_fifo = u_text.fifo_count;

endmodule
