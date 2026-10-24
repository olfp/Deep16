// d16tile.sv - the tile-console build define, as a source file.
//
// Same board as d16mini.sv, plus DVI_TILE, which selects dvi_tile instead of
// dvi_text in deep16_board.sv. This file must be the FIRST entry in the Gowin
// project's file list, exactly like d16mini.sv: GowinSynthesis parses the list
// as one compilation unit.
`define D16MINI
`define PSRAM
`define DVI
`define DVI_TILE

// D16nano: the hardware divider is removed from deep16_core and the kernel
// image (asm/forth_nano.asm) provides division in software.
`define D16NANO
