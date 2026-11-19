# Sync note — BIOS/BDOS refactor in progress

The BIOS/BDOS refactor has landed and this checkout is synced with `main`.
BDOS read-slice (function 11), serial-read (10), PS/2 init (9) and the SPI
helpers (12/13) are active; the canonical boot loader uses read-slice, while
`cf-burst` stays available for the slice editor/tests. `essentials` and `sd`
reach the bus only through `spi-ctrl!`/`spi-xfer`. Before resuming the native editor work (EDITPLAN.md),
run the full test suite; BDOS write/erase remain stubs.