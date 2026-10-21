# build_installer.tcl - build the one-time user-flash installer.
if {[info exists ::env(DEEP16_ROOT)]} { set root $::env(DEEP16_ROOT) } else { set root [pwd] }
open_project $root/fpga/gowin/deep16_installer.gprj
set_option -top_module flash_installer
set_option -verilog_std sysv2017
set_option -include_path $root/artifacts/image
set_option -output_base_name deep16_installer
run syn
run pnr
run close
