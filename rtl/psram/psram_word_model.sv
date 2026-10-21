// psram_word_model - behavioural model of the open-source controller's word
// interface, for Verilator tests of the bridge.
//
// read/write pulse -> busy for RDLAT (read) or WRLAT (write) clocks; the read
// word appears on dout when busy falls. Address is a byte address.
module psram_word_model #(
  parameter int RDLAT = 12,
  parameter int WRLAT = 7,
  parameter int WORDS = 1 << 20
) (
  input  logic        clk,
  input  logic        rst_n,
  input  logic        read,
  input  logic        write,
  input  logic        burst,      // read/write two words (Deep16 cache fill)
  input  logic [21:0] addr,
  input  logic [15:0] din,
  input  logic [15:0] din2,
  output logic [15:0] dout,
  output logic [15:0] dout2,
  output logic        busy,
  // debug peek (simulation only)
  input  logic [19:0] peek_addr,
  output logic [15:0] peek_data
);
  logic [15:0] mem [0:WORDS-1];
  logic [5:0]  cnt;
  logic        is_wr, is_burst;
  logic [19:0] wa;

  assign peek_data = mem[peek_addr];

  always_ff @(posedge clk) begin
    if (!rst_n) begin
      busy <= 1'b0; cnt <= 6'd0; is_wr <= 1'b0; is_burst <= 1'b0;
      wa <= 20'd0; dout <= 16'd0; dout2 <= 16'd0;
    end else if (!busy) begin
      if (read || write) begin
        busy  <= 1'b1;
        cnt   <= read ? 6'(RDLAT) : 6'(WRLAT);
        is_wr    <= write;
        is_burst <= burst;
        wa       <= addr[20:1];
        if (write) begin
          mem[addr[20:1]] <= din;
          if (burst) mem[addr[20:1] + 20'd1] <= din2;
        end
      end
    end else begin
      if (cnt <= 6'd1) begin
        busy <= 1'b0;
        if (!is_wr) begin
          dout <= mem[wa];
          // A burst returns the line's two words together; with burst low the
          // second word is unused by the bridge.
          if (is_burst) dout2 <= mem[wa + 20'd1];
        end
      end
      cnt <= cnt - 6'd1;
    end
  end
endmodule
