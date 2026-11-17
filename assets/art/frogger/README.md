# Frogger game art

`sprites-sheet.png` is the sprite sheet supplied by the project owner for the
FiT Frogger game: top-down frogs, turtles, logs, cars, a fire truck and a
truck, plus the water/ground/black swatches, on a transparent background.

`scripts/make_frogger_art.mjs` crops the pieces the backdrop uses, area-filters
them down to 26 px wide (a game cell is 32×30), mirrors the ones whose lane
runs left, stretches each into its cell and maps the result onto the demo's
16-entry RGB332 art palette. A log is built from a two-tile cap, a repeating
middle and a mirrored cap, so an 8-, 18- or 24-cell log costs the same. The
fire truck (six cells) and the truck (eight cells) are wider than a car. The
water, asphalt, ground and time-bar tiles are composed in the same script. The
tile pack rides in the game's slice at offset `0x1000`, so nothing is baked into
`tilefont.hex`.

The home row uses a procedural dark hedge tile (bank index 38) and a bay built
from the sheet's lily pad on water: a 48x30 opening sliced into twelve tiles at
bank indices 26..37. Both ride in the same slice tile pack, so the home row
costs the baked banks nothing.

The game's 32x32 sprite frames (frog idle and hop facing up, the same two
rotated to face right, the squash, the home frog and the fly) are baked by
`scripts/make_frogger_sprites.mjs` into the sprite pack at slice offset
`0x2000`. The sheet draws the frogs head-down, so the frame baker flips each
one vertically to face up the screen, and rotates the right-facing pair; the
OAM H flip gives the left-facing frog. It is seven groups; the entry installs
them into the sprite bank from group 0. Nothing is baked into
`birdsprite.hex` either, so the menu and the other games keep their own art
until they load their packs.
