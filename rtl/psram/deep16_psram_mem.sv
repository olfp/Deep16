// deep16_psram_mem - the machine's memory, backed by the PSRAM bridge.
//
// Serial, deliberately: one transaction at a time, and the core advances one
// cycle per completed transaction. That is slow (a line hit is a few cycles, a
// miss ~30) but it is correct by construction and needs no cache, no
// speculation and no store buffer. The cache comes later, in front of this.
//
// Order of business each time the core is released:
//   1. a store that is in WB (latched, then written to PSRAM),
//   2. a load in MEM (read, present mem_rdata, release),
//   3. the fetch for the current if_pa (read, present, release).
// Store before load keeps a load-after-store to the same address ordered.
//
// The boot image (from the on-chip BSRAM) is copied into PSRAM first; the core
// is held in reset until that finishes.
module deep16_psram_mem #(
  parameter int IMG_WORDS = 24576
) (
  input  logic        clk_cpu,
  input  logic        rst,
  input  logic        clk_ip,
  input  logic        ctl_dout_valid,   // unused, kept for interface symmetry

  // boot image read port (on-chip BSRAM)
  output logic [14:0] img_addr,
  input  logic [15:0] img_data,

  // core memory interface
  input  logic [20:0] if_addr,
  output logic [15:0] if_rdata,
  output logic        if_preempted,
  input  logic [20:0] mem_addr,
  input  logic        mem_rd,
  output logic [15:0] mem_rdata,
  input  logic        mem_we,
  input  logic [20:0] mem_waddr,
  input  logic [15:0] mem_wdata,
  output logic        mem_stall,
  output logic        boot_done,
  output logic        boot_err,     // a read-back did not match

  // to the controller (clk_ip domain)
  output logic        ctl_read,
  output logic        ctl_write,
  output logic [21:0] ctl_addr,
  output logic [15:0] ctl_din,
  input  logic [15:0] ctl_dout,
  input  logic        ctl_busy
);

  // Boot ROM words (deep16_pkg's BOOT_ROM_PACKED, kept local so this module
  // needs no package function call).
  localparam logic [255:0] BOOT_ROM = 256'hFFF1FFF1FFF1FFF1FFF1FFF1FFF0FFE0A202A201A200D818FC21FF42FF410000;

  // ---- bridge -----------------------------------------------------------
  logic        breq, bwe;
  logic [19:0] baddr;
  logic [15:0] bwdata, brdata;
  logic        bready, bbusy;

  logic init_ok_ctl;

  psram_word_bridge u_bridge (
    .clk_cpu(clk_cpu), .rst_cpu(rst),
    .clk_ctl(clk_ip),  .rst_ctl(rst),
    .req(breq), .we(bwe), .addr(baddr), .wdata(bwdata),
    .rdata(brdata), .ready(bready), .busy(bbusy),
    .ctl_read(ctl_read), .ctl_write(ctl_write),
    .ctl_addr(ctl_addr), .ctl_din(ctl_din), .ctl_dout(ctl_dout), .ctl_busy(ctl_busy),
    .init_ok(init_ok_ctl)
  );

  // init_ok lives in the controller clock domain: synchronise it in
  logic init_m, init_s;
  always_ff @(posedge clk_cpu) begin
    init_m <= init_ok_ctl; init_s <= init_m;
  end

  // ---- sequencer --------------------------------------------------------
  localparam logic [3:0] S_BOOT_WAIT = 4'd0, S_BOOT_RD = 4'd1, S_BOOT_WR = 4'd2,
                         S_BOOT_WT = 4'd3, S_IDLE = 4'd4, S_CMD = 4'd5,
                         S_BOOT_RD2 = 4'd10,
                         S_VER_SET = 4'd12, S_VER_RD = 4'd13, S_VER_WT = 4'd14,
                         S_WAIT = 4'd6, S_PRESENT = 4'd7, S_STORE = 4'd8,
                         S_STORE_W = 4'd9;
  logic [3:0]  st;
  logic [14:0] bi;              // boot image index
  logic        boot_q;
  logic        op_is_load, op_is_store, op_is_fetch;
  logic [19:0] op_addr;
  logic [15:0] op_wdata, rd_q;
  logic        store_lat;
  logic        ver_pending;   // the pending read is a boot verify
  logic [19:0] store_addr;
  logic [15:0] store_data;

  assign boot_done = boot_q;
  assign mem_stall = boot_q ? (st != S_PRESENT) : 1'b1;
  assign if_preempted = !(boot_q && st == S_PRESENT && op_is_fetch && !op_is_load && !op_is_store);
  assign if_rdata = rd_q;
  assign mem_rdata = rd_q;

  always_ff @(posedge clk_cpu) begin
    breq <= 1'b0;
    if (rst) begin
      st <= S_BOOT_WAIT; bi <= 15'd0; boot_q <= 1'b0;
      boot_err <= 1'b0; ver_pending <= 1'b0;
      op_is_load <= 0; op_is_store <= 0; op_is_fetch <= 0;
      op_addr <= 20'd0; op_wdata <= 16'd0; rd_q <= 16'd0;
      store_lat <= 0; store_addr <= 20'd0; store_data <= 16'd0;
      img_addr <= 15'd0;
    end else begin
      case (st)
        // ---- boot image -> PSRAM ---------------------------------------
        S_BOOT_WAIT: if (init_s) begin
          img_addr <= bi;                    // image read has 1-cycle latency
          st <= S_BOOT_RD;
        end
        S_BOOT_RD: st <= S_BOOT_RD2;     // registered BSRAM read latency
        S_BOOT_RD2: begin
          op_wdata <= img_data;
          op_addr  <= {5'b00000, bi};
          st <= S_BOOT_WR;
        end
        S_BOOT_WR: if (!bbusy) begin
          breq <= 1'b1; bwe <= 1'b1; baddr <= op_addr; bwdata <= op_wdata;
          st <= S_BOOT_WT;
        end
        S_BOOT_WT: if (bbusy) begin
          if (bi == 15'(IMG_WORDS-1)) begin
            st <= S_VER_SET;                 // read word 0 back before booting
          end else begin
            bi <= bi + 15'd1;
            img_addr <= bi + 15'd1;
            st <= S_BOOT_RD;                 // next image word
          end
        end

        S_VER_SET: begin
          img_addr <= 15'd0;                 // BSRAM read of image word 0
          st <= S_VER_RD;
        end
        S_VER_RD: begin
          op_is_load <= 1'b1; op_is_store <= 1'b0; op_is_fetch <= 1'b0;
          op_addr <= 20'h00000;
          ver_pending <= 1'b1;
          st <= S_CMD;
        end

        // ---- normal operation ------------------------------------------
        S_IDLE: begin
          // latch a store that is retiring this cycle (WB), then a load in
          // MEM, else fetch. Store first keeps store->load ordered.
          if (mem_we) begin
            store_lat  <= 1'b1;
            store_addr <= mem_waddr[19:0];
            store_data <= mem_wdata;
            st <= S_STORE;
          end else if (store_lat) begin
            st <= S_STORE;
          end else if (mem_rd) begin
            op_is_load <= 1'b1; op_is_store <= 1'b0; op_is_fetch <= 1'b0;
            op_addr <= mem_addr[19:0];
            st <= S_CMD;
          end else if (if_addr[20:4] == 17'h0FFFF) begin
            // The boot ROM belongs to the top, not to PSRAM: serve the reset
            // vector range (0xFFFF0..0xFFFFF) from the local constant.
            op_is_load  <= 1'b0;
            op_is_store <= 1'b0;
            op_is_fetch <= 1'b1;
            rd_q <= BOOT_ROM[16*if_addr[3:0] +: 16];
            st   <= S_PRESENT;
          end else begin
            op_is_load <= 1'b0; op_is_store <= 1'b0; op_is_fetch <= 1'b1;
            op_addr <= if_addr[19:0];
            st <= S_CMD;
          end
        end

        S_CMD: if (!bbusy) begin
          breq <= 1'b1; bwe <= 1'b0; baddr <= op_addr;
          st <= S_WAIT;
        end

        S_WAIT: if (bready) begin
          rd_q <= brdata;
          if (ver_pending) begin
            ver_pending <= 1'b0;
            if (brdata != img_data) boot_err <= 1'b1;   // word 0 vs BSRAM image
            boot_q <= 1'b1;                  // release the core
            st <= S_IDLE;
          end else begin
            st <= S_PRESENT;
          end
        end

        S_PRESENT: begin
          // one cycle with the stall released: the core captures/retires, and
          // a retiring store is latched here for the next transaction
          if (mem_we) begin
            store_lat  <= 1'b1;
            store_addr <= mem_waddr[19:0];
            store_data <= mem_wdata;
          end
          st <= S_IDLE;
        end

        S_STORE: if (!bbusy) begin
          breq <= 1'b1; bwe <= 1'b1; baddr <= store_addr; bwdata <= store_data;
          store_lat <= 1'b0;
          st <= S_STORE_W;
        end

        S_STORE_W: if (bbusy) st <= S_IDLE;

        default: st <= S_IDLE;
      endcase
    end
  end
endmodule
