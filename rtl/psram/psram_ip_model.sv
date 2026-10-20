// psram_ip_model - behavioural model of the Gowin PSRAM HS IP user interface.
//
// Mirrors the IPUG943 contract the bridge relies on:
//   - addr is a word address in 4-byte units; a burst-16 command covers
//     32 bytes = 4 x 64-bit beats
//   - a write presents beat 0 in the command cycle and beats 1..3 on the next
//     three cycles; data_mask is per beat, 1 = masked
//   - a read returns 4 rd_data_valid beats after LATENCY clocks
//   - the first read beat is the low 8 bytes of the 32-byte block
//
// Simulation only (Verilator); the board uses the generated IP netlist.
module psram_ip_model #(
  parameter int LATENCY = 6,
  parameter int BLOCKS  = 4096        // 32-byte blocks = 128 KiB
) (
  input  logic        clk,
  input  logic        rst_n,
  input  logic [20:0] addr,
  input  logic        cmd,
  input  logic        cmd_en,
  input  logic [63:0] wr_data,
  input  logic [7:0]  mask,
  output logic [63:0] rd_data,
  output logic        rd_valid
);
  localparam logic [2:0] S_IDLE = 3'd0, S_RDLAT = 3'd1, S_WBEAT = 3'd2,
                         S_APPLY = 3'd3, S_RBEAT = 3'd4;

  logic [2:0]   st;
  logic [20:0]  a;
  logic [1:0]   beat;
  logic [5:0]   t;
  logic [255:0] wbuf;
  logic [31:0]  wmask;

  logic [255:0] mem [0:BLOCKS-1];

  wire [11:0] blk = a[14:3];   // 4096 blocks x 32 B

  always_ff @(posedge clk) begin
    rd_valid <= 1'b0;
    if (!rst_n) begin
      st <= S_IDLE; beat <= 2'd0; t <= 6'd0; wbuf <= '0; wmask <= '1;
      rd_data <= 64'd0;
    end else begin
      case (st)
        S_IDLE: if (cmd_en) begin
          a <= addr; t <= 6'd0; beat <= 2'd0;
          if (cmd) begin
            wbuf  <= '0;
            wmask <= '1;
            wbuf[63:0]  <= wr_data;      // beat 0 arrives with the command
            wmask[7:0]  <= mask;
            beat  <= 2'd1;
            st    <= S_WBEAT;
          end else begin
            st <= S_RDLAT;
          end
        end

        S_RDLAT: begin
          if (t == 6'(LATENCY-1)) begin st <= S_RBEAT; beat <= 2'd0; end
          t <= t + 6'd1;
        end

        S_WBEAT: begin
          wbuf[beat*64 +: 64] <= wr_data;
          wmask[beat*8 +: 8]  <= mask;
          if (beat == 2'd3) st <= S_APPLY;
          beat <= beat + 2'd1;
        end

        S_APPLY: begin
          for (int b = 0; b < 32; b++)
            if (!wmask[b]) mem[blk][b*8 +: 8] <= wbuf[b*8 +: 8];
          st <= S_IDLE;
        end

        S_RBEAT: begin
          rd_data  <= mem[blk][beat*64 +: 64];
          rd_valid <= 1'b1;
          if (beat == 2'd3) begin beat <= 2'd0; st <= S_IDLE; end
          else beat <= beat + 2'd1;
        end

        default: st <= S_IDLE;
      endcase
    end
  end
endmodule
