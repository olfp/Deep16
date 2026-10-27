# build_tile.tcl - build the persistent USER_FLASH tile console.
#
# Same as build.tcl, but the project starts with d16tile.sv (which defines
# DVI_TILE) and includes rtl/dvi/dvi_tile.sv instead of dvi_text.sv. Output base
# name is separate so the working deep16_board bitstream is not overwritten.
if {[info exists ::env(DEEP16_ROOT)]} {
    set root $::env(DEEP16_ROOT)
} else {
    set root [pwd]
}

open_project $root/fpga/gowin/deep16_board_tile_flash.gprj

set_option -top_module deep16_board
set_option -verilog_std sysv2017
set_option -include_path $root/artifacts/image
set_option -output_base_name deep16_board_tile_flash
run syn
set_option -place_option 0
set_option -route_option 1
run pnr
run close
