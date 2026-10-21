// psram_word_bridge - CPU word requests to the open-source HyperRAM controller.
//
// The controller runs 1:1 at 51 MHz (the point that works on this board); the
// CPU runs at 13.5 MHz. One word transaction at a time: latch the request,
// cross it as a toggle, drive the controller's read/write pulse, wait for busy
// to rise and fall, and hand the word back the same way.
//
// The controller's address is a BYTE address (22 bits); the CPU side uses a
// 20-bit word address.
module psram_word_bridge (
  input  logic        clk_cpu,
  input  logic        rst_cpu,
  input  logic        clk_ctl,
  input  logic        rst_ctl,

  // CPU side
  input  logic        req,
  input  logic        we,
  input  logic        burst,      // read two words under one CA
  input  logic [19:0] addr,
  input  logic [15:0] wdata,
  output logic [15:0] rdata,
  output logic [15:0] rdata2,     // second word of a burst read
  output logic        ready,      // one clk_cpu pulse
  output logic        busy,       // request in flight

  // controller side (clk_ctl)
  output logic        ctl_read,
  output logic        ctl_write,
  output logic [21:0] ctl_addr,
  output logic [15:0] ctl_din,
  output logic        ctl_burst,  // level: held for the whole transaction
  input  logic [15:0] ctl_dout,
  input  logic [15:0] ctl_dout2,
  input  logic        ctl_busy,
  output logic        init_ok      // controller finished its power-on init
);

  // ---- CPU side ---------------------------------------------------------
  logic        req_tgl, ack_meta, ack_sync;
  logic [19:0] req_addr;
  logic        req_we, req_burst;
  logic [15:0] req_wdata;
  logic        busy_q, ready_q;
  logic [15:0] rdata_q, rdata2_q;

  assign busy  = busy_q;
  assign ready = ready_q;
  assign rdata = rdata_q;
  assign rdata2 = rdata2_q;
  // The controller samples `burst` during the read state, not only at the
  // command, so it must be a level that stays stable for the transaction.
  assign ctl_burst = req_burst;

  always_ff @(posedge clk_cpu) begin
    if (rst_cpu) begin
      req_tgl <= 1'b0; busy_q <= 1'b0; ready_q <= 1'b0;
      ack_meta <= 1'b0; ack_sync <= 1'b0; rdata_q <= 16'd0;
      rdata2_q <= 16'd0; req_burst <= 1'b0;
      req_addr <= 20'd0; req_we <= 1'b0; req_wdata <= 16'd0;
    end else begin
      ack_meta <= ack_tgl;
      ack_sync <= ack_meta;
      ready_q  <= 1'b0;
      if (req && !busy_q) begin
        req_addr  <= addr;
        req_we    <= we;
        req_burst <= burst && !we;      // writes are single-word
        req_wdata <= wdata;
        req_tgl   <= ~req_tgl;
        busy_q    <= 1'b1;
      end
      if (busy_q && (ack_sync == req_tgl)) begin
        busy_q  <= 1'b0;
        ready_q <= 1'b1;
        rdata_q  <= rdata_ip;
        rdata2_q <= rdata2_ip;
      end
    end
  end

  // ---- controller side --------------------------------------------------
  logic        ack_tgl;
  logic        req_meta0, req_meta1;
  logic [15:0] rdata_ip, rdata2_ip;
  logic        init_done;

  always_ff @(posedge clk_ctl) begin
    req_meta0 <= req_tgl;
    req_meta1 <= req_meta0;
  end
  wire req_seen = req_meta1 ^ ack_tgl;

  localparam logic [1:0] C_IDLE = 2'd0, C_CMD = 2'd1, C_WAIT = 2'd2;
  logic [1:0] cst;

  always_ff @(posedge clk_ctl) begin
    if (rst_ctl) begin
      cst <= C_IDLE; ack_tgl <= 1'b0; init_done <= 1'b0;
      ctl_read <= 1'b0; ctl_write <= 1'b0;
      ctl_addr <= 22'd0; ctl_din <= 16'd0;
      rdata_ip <= 16'd0; rdata2_ip <= 16'd0;
    end else begin
      ctl_read  <= 1'b0;
      ctl_write <= 1'b0;
      if (!ctl_busy) init_done <= 1'b1;   // power-on init finished
      case (cst)
        C_IDLE: if (req_seen && init_done && !ctl_busy) begin
          ctl_addr  <= {1'b0, req_addr, 1'b0};   // word address -> byte address
          ctl_din   <= req_wdata;
          ctl_read  <= !req_we;
          ctl_write <= req_we;
          cst <= C_CMD;
        end
        C_CMD: if (ctl_busy) cst <= C_WAIT;      // controller started
        C_WAIT: if (!ctl_busy) begin
          rdata_ip  <= ctl_dout;
          rdata2_ip <= ctl_dout2;
          ack_tgl   <= ~ack_tgl;
          cst       <= C_IDLE;
        end
        default: cst <= C_IDLE;
      endcase
    end
  end

  assign init_ok = init_done;
endmodule
