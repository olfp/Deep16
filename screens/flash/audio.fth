\ screens/flash/audio.fth - one μ-law sample voice.
\ Loaded on demand with: s" audio" need
\ Samples are one type-0x0A slice in slice-buf; 4080 8-bit samples, 2/cell.
\ Stored at 11.10 kHz; each sample is pushed twice into the 21.09 kHz FIFO.
\ The player is polled for now; an IRQ pump is the next step.
0xA0 constant i2s-data
0xA2 constant i2s-ctrl
0xA4 constant i2s-status
: sfx! ( s -- )       i2s-data es! ;
: sfx-status ( -- n ) i2s-status es@ ;
: sfx-ctl! ( c -- )   i2s-ctrl es! ;
: sfx-off ( -- )      0 sfx-ctl! ;
create ulaw-table
  0x8284, 0x8684, 0x8A84, 0x8E84, 0x9284, 0x9684, 0x9A84, 0x9E84,
  0xA284, 0xA684, 0xAA84, 0xAE84, 0xB284, 0xB684, 0xBA84, 0xBE84,
  0xC184, 0xC384, 0xC584, 0xC784, 0xC984, 0xCB84, 0xCD84, 0xCF84,
  0xD184, 0xD384, 0xD584, 0xD784, 0xD984, 0xDB84, 0xDD84, 0xDF84,
  0xE104, 0xE204, 0xE304, 0xE404, 0xE504, 0xE604, 0xE704, 0xE804,
  0xE904, 0xEA04, 0xEB04, 0xEC04, 0xED04, 0xEE04, 0xEF04, 0xF004,
  0xF0C4, 0xF144, 0xF1C4, 0xF244, 0xF2C4, 0xF344, 0xF3C4, 0xF444,
  0xF4C4, 0xF544, 0xF5C4, 0xF644, 0xF6C4, 0xF744, 0xF7C4, 0xF844,
  0xF8A4, 0xF8E4, 0xF924, 0xF964, 0xF9A4, 0xF9E4, 0xFA24, 0xFA64,
  0xFAA4, 0xFAE4, 0xFB24, 0xFB64, 0xFBA4, 0xFBE4, 0xFC24, 0xFC64,
  0xFC94, 0xFCB4, 0xFCD4, 0xFCF4, 0xFD14, 0xFD34, 0xFD54, 0xFD74,
  0xFD94, 0xFDB4, 0xFDD4, 0xFDF4, 0xFE14, 0xFE34, 0xFE54, 0xFE74,
  0xFE8C, 0xFE9C, 0xFEAC, 0xFEBC, 0xFECC, 0xFEDC, 0xFEEC, 0xFEFC,
  0xFF0C, 0xFF1C, 0xFF2C, 0xFF3C, 0xFF4C, 0xFF5C, 0xFF6C, 0xFF7C,
  0xFF88, 0xFF90, 0xFF98, 0xFFA0, 0xFFA8, 0xFFB0, 0xFFB8, 0xFFC0,
  0xFFC8, 0xFFD0, 0xFFD8, 0xFFE0, 0xFFE8, 0xFFF0, 0xFFF8, 0x0000,

variable sample-pos drop
variable sample-end drop
variable sample-run drop
: sample-byte ( i -- b )
  dup 1 rshift slice-buf 8 cells + + @
  swap 1 and if 8 rshift then 0xff and ;
: sample-value ( i -- n )
  sample-byte dup 0x80 and if
    0x7f and ulaw-table + @ negate
  else
    0x7f and ulaw-table + @
  then ;
: sample-push ( -- )
  sample-pos @ sample-end @ < if
    sample-pos @ sample-value dup sfx! sfx!
    1 sample-pos +!
  else
    0 sample-run !
  then ;
: sample-pump ( -- )
  sample-run @ 0= if exit then
  0xF000 seg-base!
  begin sample-run @ while
    sfx-status 2 and 0<> if exit then
    sample-push
  repeat ;
: sample-start ( n -- )
  dup 0 511 within 0= if ." sample: 0..511" cr drop exit then
  slice dup slice-valid? 0= if
    drop ." sample: no slice" cr exit
  then
  dup slice-type 0x0A <> if
    drop ." sample: not ulaw" cr exit
  then drop
  0 sample-pos ! 4080 sample-end ! 1 sample-run !
  0xF000 seg-base!
  2 sfx-ctl!
  sample-pump
  sample-run @ if 1 sfx-ctl! then ;
: sample-stop ( -- )
  0 sample-run ! sfx-off ;
: sample-play ( n -- )
  sample-start
  begin sample-run @ while sample-pump repeat
  sfx-off ;
: sample ( n -- ) sample-play ;


