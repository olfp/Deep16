# Font notice — Nixedsys

`font8x15.hex` in this directory is generated from **Nixedsys**, an 8×15
bitmap font:

- Source: <https://github.com/ntwk/nixedsys-font>
- File: `nixedsys-normal.bdf`
- Generation: `node scripts/bdf_to_font.mjs nixedsys-normal.bdf rtl/dvi/font8x15.hex`

The Nixedsys repository does **not** contain a licence file (GitHub reports
`license: null`). The font is included here at the project owner's request for
non-commercial use. It is **not** covered by the repository's own licence, and
any commercial redistribution of this repository should replace it — either
with the public-domain `font8x8`-derived font used before this change, or with
another font whose licence permits redistribution.

The generated ROM contains only the 96 printable ASCII glyphs (0x20–0x7F),
packed two rows per 16-bit word.
