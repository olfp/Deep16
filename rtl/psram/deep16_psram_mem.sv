// deep16_psram_mem - the machine's memory: a small write-through cache in
// front of the PSRAM bridge.
//
// The controller gives 16-bit words one transaction at a time, so every
// straight-line fetch costs a PSRAM round trip. That cannot be avoided for a
// word that is touched once; what the cache buys is *reuse* - and Forth is all
// reuse: the inner interpreter, the number parser and the two stacks are tiny
// hot loops that fit in a kiloword many times over.
//
// Shape: 512 lines x 2 words, direct-mapped, 1,024 words of data (one BSRAM
// block) and 512 tags (a second block). Two-word lines keep a cold fill to two
// transactions - a longer line would make the first pass through fresh code
// slower than the uncached machine, since a fill costs what the individual
// reads cost. Write-through with update-on-hit: the cache always matches PSRAM,
// so no flush is needed after Forth compiles code, and FSH only has to dump the
// tags.
//
// Serial protocol, unchanged from the uncached machine: one transaction at a
// time and the core advances one cycle per completed word. Store first, then a
// load in MEM, then the fetch. The boot image is copied from the on-chip BSRAM
// before the core is released.
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
  output logic        boot_err,     // the boot read-back did not match
  input  logic        cache_flush,  // FSH retired in WB

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

  // ---- cache ------------------------------------------------------------
  // Word address: [19:10] tag, [9:1] line, [0] word within the line.
  localparam int LINES = 512;
  localparam int LINE_W = 2;

  logic [15:0] cache_mem [0:LINES*LINE_W-1];
  logic [15:0] ctag_mem  [0:LINES-1];     // {valid, 5'b0, tag[9:0]}

  logic [19:0] look_addr;
  logic [15:0] ctag_q, cdata_q;

  always_ff @(posedge clk_cpu) begin
    ctag_q  <= ctag_mem[look_addr[9:1]];
    cdata_q <= cache_mem[look_addr[9:0]];
  end

  logic        cache_hit, store_hit;

  // ---- sequencer --------------------------------------------------------
  localparam logic [4:0]
    S_BOOT_WAIT = 5'd0, S_BOOT_RD  = 5'd1, S_BOOT_RD2 = 5'd2,
    S_BOOT_WR   = 5'd3, S_BOOT_WT  = 5'd4,
    S_CLR       = 5'd5, S_VER      = 5'd6, S_VER2     = 5'd7,
    S_IDLE      = 5'd8, S_LOOK     = 5'd9, S_FILL_REQ = 5'd10,
    S_FILL_WAIT = 5'd11, S_PRESENT = 5'd12, S_STORE_CACHE = 5'd13,
    S_STORE     = 5'd14, S_STORE_W = 5'd15, S_FLUSH    = 5'd16;

  logic [4:0]  st;
  logic [14:0] bi;              // boot image index
  logic [8:0]  clr_i;           // tag clear index
  logic        clr_boot;        // the tag clear precedes the boot
  logic        boot_q;
  logic        op_is_load, op_is_store, op_is_fetch;
  logic [19:0] op_addr;
  logic [15:0] op_wdata, rd_q;
  logic        store_lat;
  logic        ver_pending;
  logic        flush_pending;
  logic [19:0] store_addr;
  logic [15:0] store_data;
  logic        fill_lo;

  // Counters for the boot simulation; the synthesizer prunes them when nothing
  // reads them.
  logic [31:0] hit_count, miss_count;

  always_comb begin
    // The read that is issued this cycle: the store's tag first (so the cache
    // can be updated), otherwise the load/fetch address, otherwise the address
    // the sequencer is working on.
    if (st == S_IDLE && mem_we)                         look_addr = mem_waddr[19:0];
    else if (st == S_IDLE && store_lat)                 look_addr = store_addr;
    else if (st == S_IDLE)                              look_addr = mem_rd ? mem_addr[19:0]
                                                                         : if_addr[19:0];
    else if (st == S_VER)                               look_addr = 20'h00100;
    else                                                look_addr = op_addr;
  end

  assign cache_hit = ctag_q[15] && (ctag_q[9:0] == op_addr[19:10]);
  assign store_hit = ctag_q[15] && (ctag_q[9:0] == store_addr[19:10]);
  assign boot_done = boot_q;
  assign mem_stall = boot_q ? (st != S_PRESENT) : 1'b1;
  assign if_preempted = !(boot_q && st == S_PRESENT && op_is_fetch && !op_is_load && !op_is_store);
  assign if_rdata = rd_q;
  assign mem_rdata = rd_q;

  always_ff @(posedge clk_cpu) begin
    breq <= 1'b0;
    if (cache_flush) flush_pending <= 1'b1;

    if (rst) begin
      st <= S_BOOT_WAIT; bi <= 15'd0; boot_q <= 1'b0;
      boot_err <= 1'b0; ver_pending <= 1'b0; flush_pending <= 1'b0;
      clr_i <= 9'd0; clr_boot <= 1'b0;
      op_is_load <= 0; op_is_store <= 0; op_is_fetch <= 0;
      op_addr <= 20'd0; op_wdata <= 16'd0; rd_q <= 16'd0;
      store_lat <= 0; store_addr <= 20'd0; store_data <= 16'd0;
      img_addr <= 15'd0; fill_lo <= 1'b0;
      hit_count <= 32'd0; miss_count <= 32'd0;
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
            // image done: the tag array is uninitialised, so clear it before
            // anything is allowed to hit
            clr_i <= 9'd0;
            clr_boot <= 1'b1;
            st <= S_CLR;
          end else begin
            bi <= bi + 15'd1;
            img_addr <= bi + 15'd1;
            st <= S_BOOT_RD;                 // next image word
          end
        end

        // ---- tag clear (boot) and flush (FSH) --------------------------
        S_CLR: begin
          ctag_mem[clr_i] <= 16'h0000;
          if (clr_i == 9'(LINES-1)) st <= S_VER;
          else clr_i <= clr_i + 9'd1;
        end
        S_FLUSH: begin
          ctag_mem[clr_i] <= 16'h0000;
          if (clr_i == 9'(LINES-1)) begin
            flush_pending <= 1'b0;
            st <= S_IDLE;
          end else clr_i <= clr_i + 9'd1;
        end

        // ---- boot read-back: the kernel entry word through the cache ---
        S_VER: begin
          img_addr <= 15'h0100;
          op_addr  <= 20'h00100;
          op_is_load <= 1'b1; op_is_store <= 1'b0; op_is_fetch <= 1'b0;
          ver_pending <= 1'b1;
          st <= S_VER2;
        end
        S_VER2: st <= S_LOOK;             // image read lands here

        // ---- normal operation ------------------------------------------
        S_IDLE: begin
          // latch a store that is retiring this cycle (WB), then a load in
          // MEM, else fetch. Store first keeps store->load ordered.
          if (mem_we) begin
            store_lat  <= 1'b1;
            store_addr <= mem_waddr[19:0];
            store_data <= mem_wdata;
            st <= S_STORE_CACHE;
          end else if (store_lat) begin
            st <= S_STORE_CACHE;
          end else if (flush_pending) begin
            clr_i <= 9'd0;
            st <= S_FLUSH;
          end else if (mem_rd) begin
            op_is_load <= 1'b1; op_is_store <= 1'b0; op_is_fetch <= 1'b0;
            op_addr <= mem_addr[19:0];
            st <= S_LOOK;
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
            st <= S_LOOK;
          end
        end

        // ---- cache lookup ---------------------------------------------
        S_LOOK: begin
          if (cache_hit) begin
            rd_q <= cdata_q;
            hit_count <= hit_count + 32'd1;
            st <= S_PRESENT;
          end else begin
            miss_count <= miss_count + 32'd1;
            fill_lo <= 1'b0;              // low word first
            st <= S_FILL_REQ;
          end
        end

        // ---- line fill (two words) ------------------------------------
        S_FILL_REQ: if (!bbusy) begin
          // low word first, then the high one
          breq <= 1'b1; bwe <= 1'b0;
          baddr <= {op_addr[19:1], fill_lo};
          st <= S_FILL_WAIT;
        end
        S_FILL_WAIT: if (bready) begin
          cache_mem[{op_addr[9:1], fill_lo}] <= brdata;
          if (fill_lo == op_addr[0]) rd_q <= brdata;   // the word that was asked for
          if (!fill_lo) begin
            fill_lo <= 1'b1;
            st <= S_FILL_REQ;
          end else begin
            ctag_mem[op_addr[9:1]] <= {1'b1, 5'b0, op_addr[19:10]};
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
          if (ver_pending) begin
            ver_pending <= 1'b0;
            if (rd_q != img_data) boot_err <= 1'b1;   // entry word vs BSRAM image
            boot_q <= 1'b1;                           // release the core
          end
          st <= S_IDLE;
        end

        // ---- store: update the cache if the line is present, then write
        // through to PSRAM ----------------------------------------------
        S_STORE_CACHE: begin
          if (store_hit) cache_mem[{store_addr[9:1], store_addr[0]}] <= store_data;
          st <= S_STORE;
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
