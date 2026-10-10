// Deep16 RTL - 4KB unified instruction/data cache (spec 7.4).
//
//   direct mapped, write-through, 256 lines x 8 words, physical tags
//   hit  = 1 cycle (combinational read, exactly like the bare memory array)
//   miss = block fill of the 8 words; the requested word still comes from
//          memory in the same cycle, so the pipeline never stalls
//
// Transparency is the whole point: a miss returns the same word the memory
// array would have returned, so no core logic needs to know the cache exists
// and retire-level parity against the behavioural cores is unchanged. The miss
// penalty is accounted separately in the cycle counter (see deep16_top).
//
// 0xFxxxx is never cached: that is the I/O page, the screen buffer and both
// ROMs. Caching them would break memory-mapped side effects (the IDE writes
// the screen straight into the array and expects the next read to see it) and
// would make the boot ROM un-replaceable. FSH invalidates every line.
module deep16_cache
  import deep16_pkg::*;
(
  input  logic        clk,
  input  logic        rst,

  // two combinational read ports (instruction fetch, data)
  input  logic [20:0] if_addr,
  output logic        if_hit,
  output logic [15:0] if_rdata,
  input  logic [20:0] mem_addr,
  output logic        dm_hit,
  output logic [15:0] mem_rdata,

  // one write port (stores commit in WB)
  input  logic        mem_we,
  input  logic [20:0] mem_waddr,
  input  logic [15:0] mem_wdata,

  // refill handshake: the cache picks the line, the top supplies the words
  output logic [16:0] fill_base,   // addr[19:3] of the line being refilled
  input  logic [127:0] fill_data,

  // out-of-band invalidation: FSH, and debugger writes (poke/load_program)
  input  logic        flush_all,
  input  logic        inv_we,
  input  logic [7:0]  inv_line,

  // statistics (spec 7.4: hit/miss counters)
  output logic [31:0] stat_hits,
  output logic [31:0] stat_misses,
  output logic        miss_pulse   // one pulse per miss, for the cycle penalty
);

  localparam int LINES      = 256;   // 4KB / 8 words
  localparam int LINE_WORDS = 8;
  localparam int TAG_BITS   = 14;    // addr[19:6]

  logic [15:0]         data [0:LINES*LINE_WORDS-1];
  logic [TAG_BITS-1:0] tag  [0:LINES-1];
  logic                valid[0:LINES-1];

  // A line covers 8 consecutive words: index is the address shifted down by 3,
  // offset is the remainder, tag is everything above.
  wire [7:0] if_line = if_addr[10:3];
  wire [2:0] if_word = if_addr[2:0];
  wire [7:0] dm_line = mem_addr[10:3];
  wire [2:0] dm_word = mem_addr[2:0];
  wire [7:0] wr_line = mem_waddr[10:3];
  wire [2:0] wr_word = mem_waddr[2:0];

  // 0xFxxxx is the I/O page, the screen and both ROMs - never cached.
  wire if_c = (if_addr[19:16]  != 4'hF) && !if_addr[20];
  wire dm_c = (mem_addr[19:16] != 4'hF) && !mem_addr[20];
  wire wr_c = (mem_waddr[19:16] != 4'hF) && !mem_waddr[20];

  wire if_hit_w = if_c && valid[if_line] && (tag[if_line] == if_addr[19:6]);
  wire dm_hit_w = dm_c && valid[dm_line] && (tag[dm_line] == mem_addr[19:6]);
  wire wr_hit_w = wr_c && valid[wr_line] && (tag[wr_line] == mem_waddr[19:6]);

  assign if_hit = if_hit_w;
  assign dm_hit = dm_hit_w;

  // A miss still has to return the right word, so the caller falls through to
  // memory. `*_hit` says which source is authoritative.
  assign if_rdata  = if_hit_w ? data[{if_line, if_word}] : 16'hFFFF;
  assign mem_rdata = dm_hit_w ? data[{dm_line, dm_word}] : 16'hFFFF;

  // One line can be refilled per cycle. When both ports miss in the same cycle
  // the fetch wins; the data port is refilled on its next access, and its
  // value came from memory either way.
  assign fill_base = if_c ? if_addr[19:3] : mem_addr[19:3];
  assign miss_pulse = (if_c && !if_hit_w) || (dm_c && !dm_hit_w);

  integer i;
  integer w;

  always_ff @(posedge clk) begin
    if (rst || flush_all) begin
      for (i = 0; i < LINES; i++) valid[i] <= 1'b0;
      stat_hits   <= 32'd0;
      stat_misses <= 32'd0;
    end else begin
      if (if_c && !if_hit_w) begin
        stat_misses   <= stat_misses + 32'd1;
        valid[if_line] <= 1'b1;
        tag[if_line]   <= if_addr[19:6];
        for (w = 0; w < LINE_WORDS; w++) data[{if_line, w[2:0]}] <= fill_data[w*16 +: 16];
      end else if (if_c) begin
        stat_hits <= stat_hits + 32'd1;
      end

      if (dm_c && !dm_hit_w) begin
        stat_misses <= stat_misses + 32'd1;
        // only refill if the fetch port did not already claim the cycle
        if (!(if_c && !if_hit_w)) begin
          valid[dm_line] <= 1'b1;
          tag[dm_line]   <= mem_addr[19:6];
          for (w = 0; w < LINE_WORDS; w++) data[{dm_line, w[2:0]}] <= fill_data[w*16 +: 16];
        end
      end else if (dm_c && !(if_c && !if_hit_w)) begin
        stat_hits <= stat_hits + 32'd1;
      end

      // write-through: a hit also updates the copy. A miss just goes to
      // memory - no write-allocate.
      if (mem_we && wr_c && wr_hit_w) data[{wr_line, wr_word}] <= mem_wdata;

      // Debugger write (poke / load_program): drop that one line, so an
      // out-of-band write is never hidden behind a stale copy.
      if (inv_we) valid[inv_line] <= 1'b0;
    end
  end

endmodule
