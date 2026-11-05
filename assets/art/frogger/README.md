# Frogger backdrop art

The 16x16 pixel-art tiles for the FiT Frogger backdrop, supplied by the project
owner from the `frogger_visual_assets` pack (a 10-colour palette). Only the
pieces the backdrop draws are kept here:

- `car_1.png` - top-down car facing right
- `car_2.png` - top-down car facing left
- `log_middle.png` - one log segment
- `turtle0000.png` - turtle
- `flower_ground_2.png` - the speckled ground the banks and median use

`scripts/make_frogger_art.mjs` crops each sprite to its opaque box, fits it to
a 32x30 game cell with a single scale factor and maps the ten source colours
onto the demo's 16-entry RGB332 art palette. The water, road, road line and
time-bar tiles are composed in the same script.
