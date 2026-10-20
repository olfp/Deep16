// deep16_psram_bridge - word requests to the Gowin PSRAM HS IP.
//
// The IP's user interface is burst-based (IPUG943): one burst-16 command moves
// 32 bytes = 16 Deep16 words as four 64-bit beats, the address is a word address
// in 4-byte units, data_mask is per beat with a 1 meaning "masked", and two
// commands are at least Tcmd = 14 user clocks apart. So the smallest unit the
// machine can ask for is a 32-byte line; this module keeps one line and serves
// words out of it. That is the "no cache" minimum - and the seed of the real
// cache.
//
// CPU side (clk_cpu): one transaction at a time. `req` pulses with we/addr/wdata,
// `busy` is high until `ready` pulses (rdata valid for reads).
//
// IP side (clk_ip): the line and the command FSM. Request and completion cross
// as toggles with stable payloads.
module deep16_psram_bridge (
  input  logic        clk_cpu,
  input  logic        rst_cpu,
  input  logic        clk_ip,
  input  logic        rst_ip,

  input  logic        req,
  input  logic        we,
  input  logic [19:0] addr,
  input  logic [15:0] wdata,
  output logic [15:0] rdata,
  output logic        ready,
  output logic        busy,

  output logic [20:0] ip_addr,
  output logic        ip_cmd,
  output logic        ip_cmd_en,
  output logic [63:0] ip_wr_data,
  output logic [7:0]  ip_mask,
  input  logic [63:0] ip_rd_data,
  input  logic        ip_rd_valid
);

  localparam int TCMD = 14;      // burst 16 (IPUG943 Table 4-2)

  // ---- CPU side ---------------------------------------------------------
  logic        req_tgl, ack_meta, ack_sync;
  logic [19:0] req_addr;
  logic        req_we;
  logic [15:0] req_wdata;
  logic        busy_q, ready_q;
  logic [15:0] rdata_q;

  assign busy  = busy_q;
  assign ready = ready_q;
  assign rdata = rdata_q;

  always_ff @(posedge clk_cpu) begin
    if (rst_cpu) begin
      req_tgl <= 1'b0; busy_q <= 1'b0; ready_q <= 1'b0;
      ack_meta <= 1'b0; ack_sync <= 1'b0; rdata_q <= 16'd0;
      req_addr <= 20'd0; req_we <= 1'b0; req_wdata <= 16'd0;
    end else begin
      ack_meta <= ack_tgl;
      ack_sync <= ack_meta;
      ready_q  <= 1'b0;
      if (req && !busy_q) begin
        req_addr  <= addr;
        req_we    <= we;
        req_wdata <= wdata;
        req_tgl   <= ~req_tgl;
        busy_q    <= 1'b1;
      end
      if (busy_q && (ack_sync == req_tgl)) begin   // ack toggle matches the request
        busy_q  <= 1'b0;
        ready_q <= 1'b1;
        rdata_q <= rdata_ip;
      end
    end
  end

  // ---- IP side ----------------------------------------------------------
  logic        ack_tgl;
  logic        req_meta0, req_meta1;
  logic [15:0] rdata_ip;

  // request toggle into the IP domain
  always_ff @(posedge clk_ip) begin
    if (rst_ip) begin req_meta0 <= 1'b0; req_meta1 <= 1'b0; end
    else begin req_meta0 <= req_tgl; req_meta1 <= req_meta0; end
  end
  wire req_seen = req_meta1 ^ ack_tgl;

  // line buffer: 16 words of a 32-byte block
  logic [255:0] line;
  logic [15:0]  line_tag;
  logic         line_valid;

  localparam logic [2:0] S_IDLE  = 3'd0, S_WCMD  = 3'd1, S_WDATA = 3'd2,
                         S_RCMD  = 3'd3, S_RWAIT = 3'd4, S_SERVE = 3'd5;
  logic [2:0]  st;
  logic [19:0] a;
  logic [15:0] wd;
  logic [3:0]  off;
  logic [1:0]  beat, rb;
  logic [5:0]  tcmd;
  logic [255:0] cap;

  wire [1:0] beat_of_word = off[3:2];        // which 8-byte beat holds the word
  wire [2:0] lane_of_word = {off[1:0], 1'b0};// byte offset of the word in the beat

  logic [63:0] wdata_beat;
  logic [7:0]  wmask_beat;
  always_comb begin
    wdata_beat = 64'd0;
    wdata_beat[lane_of_word*8 +: 16] = wd;
    wmask_beat = ~(8'h03 << lane_of_word);
  end

  always_ff @(posedge clk_ip) begin
    if (rst_ip) begin
      st <= S_IDLE; tcmd <= 6'd0; beat <= 2'd0; rb <= 2'd0;
      line_valid <= 1'b0; line_tag <= 16'd0; ack_tgl <= 1'b0;
      ip_cmd_en <= 1'b0; ip_cmd <= 1'b0; ip_addr <= 21'd0;
      ip_wr_data <= 64'd0; ip_mask <= 8'hFF; rdata_ip <= 16'd0;
      a <= 20'd0; wd <= 16'd0; off <= 4'd0;
    end else begin
      ip_cmd_en <= 1'b0;
      if (tcmd != 6'd0) tcmd <= tcmd - 6'd1;

      case (st)
        S_IDLE: if (req_seen && tcmd == 6'd0) begin
          a    <= req_addr;
          wd   <= req_wdata;
          off  <= req_addr[3:0];
          if (!req_we && line_valid && (line_tag == req_addr[19:4])) begin
            rdata_ip <= line[req_addr[3:0]*16 +: 16];
            ack_tgl  <= ~ack_tgl;
          end else if (req_we) begin
            st <= S_WCMD;
          end else begin
            st <= S_RCMD;
          end
        end

        S_WCMD: begin
          ip_addr    <= {2'b00, a[19:4], 3'b000};
          ip_cmd     <= 1'b1;
          ip_cmd_en  <= 1'b1;
          ip_wr_data <= (beat_of_word == 2'd0) ? wdata_beat : 64'd0;
          ip_mask    <= (beat_of_word == 2'd0) ? wmask_beat : 8'hFF;
          beat       <= 2'd1;
          tcmd       <= 6'(TCMD);
          st         <= S_WDATA;
        end

        S_WDATA: begin
          ip_wr_data <= (beat_of_word == beat) ? wdata_beat : 64'd0;
          ip_mask    <= (beat_of_word == beat) ? wmask_beat : 8'hFF;
          beat       <= beat + 2'd1;
          if (beat == 2'd3) begin
            if (line_valid && (line_tag == a[19:4]))
              line[a[3:0]*16 +: 16] <= wd;
            ack_tgl <= ~ack_tgl;
            st      <= S_IDLE;
          end
        end

        S_RCMD: begin
          ip_addr   <= {2'b00, a[19:4], 3'b000};
          ip_cmd    <= 1'b0;
          ip_cmd_en <= 1'b1;
          tcmd      <= 6'(TCMD);
          rb        <= 2'd0;
          st        <= S_RWAIT;
        end

        S_RWAIT: if (ip_rd_valid) begin
          cap[rb*64 +: 64] <= ip_rd_data;
          rb <= rb + 2'd1;
          if (rb == 2'd3) st <= S_SERVE;
        end

        S_SERVE: begin
          line       <= cap;
          line_tag   <= a[19:4];
          line_valid <= 1'b1;
          rdata_ip   <= cap[a[3:0]*16 +: 16];
          ack_tgl    <= ~ack_tgl;
          st         <= S_IDLE;
        end

        default: st <= S_IDLE;
      endcase
    end
  end

endmodule
