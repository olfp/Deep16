\ LILA far execution tokens (Deep16: two 16-bit words: segment + offset)
\ Host/gforth: segment is ignored, offset is an ordinary XT.

: far-execute ( seg off -- )  drop execute ;

\ Pack a far XT onto the stack as two words.
: far-xt ( seg off -- seg off )  ;

\ Convenience: call a far XT stored as two consecutive cells.
: far-call ( addr -- )  dup @ swap cell+ @ far-execute ;
