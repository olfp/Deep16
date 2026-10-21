# build_flash.tcl - build the final USER_FLASH machine (no image in BSRAM).
if {[info exists ::env(DEEP16_ROOT)]} { set root $::env(DEEP16_ROOT) } else { set root [pwd] }
open_project $root/fpga/gowin/deep16_board_flash.gprj
set_option -top_module deep16_board
set_option -verilog_std sysv2017
set_option -include_path $root/artifacts/image
set_option -output_base_name deep16_board_flash
run syn
run pnr
run close
