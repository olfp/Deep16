# Frogger backdrop art

`sprites-sheet.png` is the sprite sheet supplied by the project owner for the
FiT Frogger backdrop: top-down frogs, turtles, logs, cars, a fire truck and a
truck, plus the water/ground/black swatches, on a transparent background.

`scripts/make_frogger_art.mjs` crops the pieces the backdrop uses, area-filters
them down to 26 px wide (a game cell is 32×30), mirrors the ones whose lane
runs left, stretches each into its cell and maps the result onto the demo's
16-entry RGB332 art palette. A log is built from a two-tile cap, a repeating
middle and a mirrored cap, so an 8-, 18- or 24-cell log costs the same. The
fire truck (six cells) and the truck (eight cells) need tiles past the free
gap, so they take Flappy's 96..109 and Pac-Man's 110..120: the backdrop owns
them now. The water, asphalt, lane line, ground and time-bar
tiles are composed in the same script. Nothing else from the sheet is used yet:
the frogs, pac-man, fly, letters and icons are left for future screens.
