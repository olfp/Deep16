# Font notices

## UW ttyp0 — the FiT text pages

`ttyp0-8x15.hex` and `ttyp0-8x15-italic.hex` are the regular and italic 1bpp
text pages used by the FiT tile build. Each contains only the 96 printable
ASCII glyphs (0x20–0x7F), 8 words per glyph, two rows per 16-bit word, MSB
leftmost.

- Source: <https://people.mpi-inf.mpg.de/~uwe/misc/uw-ttyp0/>
- Version: 2.1
- The 8×15 BDFs are generated exactly as the package Makefile does, from the
  8×16 base made shallow plus the 8×15 variant source:

```sh
perl bin/mkshallow bdf/t0-16.bdf  | cat - bdf/t0-15.bdf  |
  perl bin/bdfmangle - VARIANTS.dat mgl/unicode.mgl > gen-t0-15.bdf
perl bin/mkshallow bdf/t0-16i.bdf | cat - bdf/t0-15i.bdf |
  perl bin/bdfmangle - VARIANTS.dat mgl/unicode.mgl > gen-t0-15i.bdf
```

`node scripts/bdf_to_font.mjs gen-t0-15.bdf` then extracts the 96 ASCII words;
the italic file is extracted the same way. The default `VARIANTS.dat` selects
the slashed zero; edit it before generating if a plain or dotted zero is
preferred.

Copyright (C) 2012–2025 Uwe Waldmann.

### ttyp0 License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this font software and associated files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, embed, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

(1) The above copyright notice, this permission notice, and the disclaimer
    below shall be included in all copies or substantial portions of the
    Software.

(2) If the design of any glyphs in the fonts that are contained in the Software
    or generated during the installation process is modified or if additional
    glyphs are added to the fonts, the fonts must be renamed. The new names may
    not contain the word "UW", irrespective of capitalisation; the new names
    may contain the word "ttyp0", irrespective of capitalisation, only if
    preceded by a foundry name different from "UW".

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Nixedsys — legacy `font8x15.hex`

`font8x15.hex` is the earlier 8×15 source, generated from **Nixedsys**:

- Source: <https://github.com/ntwk/nixedsys-font>
- File: `nixedsys-normal.bdf`
- Generation: `node scripts/bdf_to_font.mjs nixedsys-normal.bdf rtl/dvi/font8x15.hex`

The Nixedsys repository does **not** contain a licence file (GitHub reports
`license: null`). The font is included here at the project owner's request for
non-commercial use. It is **not** covered by the repository's own licence, and
any commercial redistribution of this repository should replace it. The FiT
tile build no longer uses this file; it remains only as the generic converter
default and test fixture.
