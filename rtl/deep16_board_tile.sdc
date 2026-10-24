// deep16_board_tile.sdc - timing constraints for the D16nano tile build.
//
// The reduced three-stage core runs at 27 MHz / 4 = 6.75 MHz (the standard D16
// build keeps 13.5 MHz and rtl/deep16_board.sdc). The divider and heartbeat
// stay in the 27 MHz domain; buttons and UART are asynchronous inputs.

create_clock -name clk -period 37.037 -waveform {0.000 18.519} [get_ports {clk}]

create_generated_clock -name clk_cpu -source [get_ports {clk}] -divide_by 4 [get_pins {clk_div_1_s0/Q}]

set_false_path -from [get_ports {rst_n uart_rxd}]

# The tile renderer (24.75 MHz, DVI PLL / 15) and the 720p scan/TMDS side
# (74.25 MHz, DVI PLL / 5) are asynchronous. The handshake uses 2-FF toggles
# and the line buffer is a dual-clock BSRAM, so cross-domain paths are not timed.
create_generated_clock -name dvi_render -source [get_ports {clk}] -multiply_by 11 -divide_by 12 [get_pins {u_dvi_pll/render_div/CLKOUT}]
create_generated_clock -name dvi_pixel  -source [get_ports {clk}] -multiply_by 11 -divide_by 4 [get_pins {u_dvi_pll/rpll_inst/CLKOUTD}]
set_clock_groups -asynchronous -group [get_clocks {dvi_render}] -group [get_clocks {dvi_pixel}]

# The CPU-to-tile FIFO is a gray-code async FIFO and the reset chains are
# asynchronous deasserts.
set_false_path -from [get_clocks {clk_cpu}] -to [get_clocks {dvi_render}]
set_false_path -from [get_clocks {clk_cpu}] -to [get_clocks {dvi_pixel}]


# OSER10 RESET is an asynchronous hard-macro input, not a data path.
set_false_path -from [get_pins {dvi_rst_sync_*_s0/Q}] -to [get_pins {u_dvi_out/ser_*/RESET}]

# The CPU FIFO read pointer crosses back from the render domain.
set_false_path -from [get_clocks {dvi_render}] -to [get_clocks {clk_cpu}]

# OSER10 RESET is asynchronous; the serial clock is the DVI PLL / 1.
create_generated_clock -name dvi_serial -source [get_ports {clk}] -multiply_by 55 -divide_by 4 [get_pins {u_dvi_pll/rpll_inst/CLKOUT}]
set_false_path -from [get_clocks {dvi_pixel}] -to [get_clocks {dvi_serial}]
