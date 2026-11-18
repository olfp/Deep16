/* deep16_pole_model.js - the shared fixed-point road model.
 *
 * This is the single source of truth for the milestone-2 renderer geometry.
 * The D16 assembly in asm/pole/pole_render.asm implements exactly these
 * integer operations, so the assembly output and this model agree cell for
 * cell (tests/pole-asm.test.js proves it).
 *
 * Everything here is integer arithmetic. The eventual game code is integer
 * only; the host prototype may use floating point for art placement, never
 * for the road geometry.
 *
 * Coordinate system:
 *   - the FiT frame is 640x360, made of 80x24 cells of 8x15 pixels;
 *   - the tilemap is 82x26 cells with two banks (the 2 extra columns and rows
 *     are the scroll margins and stay untouched);
 *   - row 0 is the top of the screen, row 23 the bottom;
 *   - a "band" is one road row, counted from the bottom: band 0 is row 23
 *     (nearest the camera), band 1 is row 22, and so on.
 */
(() => {
  const WIDTH = 640;
  const HEIGHT = 360;
  const CELL_W = 8;
  const CELL_H = 15;
  const COLS = 80;
  const ROWS = 24;
  const MAP_COLS = 82;

  // Road half width at the camera plane: 0.68 in Q16. The perspective scale is
  // folded into the pixel distance, so no division is needed anywhere.
  const HALF_Q16 = 44564;

  const HORIZON_BASE = 90;
  const PATTERN_LEN = 64;
  const HILL_LEN = 32;

  // Art tile slots. The normal font occupies 0..95, so the game art lives in
  // 96..127. The eight sub-cell variants of each edge/stripe tile follow the
  // base slot.
  const ART = Object.freeze({
    SKY: 96,
    MOUNTAIN_A: 97,
    MOUNTAIN_B: 98,
    MOUNTAIN_C: 99,
    GRASS_A: 100,
    GRASS_B: 101,
    ROAD_A: 102,
    ROAD_B: 103,
    LEFT_EDGE: 104,     // 104..111: left edge, eight sub-cell offsets
    RIGHT_EDGE: 112,    // 112..119: right edge
    CENTER: 120,        // 120..127: centre stripe
  });

  // Sprite scale bins: width, height and the group base per car model.
  const SPRITE_W = Object.freeze([28, 21, 14, 8]);
  const SPRITE_H = Object.freeze([22, 16, 11, 6]);
  // The group base per car model. Group 0 is the player's car, so the first
  // model starts at group 1 and every model owns four scale bins.
  const SPRITE_GROUPS = Object.freeze([1, 5, 9, 13]);

  // The band -> scale bin table. Band 0 is the closest to the camera.
  const SCALE_BIN = Object.freeze([0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);

  // Curve pattern, signed Q8 half-width units per band. The renderer
  // accumulates it from the nearest band outwards, which is what bends the
  // road in the distance while the road under the player stays centred.
  const CURVE_TRACK = Object.freeze([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    6, 6, 6, 6, 6, 6, 6, 6, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    -6, -6, -6, -6, -6, -6, -6, -6, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  // Road width pattern, Q8 (256 = the normal width).
  const WIDTH_TRACK = Object.freeze([
    256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256,
    256, 256, 256, 256, 256, 256, 256, 256, 192, 200, 208, 216, 224, 232, 240, 248,
    256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256,
    256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256,
  ]);

  // A straight track and a widening track for the preview scenes.
  const STRAIGHT_CURVE = Object.freeze(new Array(PATTERN_LEN).fill(0));
  const STRAIGHT_WIDTH = Object.freeze(new Array(PATTERN_LEN).fill(256));

  // Hill offsets in pixels, one per hill phase.
  const HILL_OFFSETS = Object.freeze(Array.from({ length: HILL_LEN }, (_, i) =>
    Math.round(24 * Math.sin((2 * Math.PI * i) / HILL_LEN))));

  const TRACKS = Object.freeze({
    straight: Object.freeze({ curve: STRAIGHT_CURVE, width: STRAIGHT_WIDTH }),
    // The benchmark track: the curve and the width pattern run together, the
    // way the assembly's two tables do.
    curve: Object.freeze({ curve: CURVE_TRACK, width: WIDTH_TRACK }),
    // The same bend without the width change, and the same width change
    // without the bend - the two inputs in isolation.
    bend: Object.freeze({ curve: CURVE_TRACK, width: STRAIGHT_WIDTH }),
    width: Object.freeze({ curve: STRAIGHT_CURVE, width: WIDTH_TRACK }),
    hill: Object.freeze({ curve: STRAIGHT_CURVE, width: STRAIGHT_WIDTH }),
  });

  // 16-bit wrap, matching the D16 register file.
  function w16(value) {
    return ((value & 0xFFFF) << 16) >> 16;
  }

  // (a * b) >> 8 with the truncation toward zero the assembly performs: the
  // magnitude is multiplied unsigned and the sign is applied afterwards.
  function mulShr8(a, b) {
    if (a < 0) return -(((-a) * b) >> 8);
    return (a * b) >> 8;
  }

  function clamp(value, lo, hi) {
    return value < lo ? lo : value > hi ? hi : value;
  }

  function defaultState(trackName = 'curve') {
    return {
      track: trackName,
      phase: 0,
      hillPhase: 0,
      horizonY: HORIZON_BASE,
      playerX: 0,
      bank: 0,
      opponents: [
        { band: 5, lateral: -64, model: 0 },
        { band: 9, lateral: 96, model: 1 },
        { band: 13, lateral: 0, model: 2 },
      ],
    };
  }

  // Advance the world state by one frame: the pattern scrolls and the hill
  // phase moves the horizon.
  function advance(state) {
    state.phase = (state.phase + 3) & (PATTERN_LEN - 1);
    state.hillPhase = (state.hillPhase + 1) & (HILL_LEN - 1);
    state.horizonY = HORIZON_BASE + HILL_OFFSETS[state.hillPhase];
    return state;
  }

  // Project every road band. Returns one descriptor per band, nearest first.
  function projectBands(state) {
    const track = TRACKS[state.track] || TRACKS.curve;
    const bands = [];
    let xAcc = 0;
    let dxAcc = 0;
    for (let row = ROWS - 1; row >= 0; row--) {
      const dy = row * CELL_H + 7 - state.horizonY;
      if (dy < 0) break;
      const band = ROWS - 1 - row;
      const halfBase = (HALF_Q16 * dy) >> 16;
      const index = (state.phase + band) & (PATTERN_LEN - 1);
      const half = (halfBase * track.width[index]) >> 8;
      xAcc = w16(xAcc + dxAcc);
      dxAcc = w16(dxAcc + track.curve[index]);
      const shift = mulShr8(w16(xAcc - state.playerX), half);
      bands.push({
        band,
        row,
        dy,
        index,
        center: w16(320 + shift),
        half,
        xAcc,
      });
    }
    return bands;
  }

  // Compose one tilemap row. Returns the 80 cell words.
  function composeRow(state, bands, row) {
    const cells = new Array(COLS);
    const band = ROWS - 1 - row;
    const info = bands[band];
    if (!info) {
      // Above the horizon: the rows closest to it carry the mountains and
      // the tree line.
      const dy = row * CELL_H + 7 - state.horizonY;
      if (dy >= -CELL_H) {
        // The tree line stands on the horizon.
        const word = ART.MOUNTAIN_C << 5;
        for (let col = 0; col < COLS; col++) cells[col] = word;
      } else if (dy >= -2 * CELL_H) {
        // The mountain row alternates the two profiles. One profile repeated
        // every eight pixels reads as a row of teeth; two of them give the
        // ridge line a sixteen pixel period and it reads as a range.
        const first = ART.MOUNTAIN_A << 5;
        const second = ART.MOUNTAIN_B << 5;
        for (let col = 0; col < COLS; col++) {
          cells[col] = (col & 1) ? second : first;
        }
      } else {
        const word = ART.SKY << 5;
        for (let col = 0; col < COLS; col++) cells[col] = word;
      }
      return cells;
    }

    const leftPx = clamp(info.center - info.half, 0, WIDTH - 1);
    const rightPx = clamp(info.center + info.half, 1, WIDTH);
    const leftCell = leftPx >> 3;
    const rightCell = (rightPx - 1) >> 3;
    const centerCell = clamp(info.center >> 3, leftCell, rightCell);
    const leftOff = leftPx & 7;
    const rightOff = (rightPx - 1) & 7;
    const centerOff = info.center & 7;

    const roadTile = ((((state.phase + band) >> 3) & 1) ? ART.ROAD_B : ART.ROAD_A) << 5;
    // The grass takes the same band parity as the road texture, so the ground
    // scrolls with the road instead of standing still.
    const grassWord = ((((state.phase + band) >> 3) & 1) ? ART.GRASS_B : ART.GRASS_A) << 5;
    const leftWord = (ART.LEFT_EDGE + leftOff) << 5;
    const rightWord = (ART.RIGHT_EDGE + rightOff) << 5;
    const centerWord = (ART.CENTER + centerOff) << 5;

    for (let col = 0; col < COLS; col++) cells[col] = grassWord;
    cells[leftCell] = leftWord;
    for (let col = leftCell + 1; col < centerCell; col++) cells[col] = roadTile;
    cells[centerCell] = centerWord;
    for (let col = centerCell + 1; col < rightCell; col++) cells[col] = roadTile;
    cells[rightCell] = rightWord;
    return cells;
  }

  // Project the opponents onto the OAM slots.
  function composeOam(state, bands) {
    const oam = new Array(16).fill(0);
    // Slot 0 is the player: 28x22, bottom centre.
    oam[0] = 0x0800 | 306;
    oam[1] = 328;
    for (let slot = 1; slot < 8; slot++) {
      const opponent = state.opponents[slot - 1];
      if (!opponent) continue;
      const info = bands[opponent.band];
      if (!info) continue;
      const bin = SCALE_BIN[opponent.band];
      const width = SPRITE_W[bin];
      const height = SPRITE_H[bin];
      const offset = mulShr8(opponent.lateral, info.half);
      let x = w16(info.center + offset - (width >> 1));
      const y = info.row * CELL_H + 7 - height;
      const group = SPRITE_GROUPS[opponent.model] + bin;
      let w0 = 0x0800 | (x & 0x03FF);
      if (x < 0) w0 |= 0x0400;
      oam[slot * 2] = w0;
      oam[slot * 2 + 1] = ((group & 0x1F) << 11) | (y & 0x03FF);
    }
    return oam;
  }

  // Render one frame. Returns the 80x24 cell words, the 16 OAM words and the
  // bank the renderer drew into.
  function render(state) {
    const bands = projectBands(state);
    const cells = new Array(ROWS * COLS);
    for (let row = 0; row < ROWS; row++) {
      const rowCells = composeRow(state, bands, row);
      for (let col = 0; col < COLS; col++) cells[row * COLS + col] = rowCells[col];
    }
    const oam = composeOam(state, bands);
    const bank = state.bank ^ 1;
    return { cells, oam, bank, bands };
  }

  globalThis.Deep16PoleModel = {
    WIDTH,
    HEIGHT,
    CELL_W,
    CELL_H,
    COLS,
    ROWS,
    MAP_COLS,
    HALF_Q16,
    HORIZON_BASE,
    PATTERN_LEN,
    HILL_LEN,
    ART,
    SPRITE_W,
    SPRITE_H,
    SPRITE_GROUPS,
    SCALE_BIN,
    CURVE_TRACK,
    WIDTH_TRACK,
    STRAIGHT_CURVE,
    STRAIGHT_WIDTH,
    HILL_OFFSETS,
    TRACKS,
    advance,
    projectBands,
    composeRow,
    composeOam,
    render,
    defaultState,
  };
})();
