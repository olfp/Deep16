// boot_spi_read - read one 32-bit word from the config flash at 1 MB.
//
// The boot image moved off the on-die FLASH608K to the external P25Q32U, so
// the loader reuses the already-present SPI master instead of a dedicated
// 68-LUT on-die read controller. One word is a mode-0 0x03 read:
//
//   CS low, 0x03, 24-bit byte address, 4 data bytes, CS high
//
// The address is a 32-bit word index into the packed boot image; the flash
// byte address is BASE + (addr << 2). The SPI master is at the same 6.75 MHz
// CPU clock, DIV=0 (SCK 3.375 MHz), so one word is eight bytes and about
// 128 clocks. The sequencer is in the CPU clock domain and only runs while
// the core is held in reset.
module boot_spi_read #(
  parameter logic [23:0] BASE = 24'h100000
) (
  input  logic        clk,
  input  logic        rst,
  input  logic        start,      // one pulse from the loader
  input  logic [14:0] addr,       // 32-bit word index
  output logic [31:0] rdata,
  output logic        busy,
  output logic        done,

  // the shared SPI master (driven directly while boot_active)
  output logic        spi_we,
  output logic [3:0]  spi_addr,
  output logic [15:0] spi_wdata,
  input  logic [15:0] spi_rdata
);
  localparam logic [2:0]
    S_IDLE = 3'd0,
    S_CS   = 3'd1, S_CS_W = 3'd2,
    S_SEND = 3'd3, S_WAIT = 3'd4, S_GET = 3'd5,
    S_DONE = 3'd6;

  logic [2:0]  st;
  logic [23:0] byte_addr;
  logic [2:0]  idx;            // 0 command, 1..3 address, 4..7 data
  logic [31:0] rx;

  assign busy = (st != S_IDLE);

  // Byte to transmit, MSB first: command, three address bytes, four 0xFF reads.
  always_comb begin
    case (idx)
      3'd0: spi_wdata = 16'h0003;
      3'd1: spi_wdata = {8'h00, byte_addr[23:16]};
      3'd2: spi_wdata = {8'h00, byte_addr[15:8]};
      3'd3: spi_wdata = {8'h00, byte_addr[7:0]};
      default: spi_wdata = 16'h00FF;
    endcase
    spi_addr = 4'h4;
    spi_we   = 1'b0;
    case (st)
      S_CS:   begin spi_addr = 4'h0; spi_wdata = 16'h0002; spi_we = 1'b1; end
      S_SEND: spi_we = 1'b1;
      S_WAIT: spi_addr = 4'h2;
      S_GET:  spi_addr = 4'h4;
      S_DONE: begin spi_addr = 4'h0; spi_wdata = 16'h0000; spi_we = 1'b1; end
      default: ;
    endcase
  end

  always_ff @(posedge clk) begin
    done <= 1'b0;
    if (rst) begin
      st <= S_IDLE;
      byte_addr <= 24'd0;
      idx <= 3'd0;
      rx <= 32'd0;
      rdata <= 32'd0;
    end else begin
      case (st)
        S_IDLE: if (start) begin
          byte_addr <= BASE + {7'd0, addr, 2'b00};
          idx <= 3'd0;
          rx <= 32'd0;
          st <= S_CS;
        end
        S_CS: st <= S_CS_W;
        S_CS_W: st <= S_SEND;
        S_SEND: st <= S_WAIT;
        S_WAIT: if (spi_rdata[1]) st <= S_GET;   // STATUS.done
        S_GET: begin
          // The first four transfers are command/address; the last four are
          // the little-endian image bytes.
          if (idx >= 3'd4)
            rx <= (rx >> 8) | ({24'd0, spi_rdata[7:0]} << 24);
          if (idx == 3'd7) begin
            rdata <= (rx >> 8) | ({24'd0, spi_rdata[7:0]} << 24);
            st <= S_DONE;
          end else begin
            idx <= idx + 3'd1;
            st <= S_SEND;
          end
        end
        S_DONE: begin
          done <= 1'b1;       // CS is deasserted in this cycle
          st <= S_IDLE;
        end
        default: st <= S_IDLE;
      endcase
    end
  end
endmodule
