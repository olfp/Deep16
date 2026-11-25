// ps2_rx.sv - PS/2 keyboard receiver and Set-2 event decoder.
//
// Receive-only: the FPGA never drives the PS/2 clock or data lines. The
// keyboard's open-collector lines are pulled up to 5 V, so they must be level
// shifted to 3.3 V before they reach the FPGA; the GW1NR-9 absolute maximum
// I/O voltage is 3.75 V (DS117).
//
// Frame: start (0), eight data bits LSB first, odd parity, stop (1), sampled
// on the falling edge of the synchronised PS/2 clock. A frame that fails the
// start/stop/parity check is dropped and sets frame_error.
//
// The Set-2 decoder tracks break (0xF0), extended (0xE0), Shift/Ctrl/Alt/Caps
// and emits a one-cycle raw make event. There is no character table here: the
// BIOS software decoder maps {modifiers, extended, scan_code} through a layout
// table (PS2LAYOUT.md, scripts/make_ps2map.mjs). The pROM and the synthetic
// AltGr/extended remap are gone, which frees the BSRAM block.
module ps2_rx #(
  parameter int CLK_HZ = 6_750_000
) (
  input  logic       clk,
  input  logic       rst,
  input  logic       ps2_clk,
  input  logic       ps2_data,
  output logic       valid,        // one-cycle pulse for a raw make event
  output logic       extended,     // the event's E0 prefix
  output logic [7:0] scan_code,    // last received code, for debug
  output logic [3:0] modifiers,    // {caps, alt, ctrl, shift}
  output logic       frame_error,  // sticky until the next good frame
  // One-cycle pulse for every frame with good start/parity/stop, including
  // the ACK (0xFA) and BAT (0xAA) codes the host init waits for.
  output logic       frame_valid,
  // Synchronised pin levels for the host-side GPIO timing.
  output logic       dbg_clk, dbg_data
);

  // 2 ms at the CPU clock. A Set-2 frame at 16.7 kHz is about 0.66 ms, so a
  // clock that stops mid-frame resynchronises well before the next key.
  localparam logic [15:0] TIMEOUT = 16'(CLK_HZ / 500);

  // ---- input synchronisers ----------------------------------------------
  logic clk_meta, clk_sync, clk_sync_q;
  logic data_meta, data_sync;

  always_ff @(posedge clk) begin
    if (rst) begin
      clk_meta   <= 1'b1;
      clk_sync   <= 1'b1;
      clk_sync_q <= 1'b1;
      data_meta  <= 1'b1;
      data_sync  <= 1'b1;
    end else begin
      clk_meta   <= ps2_clk;
      clk_sync   <= clk_meta;
      clk_sync_q <= clk_sync;
      data_meta  <= ps2_data;
      data_sync  <= data_meta;
    end
  end

  wire clk_fall = clk_sync_q && !clk_sync;

  assign frame_valid = code_valid;
  assign dbg_clk  = clk_sync;
  assign dbg_data = data_sync;

  // ---- frame receiver ---------------------------------------------------
  // frame is shifted with the new bit at the MSB. After the 11th sample
  // (stop), frame[0] = start, frame[8:1] = data (LSB first), frame[9] =
  // parity and frame[10] = stop.
  logic [10:0] frame;
  logic [3:0]  bit_cnt;
  logic        frame_busy, frame_done;
  logic [15:0] timeout;
  logic        code_valid;
  logic [7:0]  code;

  always_ff @(posedge clk) begin
    if (rst) begin
      frame       <= 11'd0;
      bit_cnt     <= 4'd0;
      frame_busy  <= 1'b0;
      frame_done  <= 1'b0;
      timeout     <= 16'd0;
      code_valid  <= 1'b0;
      code        <= 8'd0;
      frame_error <= 1'b0;
    end else begin
      code_valid <= 1'b0;

      if (clk_fall) begin
        timeout <= 16'd0;
        if (!frame_busy) begin
          // A start bit is low; any other falling edge is noise.
          if (!data_sync) begin
            frame      <= 11'd0;
            frame_busy <= 1'b1;
            bit_cnt    <= 4'd1;
          end
        end else begin
          frame <= {data_sync, frame[10:1]};
          if (bit_cnt == 4'd10) begin
            frame_busy <= 1'b0;
            bit_cnt    <= 4'd0;
            frame_done <= 1'b1;
          end else begin
            bit_cnt <= bit_cnt + 4'd1;
          end
        end
      end else if (frame_busy) begin
        if (timeout >= TIMEOUT) begin
          frame_busy  <= 1'b0;
          bit_cnt     <= 4'd0;
          frame_done  <= 1'b0;
          timeout     <= 16'd0;
          frame_error <= 1'b1;
        end else begin
          timeout <= timeout + 16'd1;
        end
      end

      // The frame register was updated on the stop edge; check it here, one
      // cycle later, so the check sees the stop bit.
      if (frame_done) begin
        frame_done <= 1'b0;
        if (frame[0] == 1'b0 && frame[10] == 1'b1 &&
            ((^frame[8:1]) ^ frame[9]) == 1'b1) begin
          code        <= frame[8:1];
          code_valid  <= 1'b1;
          frame_error <= 1'b0;
        end else begin
          frame_error <= 1'b1;
        end
      end
    end
  end

  // ---- Set-2 decoder ----------------------------------------------------
  logic       break_flag, ext_flag, ext_latch;
  logic       shift, ctrl, alt, caps;

  assign modifiers = {caps, alt, ctrl, shift};
  assign extended  = ext_latch;

  always_ff @(posedge clk) begin
    if (rst) begin
      break_flag <= 1'b0;
      ext_flag   <= 1'b0;
      ext_latch  <= 1'b0;
      shift      <= 1'b0;
      ctrl       <= 1'b0;
      alt        <= 1'b0;
      caps       <= 1'b0;
      valid      <= 1'b0;
      scan_code  <= 8'd0;
    end else begin
      valid <= 1'b0;

      if (code_valid) begin
        scan_code <= code;

        if (code == 8'hAA || code == 8'hFA || code == 8'hEE || code >= 8'hFC) begin
          // BAT complete, ACK, echo, resend/error: no key.
          break_flag <= 1'b0;
          ext_flag   <= 1'b0;
        end else if (code == 8'hF0) begin
          break_flag <= 1'b1;
        end else if (code == 8'hE0) begin
          ext_flag <= 1'b1;
        end else begin
          if (code == 8'h12 || code == 8'h59) begin
            shift <= !break_flag;
          end else if (code == 8'h14) begin
            ctrl <= !break_flag;
          end else if (code == 8'h11) begin
            // Both Alts set the same state: right Alt is AltGr, and the left
            // Alt is not used for typing on this console.
            alt <= !break_flag;
          end else if (code == 8'h58) begin
            if (!break_flag) caps <= ~caps;
          end else if (!break_flag) begin
            // Every other make code is a raw event, including extended keys
            // and keys a layout may leave unmapped. The software decoder
            // decides whether it produces a character.
            valid     <= 1'b1;
            ext_latch <= ext_flag;
          end
          break_flag <= 1'b0;
          ext_flag   <= 1'b0;
        end
      end
    end
  end

endmodule
