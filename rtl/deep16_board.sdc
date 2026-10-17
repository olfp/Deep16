// deep16_board.sdc - timing constraints for the D16MINI board build.
//
// One clock domain: the 27 MHz oscillator, taken directly (no PLL). Every input
// is either this clock or an asynchronous button/UART pin, which the design
// synchronises or samples with an oversampler, so no other constraint is needed.

create_clock -name clk -period 37.037 -waveform {0.000 18.519} [get_ports {clk}]

// The button and the UART pin are asynchronous; do not let the tool try to time
// them against clk.
set_false_path -from [get_ports {rst_n uart_rxd}]
