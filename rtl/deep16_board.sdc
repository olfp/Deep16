// deep16_board.sdc - timing constraints for the D16MINI board build.
//
// Two clock domains: the 27 MHz oscillator on the pin, and the CPU clock the
// board divides from it (deep16_board.sv, 27 MHz / 4 = 6.75 MHz). The divider
// and the LED heartbeat stay in the 27 MHz domain. Every input is either a
// clock or an asynchronous button/UART pin, which the design synchronises or
// samples with an oversampler, so no other constraint is needed.

create_clock -name clk -period 37.037 -waveform {0.000 18.519} [get_ports {clk}]

// The CPU does not meet 27 MHz (D16MINI.md §4.7), so it runs at a quarter of
// it. Without this the tool infers clk_div[1] as a clock it "was not created"
// (TA1132) and times the machine at its 50 MHz default. The pin is the
// synthesised name of the divider's output register (clk_div[1]).
create_generated_clock -name clk_cpu -source [get_ports {clk}] -divide_by 4 [get_pins {clk_div_1_s0/Q}]

// The button and the UART pin are asynchronous; do not let the tool try to time
// them against either clock.
set_false_path -from [get_ports {rst_n uart_rxd}]
