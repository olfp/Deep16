# Art sources

- `Pipes.png`, `Grass.png`, `Clouds.png`, `Sky.png` — the free Flappy-style
  pack the tile set was built from.
- `Red_Bird.png` — the red bird from that pack, cropped to four 40×30 frames.
- `Purple_Bird.png`, `Yellow_Bird.png` — the Purple and Yellow birds from
  **Fluffy Birds** by Yahallo Games (<https://yahallogames.itch.io/fluffy-birds>),
  reduced to the same four 40×30 frames. The pack licence permits commercial
  use; the 96×96 derivatives are committed here so the showcase builds
  reproducibly.

`scripts/make_art.mjs` converts these to the D16's shared 16-colour RGB332
palette. The three birds put body/belly on palette entries 2/13, so the game
picks a bird by setting those two entries and the sprite page; the bedazzled
flower/star use entries 5/11 and are added by the same script.
