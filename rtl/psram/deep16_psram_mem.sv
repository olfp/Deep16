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
  output logic [13:0] img_addr,   // packed image: 16,384 words (16 blocks)
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
  output logic        mem_valid,   // the data port read word is in rd_q this cycle
  output logic        mem_store_ack, // a data-port store has been written to PSRAM
  output logic        boot_done,
  output logic        boot_err,     // the boot read-back did not match
  input  logic        cache_flush,  // FSH retired in WB

  // to the controller (clk_ip domain)
  output logic        ctl_read,
  output logic        ctl_write,
  output logic        ctl_burst,
  output logic [21:0] ctl_addr,
  output logic [15:0] ctl_din,
  input  logic [15:0] ctl_dout,
  input  logic [15:0] ctl_dout2,
  input  logic        ctl_busy
);

  // Boot ROM words (deep16_pkg's BOOT_ROM_PACKED, kept local so this module
  // needs no package function call).
  localparam logic [255:0] BOOT_ROM = 256'hFFF1FFF1FFF1FFF1FFF1FFF1FFF0FFE0A202A201A200D818FC21FF42FF410000;

  // ---- bridge -----------------------------------------------------------
  logic        breq, bwe, breq_burst;
  logic [19:0] baddr;
  logic [15:0] bwdata, brdata, brdata2;
  logic        bready, bbusy;

  logic init_ok_ctl;

`ifdef USER_FLASH
  // The flash boot loader shares the PSRAM bridge while the machine is held.
  logic        fb_start, fb_done, fb_err;
  logic [15:0] fb_entry;
  logic        fb_breq, fb_bwe;
  logic [19:0] fb_baddr;
  logic [15:0] fb_bwdata;
  logic        boot_active_q;
  wire         breq_m  = boot_active_q ? fb_breq  : breq;
  wire         bwe_m   = boot_active_q ? fb_bwe   : bwe;
  wire  [19:0] baddr_m = boot_active_q ? fb_baddr : baddr;
  wire  [15:0] bwdata_m= boot_active_q ? fb_bwdata: bwdata;
`else
  wire         breq_m  = breq;
  wire         bwe_m   = bwe;
  wire  [19:0] baddr_m = baddr;
  wire  [15:0] bwdata_m= bwdata;
`endif

  // `rst` is synchronous to clk_cpu. The controller domain needs the deassert
  // synchronised to its own clock, or the async reset inputs are timed as data
  // paths across the two domains (Gowin reports them as setup/hold violations).
  logic [1:0] rst_ip_sync;
  always_ff @(posedge clk_ip) rst_ip_sync <= {rst_ip_sync[0], rst};

  psram_word_bridge u_bridge (
    .clk_cpu(clk_cpu), .rst_cpu(rst),
    .clk_ctl(clk_ip),  .rst_ctl(rst_ip_sync[1]),
    .req(breq_m), .we(bwe_m), .burst(breq_burst), .addr(baddr_m), .wdata(bwdata_m),
    .rdata(brdata), .rdata2(brdata2), .ready(bready), .busy(bbusy),
    .ctl_read(ctl_read), .ctl_write(ctl_write), .ctl_burst(ctl_burst),
    .ctl_addr(ctl_addr), .ctl_din(ctl_din), .ctl_dout(ctl_dout),
    .ctl_dout2(ctl_dout2), .ctl_busy(ctl_busy),
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
  // Boot: clear the cache tags, read the packed image's range table from
  // BSRAM, then walk the 24,576-word destination. Each destination word is
  // either a payload word from the packed image or the 0xFFFF fill; the verify
  // repeats the same walk and compares PSRAM against the expected word.
  localparam logic [4:0]
    S_CLR        = 5'd0,
    S_CNT_SET    = 5'd1, S_CNT_RD   = 5'd2, S_CNT_GET = 5'd3,
    S_RS_RD      = 5'd4, S_RS_GET   = 5'd5,
    S_RE_RD      = 5'd6, S_RE_GET   = 5'd7,
    S_DECIDE     = 5'd8,
    S_PAY_RD     = 5'd9, S_PAY_GET  = 5'd10,
    S_WR         = 5'd11, S_WR_W    = 5'd12,
    S_VSTART     = 5'd13,
    S_CHK_REQ    = 5'd14, S_CHK_WAIT = 5'd15,
    S_VER        = 5'd16, S_VER2    = 5'd17,
    S_IDLE       = 5'd18, S_LOOK    = 5'd19,
    S_FILL_REQ   = 5'd20, S_FILL_WAIT = 5'd21,
    S_PRESENT    = 5'd22, S_STORE_CACHE = 5'd23,
    S_STORE      = 5'd24, S_STORE_W = 5'd25,
    S_FLUSH      = 5'd26, S_INIT    = 5'd27,
    S_FILL_WR2   = 5'd28,
    S_FSTART     = 5'd29, S_FBOOT   = 5'd30, S_FERR = 5'd31;

  logic [4:0]  st;

`ifdef USER_FLASH
`ifdef D16NANO
  localparam int FLASH_CLK_HZ = 6_750_000;   // the reduced core's board clock
`else
  localparam int FLASH_CLK_HZ = 13_500_000;
`endif
  flash_boot #(.CLK_HZ(FLASH_CLK_HZ)) u_flash_boot (
    .clk(clk_cpu), .rst(rst), .start(fb_start),
    .done(fb_done), .err(fb_err), .entry_exp(fb_entry),
    .breq(fb_breq), .bwe(fb_bwe), .baddr(fb_baddr), .bwdata(fb_bwdata),
    .bready(bready), .bbusy(bbusy)
  );
`endif

  logic [14:0] bi;              // destination index (0..IMG_WORDS-1)
  logic [13:0] src;             // payload cursor in the packed image
  logic [4:0]  count;           // ranges in the packed image
  logic [4:0]  r;               // current range
  logic [4:0]  p;               // current pair (header index)
  logic [14:0] range_start, range_end;
  logic [15:0] boot_data;       // the word being copied / expected by the verify
  logic [15:0] entry_exp;       // expected word at the kernel entry (0x0100)
  logic        is_verify;
  logic [8:0]  clr_i;           // tag clear index
  logic [1:0]  retry;           // image copy attempts
  logic        boot_q;
  logic        op_is_load, op_is_store, op_is_fetch;
  logic [19:0] op_addr;
  logic [15:0] op_wdata, rd_q;
  logic        store_lat;
  logic        ver_pending;
  logic        flush_pending;
  logic [19:0] store_addr;
  logic [15:0] store_data;

  localparam logic [15:0] FILL = 16'hFFFF;

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
  assign mem_valid = boot_q && (st == S_PRESENT) && op_is_load && !op_is_store;
  assign mem_store_ack = (st == S_STORE_W) && bbusy;
  assign if_preempted = !(boot_q && st == S_PRESENT && op_is_fetch && !op_is_load && !op_is_store);
  assign if_rdata = rd_q;
  assign mem_rdata = rd_q;

  always_ff @(posedge clk_cpu) begin
`ifdef D16CORE3_DBG
    if (mem_we) $display("PSRAM we st=%0d slat=%d addr=%05x data=%04x busy=%d", st, store_lat, mem_waddr, mem_wdata, bbusy);
`endif
    breq <= 1'b0;
    breq_burst <= 1'b0;
    if (cache_flush) flush_pending <= 1'b1;

    if (rst) begin
      st <= S_CLR; bi <= 15'd0; boot_q <= 1'b0; clr_i <= 9'd0;
      boot_err <= 1'b0; ver_pending <= 1'b0; flush_pending <= 1'b0;
      retry <= 2'd0;
      count <= 5'd0; r <= 5'd0; p <= 5'd0; src <= 14'd0;
      range_start <= 15'd0; range_end <= 15'd0;
      boot_data <= FILL; entry_exp <= 16'd0; is_verify <= 1'b0;
      op_is_load <= 0; op_is_store <= 0; op_is_fetch <= 0;
      op_addr <= 20'd0; op_wdata <= 16'd0; rd_q <= 16'd0;
      store_lat <= 0; store_addr <= 20'd0; store_data <= 16'd0;
      img_addr <= 14'd0;
`ifdef USER_FLASH
      boot_active_q <= 1'b0; fb_start <= 1'b0;
`endif
      hit_count <= 32'd0; miss_count <= 32'd0;
    end else begin
      case (st)
        // ---- wait for the controller's power-on init --------------------
        S_INIT: if (init_s) begin
`ifdef USER_FLASH
          st <= S_FSTART;
`else
          st <= S_CNT_SET;
`endif
        end

`ifdef USER_FLASH
        // ---- flash boot: the image lives in the on-die FLASH608K --------
        S_FSTART: begin
          boot_active_q <= 1'b1;
          fb_start <= 1'b1;
          st <= S_FBOOT;
        end
        S_FBOOT: begin
          fb_start <= 1'b0;
          if (fb_done) begin
            boot_active_q <= 1'b0;
            entry_exp <= fb_entry;
            st <= S_VER;
          end else if (fb_err) begin
            boot_active_q <= 1'b0;
            boot_err <= 1'b1;
            st <= S_FERR;
          end
        end
        S_FERR: st <= S_FERR;
`endif

`ifndef USER_FLASH
        // ---- packed image header: count and range table ------------------
        S_CNT_SET: begin
          img_addr <= 14'd0;                 // word 0 is the range count
          st <= S_CNT_RD;
        end
        S_CNT_RD: st <= S_CNT_GET;           // registered BSRAM read latency
        S_CNT_GET: begin
          count <= img_data[4:0];
          src   <= 14'({img_data[4:0], 1'b0}) + 14'd1;  // payload after count + pairs
          bi    <= 15'd0;
          r     <= 5'd0;
          p     <= 5'd0;
          is_verify <= 1'b0;
          img_addr <= 14'd1;                 // first pair's start
          // count == 0 is legal (an all-fill image): skip the table walk.
          st <= (img_data[4:0] == 5'd0) ? S_DECIDE : S_RS_RD;
        end

        // ---- one (start, end) pair --------------------------------------
        S_RS_RD: st <= S_RS_GET;
        S_RS_GET: begin
          range_start <= img_data[14:0];
          img_addr <= 14'({p, 1'b0}) + 14'd2;  // this pair's end
          st <= S_RE_RD;
        end
        S_RE_RD: st <= S_RE_GET;
        S_RE_GET: begin
          range_end <= img_data[14:0];
          p <= p + 5'd1;
          st <= S_DECIDE;
        end

        // ---- one destination word: payload or fill ----------------------
        S_DECIDE: begin
          if (r < count && bi > range_end) begin
            // past this range: read the next pair, or fall through to fill
            if ((r + 5'd1) < count) begin
              r <= r + 5'd1;
              img_addr <= 14'({p, 1'b0}) + 14'd1;
              st <= S_RS_RD;
            end else begin
              r <= r + 5'd1;                 // r == count: everything is fill
              st <= S_DECIDE;
            end
          end else if (r < count && bi >= range_start) begin
            // inside the current range (bi <= range_end): fetch its payload
            img_addr <= src;
            st <= S_PAY_RD;
          end else begin
            boot_data <= FILL;
            st <= is_verify ? S_CHK_REQ : S_WR;
          end
        end
        S_PAY_RD: st <= S_PAY_GET;           // BSRAM read latency
        S_PAY_GET: begin
          boot_data <= img_data;
          src <= src + 14'd1;
          st <= is_verify ? S_CHK_REQ : S_WR;
        end

        // ---- copy one word to PSRAM -------------------------------------
        S_WR: if (!bbusy) begin
          breq <= 1'b1; bwe <= 1'b1; baddr <= {5'd0, bi}; bwdata <= boot_data;
          st <= S_WR_W;
        end
        S_WR_W: if (bbusy) begin
          if (bi == 15'(IMG_WORDS-1)) begin
            bi <= 15'd0;
            st <= S_VSTART;                  // copy done: verify from the top
          end else begin
            bi <= bi + 15'd1;
            st <= S_DECIDE;
          end
        end

        // ---- verify one word against the same walk ----------------------
        S_VSTART: begin
          is_verify <= 1'b1;
          bi <= 15'd0; r <= 5'd0; p <= 5'd0;
          src <= 14'({count, 1'b0}) + 14'd1;
          img_addr <= 14'd1;
          st <= (count == 5'd0) ? S_DECIDE : S_RS_RD;
        end
        S_CHK_REQ: if (!bbusy && !bready) begin
          // !bready matters: the previous write's completion pulse may still be
          // high this cycle, and its rdata is not ours.
          breq <= 1'b1; bwe <= 1'b0; baddr <= {5'd0, bi};
          st <= S_CHK_WAIT;
        end
        S_CHK_WAIT: if (bready) begin
          if (bi == 15'h0100) entry_exp <= boot_data;   // for the S_VER check
          if (brdata != boot_data) begin
            if (retry == 2'd0) begin
              retry <= retry + 2'd1;         // one more copy, then trust it
              is_verify <= 1'b0;
              bi <= 15'd0;
              st <= S_CNT_SET;
            end else begin
              boot_err <= 1'b1;              // persistent: report and go on
              st <= S_VER;
            end
          end else if (bi == 15'(IMG_WORDS-1)) begin
            st <= S_VER;
          end else begin
            bi <= bi + 15'd1;
            st <= S_DECIDE;
          end
        end

`endif

        // ---- tag clear (boot) and flush (FSH) --------------------------
        S_CLR: begin
          ctag_mem[clr_i] <= 16'h0000;
          if (clr_i == 9'(LINES-1)) st <= S_INIT;
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
          // No BSRAM address here any more: the packed image has no word at
          // 0x0100. The verify walker saved the expected entry word instead.
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
            st <= S_FILL_REQ;
          end
        end

        // ---- line fill: one two-word burst ----------------------------
        S_FILL_REQ: if (!bbusy && !bready) begin
          // As in S_CHK_REQ: after a store, busy drops on the same cycle the
          // completion pulse rises, so issuing then would latch the old rdata.
          breq <= 1'b1; bwe <= 1'b0; breq_burst <= 1'b1;
          baddr <= {op_addr[19:1], 1'b0};   // the line is even-aligned
          st <= S_FILL_WAIT;
        end
        S_FILL_WAIT: if (bready) begin
          // The burst returns both words of the line. One transaction per miss
          // instead of two is the whole point of the controller extension.
          // The two words go in on consecutive cycles: two different addresses
          // written in one always_ff edge cannot be inferred as BSRAM, and the
          // flow then builds the whole cache from 16,384 flip-flops.
          cache_mem[{op_addr[9:1], 1'b0}] <= brdata;
          rd_q <= op_addr[0] ? brdata2 : brdata;
          st <= S_FILL_WR2;
        end
        S_FILL_WR2: begin
          cache_mem[{op_addr[9:1], 1'b1}] <= brdata2;
          ctag_mem[op_addr[9:1]] <= {1'b1, 5'b0, op_addr[19:10]};
          st <= S_PRESENT;
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
            if (rd_q != entry_exp) boot_err <= 1'b1;  // entry word vs the packed image
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
