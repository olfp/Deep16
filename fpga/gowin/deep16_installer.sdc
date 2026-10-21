create_clock -name clk -period 37.037 -waveform {0.000 18.519} [get_ports {clk}]
set_false_path -from [get_ports {rst_n}]
