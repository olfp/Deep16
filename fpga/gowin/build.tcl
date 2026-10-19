# build.tcl - synthesise the D16MINI board project in Gowin EDA.
#
# Driven by scripts/build_gowin.sh (`npm run synth:gowin`), which sets the macOS
# dyld paths and DEEP16_ROOT. The same commands can be pasted into the IDE's Tcl
# console after `set root <repo>`.
#
# The device, the file list and the `D16MINI` define live in
# fpga/gowin/deep16_board.gprj (committed, paths relative to that file, so the
# project opens from anywhere). The synthesis options a .gprj cannot carry are
# set here.

if {[info exists ::env(DEEP16_ROOT)]} {
    set root $::env(DEEP16_ROOT)
} else {
    set root [pwd]
}

open_project $root/fpga/gowin/deep16_board.gprj

# `deep16_board` is the board wrapper; without the SystemVerilog standard the
# package/always_ff RTL will not parse.
set_option -top_module deep16_board
set_option -verilog_std sysv2017

# image.hex is a synthesis input ($readmemh), resolved against the file's
# include dir, then the IDE project dir, then the include path (SUG550).
set_option -include_path $root/artifacts/image

run syn
run close
