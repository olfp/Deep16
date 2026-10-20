// d16mini.sv - the board build define, as a source file.
//
// D16MINI.md §4.5 / §4.6. The RTL has two builds behind `ifdef D16MINI`: the
// simulation build keeps the 1 MB memory array, the board build shrinks it to
// the 24 BSRAM blocks and turns on the window decode. GowinSynthesis has no
// command-line macro option (there is no -define in `set_option`), so the
// define lives here and this file must be the FIRST entry in the project's
// file list: GowinSynthesis parses the list as one compilation unit, so a
// `define in the first file is visible to every file after it.
//
// This is why deep16_board.gprj lists d16mini.sv first. Verified against
// Gowin EDA 1.9.12.04 on macOS.

`define D16MINI

`define PSRAM
