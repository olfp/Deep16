// d16tile_flash.sv - the persistent USER_FLASH tile-console build defines.
//
// First file in deep16_board_tile_flash.gprj, exactly like d16mini.sv: the
// Gowin file list is one compilation unit. The 16-block CPU image leaves BSRAM,
// so the PSRAM tag cache and the 128-tile sprite bank both get real block RAM.
`define GOWIN
`define D16MINI
`define PSRAM
`define DVI
`define DVI_TILE
`define USER_FLASH


// D16nano: three-stage 6.75 MHz core, divider removed, software divide in the
// kernel image (asm/forth_nano.asm). The D16D demo/gfx words live in the
// kernel image (asm/gfx_demo.asm at 0x4E00); the bitstream itself is unchanged.
`define D16NANO
`define D16_PERIPH
`define D16SEG
