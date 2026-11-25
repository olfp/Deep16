/* deep16_pole_renderer.js - milestone-1 headless prototype for the FiT
 * Pole Position-style road renderer.
 *
 * This is a plain browser script, like deep16_tile_engine.js. It deliberately
 * uses the real FiT tile/sprite/palette model: the prototype writes a tile
 * bank, a double-buffered 82x26 map, and OAM descriptors, then renders through
 * Deep16TileEngine.
 *
 * The host prototype uses floating point only to validate the geometry. The
 * eventual D16 implementation must use 16.16 fixed point, multiplication, and
 * precomputed lookup tables without DIV/DIV32 in the frame loop.
 */
(() => {
  const WIDTH = 640;
  const HEIGHT = 360;
  const CELL_W = 8;
  const CELL_H = 15;
  const COLS = 80;
  const ROWS = 24;
  const MAP_COLS = 82;
  const FOCAL = 270;
  const BASE_HORIZON_Y = 90;
  const BASE_HALF_WIDTH = 0.68;

  // Game art stays in slots 96..127, as in the existing showcase games.
  const ART = Object.freeze({
    SKY: 96,
    MOUNTAIN_A: 97,
    MOUNTAIN_B: 98,
    MOUNTAIN_C: 99,
    GRASS_A: 100,
    GRASS_B: 101,
    ROAD_A: 102,
    ROAD_B: 103,
    LEFT_EDGE: 104,       // eight sub-cell offsets: 104..111
    RIGHT_EDGE: 112,      // eight sub-cell offsets: 112..119
    CENTER: 120,          // eight sub-cell offsets: 120..127
  });

  const SCENES = Object.freeze({
    straight: Object.freeze({
      cameraZ: 2.0,
      speed: 12.0,
      curveAmplitude: 0.0,
      curveWavelength: 8.0,
      widthAmplitude: 0.0,
      widthFrequency: 0.13,
      hillAmplitudePx: 0.0,
      hillFrequency: 0.32,
      playerOffset: 0.0,
      opponents: Object.freeze([
        Object.freeze({ model: 0, z: 2.8, x: -0.24 }),
        Object.freeze({ model: 1, z: 5.2, x: 0.28 }),
        Object.freeze({ model: 2, z: 8.5, x: 0.02 }),
      ]),
    }),
    curve: Object.freeze({
      cameraZ: 3.0,
      speed: 14.0,
      curveAmplitude: 2.4,
      curveWavelength: 8.0,
      widthAmplitude: 0.07,
      widthFrequency: 0.13,
      hillAmplitudePx: 0.0,
      hillFrequency: 0.32,
      playerOffset: 0.035,
      opponents: Object.freeze([
        Object.freeze({ model: 0, z: 2.7, x: -0.31 }),
        Object.freeze({ model: 1, z: 4.8, x: 0.34 }),
        Object.freeze({ model: 2, z: 8.2, x: -0.10 }),
      ]),
    }),
    hill: Object.freeze({
      cameraZ: 2.25,
      speed: 12.0,
      curveAmplitude: 0.85,
      curveWavelength: 11.0,
      widthAmplitude: 0.12,
      widthFrequency: 0.13,
      hillAmplitudePx: 24.0,
      hillFrequency: 0.32,
      playerOffset: -0.025,
      opponents: Object.freeze([
        Object.freeze({ model: 0, z: 3.0, x: 0.22 }),
        Object.freeze({ model: 1, z: 5.6, x: -0.30 }),
        Object.freeze({ model: 2, z: 9.0, x: 0.08 }),
      ]),
    }),
    width: Object.freeze({
      cameraZ: 1.25,
      speed: 11.0,
      curveAmplitude: 0.35,
      curveWavelength: 12.0,
      widthAmplitude: 0.50,
      widthFrequency: 0.13,
      hillAmplitudePx: 0.0,
      hillFrequency: 0.32,
      playerOffset: 0.0,
      opponents: Object.freeze([
        Object.freeze({ model: 0, z: 2.9, x: -0.20 }),
        Object.freeze({ model: 1, z: 5.0, x: 0.31 }),
        Object.freeze({ model: 2, z: 8.0, x: -0.08 }),
      ]),
    }),
  });

  function clamp(value, lo, hi) {
    return value < lo ? lo : value > hi ? hi : value;
  }

  function rgb332(red, green, blue) {
    const r = Math.round(clamp(red, 0, 255) * 7 / 255);
    const g = Math.round(clamp(green, 0, 255) * 7 / 255);
    const b = Math.round(clamp(blue, 0, 255) * 3 / 255);
    return (r << 5) | (g << 2) | b;
  }

  function grid15x8(fill = 0) {
    return Array.from({ length: 15 }, () => Array(CELL_W).fill(fill));
  }

  function tileWords(grid) {
    const words = new Array(32).fill(0);
    for (let row = 0; row < 15; row++) {
      const pixels = grid[row];
      words[row * 2] = (pixels[0] | (pixels[1] << 4) |
                         (pixels[2] << 8) | (pixels[3] << 12)) & 0xFFFF;
      words[row * 2 + 1] = (pixels[4] | (pixels[5] << 4) |
                           (pixels[6] << 8) | (pixels[7] << 12)) & 0xFFFF;
    }
    return words;
  }

  function mountainGrid(variant) {
    const grid = grid15x8(0);
    if (variant === 2) {
      // Solid base row under the jagged skyline.
      for (let y = 0; y < 15; y++) {
        for (let x = 0; x < CELL_W; x++) grid[y][x] = 11;
      }
      return grid;
    }
    const profiles = [
      [2, 3, 4, 5, 6, 5, 4, 3],
      [5, 4, 3, 2, 3, 4, 5, 6],
    ];
    const profile = profiles[variant % profiles.length];
    for (let x = 0; x < CELL_W; x++) {
      const top = profile[x];
      for (let y = top; y < 15; y++) {
        grid[y][x] = y < top + 2 ? 12 : 11;
      }
    }
    return grid;
  }

  function grassGrid(variant) {
    const grid = grid15x8(1);
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < CELL_W; x++) {
        const n = (x * 7 + y * 11 + variant * 5) % 17;
        if (n === 0) grid[y][x] = 3;
        else if (n <= 2) grid[y][x] = 2;
      }
    }
    return grid;
  }

  function roadGrid(variant) {
    const grid = grid15x8(4);
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < CELL_W; x++) {
        const n = (x * 13 + y * 5 + variant * 3) % 19;
        if (n === 0) grid[y][x] = 6;
        else if (n <= 3) grid[y][x] = 5;
        if (variant && y === (variant ? 1 : 0)) grid[y][x] = 5;
      }
    }
    return grid;
  }

  function leftEdgeGrid(boundary) {
    const grid = grid15x8(0);
    for (let y = 0; y < 15; y++) {
      const rumble = (Math.floor(y / 3) & 1) ? 8 : 7;
      for (let x = 0; x < CELL_W; x++) {
        if (x < boundary) {
          grid[y][x] = ((x + y) & 3) === 0 ? 2 : 1;
        } else if (x < boundary + 2) {
          grid[y][x] = rumble;
        } else {
          grid[y][x] = ((x * 5 + y) % 13 === 0) ? 5 : 4;
        }
      }
    }
    return grid;
  }

  function rightEdgeGrid(boundary) {
    const grid = grid15x8(0);
    for (let y = 0; y < 15; y++) {
      const rumble = (Math.floor(y / 3) & 1) ? 8 : 7;
      for (let x = 0; x < CELL_W; x++) {
        if (x <= boundary) {
          grid[y][x] = ((x * 5 + y) % 13 === 0) ? 5 : 4;
        } else if (x <= boundary + 2) {
          grid[y][x] = rumble;
        } else {
          grid[y][x] = ((x + y) & 3) === 0 ? 2 : 1;
        }
      }
    }
    return grid;
  }

  function centerGrid(offset) {
    const grid = roadGrid(0);
    for (let y = 0; y < 15; y++) {
      grid[y][offset] = 13;
      if (offset < 7) grid[y][offset + 1] = 8;
    }
    return grid;
  }

  function carGrid(body, shade, glass, playerStripe = false) {
    const grid = Array.from({ length: 32 }, () => Array(32).fill(0));
    for (let y = 2; y <= 27; y++) {
      for (let x = 2; x <= 29; x++) {
        if (y >= 8 || x >= 8 && x <= 23) grid[y][x] = body;
      }
    }
    // Rear window and roof.
    for (let y = 3; y <= 12; y++) {
      for (let x = 8; x <= 23; x++) grid[y][x] = shade;
    }
    for (let y = 5; y <= 10; y++) {
      for (let x = 10; x <= 21; x++) grid[y][x] = glass;
    }
    // Wheels, bumper, and lamps.
    for (let y = 19; y <= 28; y++) {
      for (let x = 1; x <= 5; x++) grid[y][x] = 3;
      for (let x = 26; x <= 30; x++) grid[y][x] = 3;
    }
    for (let x = 5; x <= 26; x++) grid[26][x] = 8;
    for (let y = 21; y <= 24; y++) {
      grid[y][5] = 7;
      grid[y][6] = 7;
      grid[y][25] = 7;
      grid[y][26] = 7;
    }
    if (playerStripe) {
      for (let y = 12; y <= 24; y++) {
        grid[y][15] = 4;
        grid[y][16] = 4;
      }
    }
    return grid;
  }

  function scaleGrid(source, width, height) {
    // Sprite groups are always 32x32. Keep the scaled art at the left edge
    // and align its bottom with the group so OAM placement can account for
    // the transparent top rows explicitly.
    const out = Array.from({ length: 32 }, () => Array(32).fill(0));
    const offsetY = 32 - height;
    for (let y = 0; y < height; y++) {
      const sy = Math.min(31, Math.floor((y + 0.5) * source.length / height));
      for (let x = 0; x < width; x++) {
        const sx = Math.min(31, Math.floor((x + 0.5) * source[0].length / width));
        out[offsetY + y][x] = source[sy][sx];
      }
    }
    return out;
  }

  function spriteWords(grid) {
    const words = new Array(256).fill(0);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x += 4) {
        const tile = Math.floor(y / 8) * 4 + Math.floor(x / 8);
        const half = (x & 4) ? 1 : 0;
        let word = 0;
        for (let n = 0; n < 4; n++) word |= (grid[y][x + n] & 0xF) << (n * 4);
        words[tile * 16 + (y & 7) * 2 + half] = word & 0xFFFF;
      }
    }
    return words;
  }

  class Deep16PoleRenderer {
    constructor(engine, options = {}) {
      if (!engine || typeof engine.write !== 'function') {
        throw new Error('Deep16PoleRenderer needs a Deep16TileEngine');
      }
      this.engine = engine;
      this.frame = 0;
      this.previousCells = new Uint16Array(COLS * ROWS).fill(0xFFFF);
      this.spriteMeta = new Map();
      this.lastStats = null;
      this.loadArt();
      this.setScene(options.scene || 'straight');
    }

    static get scenes() {
      return SCENES;
    }

    setScene(name) {
      if (!Object.prototype.hasOwnProperty.call(SCENES, name)) {
        throw new Error(`unknown Pole scene: ${name}`);
      }
      this.sceneName = name;
      this.scene = SCENES[name];
      this.cameraZ = this.scene.cameraZ;
      this.playerOffset = this.scene.playerOffset;
      this.previousCells.fill(0xFFFF);
      this.frame = 0;
      this.lastStats = null;
      return this;
    }

    advance(seconds = 1 / 60) {
      this.cameraZ += this.scene.speed * seconds;
      return this.cameraZ;
    }

    horizon() {
      const offset = this.scene.hillAmplitudePx *
        Math.sin(this.cameraZ * this.scene.hillFrequency);
      const y = BASE_HORIZON_Y + offset;
      return {
        offset,
        y,
        row: clamp(Math.round(y / CELL_H), 5, 8),
      };
    }

    curveAt(worldZ) {
      return this.scene.curveAmplitude *
        Math.sin((this.cameraZ + worldZ) / this.scene.curveWavelength);
    }

    cameraCurve() {
      return this.scene.curveAmplitude *
        Math.sin(this.cameraZ / this.scene.curveWavelength);
    }

    roadRows() {
      const horizon = this.horizon();
      const rows = [];
      for (let row = 0; row < ROWS; row++) {
        const y = row * CELL_H + (CELL_H - 1) / 2;
        const road = row >= horizon.row;
        if (!road) {
          rows.push({ row, y, road: false });
          continue;
        }
        const dy = Math.max(CELL_H, y - horizon.y);
        const z = FOCAL / dy;
        const curveDelta = this.curveAt(z) - this.cameraCurve();
        const center = WIDTH / 2 + FOCAL * curveDelta / z;
        const widthFactor = 1 + this.scene.widthAmplitude *
          Math.sin((this.cameraZ + z) * this.scene.widthFrequency);
        const pitchFactor = 1 + 0.18 * this.scene.hillAmplitudePx / 24 *
          Math.sin(this.cameraZ * this.scene.hillFrequency + 1.1);
        const halfWidth = BASE_HALF_WIDTH * widthFactor * pitchFactor * dy;
        rows.push({
          row,
          y,
          road: true,
          z,
          center,
          halfWidth,
          left: center - halfWidth,
          right: center + halfWidth,
          widthFactor,
        });
      }
      return rows;
    }

    projectObject(object) {
      const z = object.z;
      if (!(z > 0)) throw new Error('object distance must be positive');
      const horizon = this.horizon();
      const curveDelta = this.curveAt(z) - this.cameraCurve();
      const x = WIDTH / 2 + FOCAL * (curveDelta + object.x) / z;
      const groundY = horizon.y + FOCAL / z;
      const projectedWidth = 28 / z;
      const group = this.scaleGroup(object.model, projectedWidth);
      const meta = this.spriteMeta.get(group);
      return {
        x,
        y: groundY - meta.height - meta.offsetY,
        groundY,
        width: projectedWidth,
        height: meta.height,
        scale: meta.width / 28,
        group,
        model: object.model,
        z,
      };
    }

    scaleGroup(model, projectedWidth) {
      const bins = this.spriteMeta.get(`model${model}`).groups;
      if (projectedWidth >= 20) return bins[0];
      if (projectedWidth >= 14) return bins[1];
      if (projectedWidth >= 8) return bins[2];
      return bins[3];
    }

    writeTile(index, grid) {
      const words = tileWords(grid);
      for (let i = 0; i < words.length; i++) {
        this.engine.write(0xF3000 + index * 32 + i, words[i]);
      }
    }

    writeSprite(group, grid) {
      const words = spriteWords(grid);
      for (let i = 0; i < words.length; i++) {
        this.engine.write(0xF4000 + group * 256 + i, words[i]);
      }
    }

    loadArt() {
      const artPalette = [
        rgb332(66, 142, 235),   // 0 sky
        rgb332(44, 148, 54),    // 1 grass
        rgb332(27, 108, 39),    // 2 dark grass
        rgb332(87, 188, 73),    // 3 light grass
        rgb332(42, 42, 49),     // 4 asphalt
        rgb332(62, 62, 70),     // 5 asphalt variation
        rgb332(82, 82, 90),     // 6 light asphalt
        rgb332(225, 42, 34),    // 7 red rumble
        rgb332(239, 239, 235),  // 8 white rumble
        rgb332(66, 142, 235),   // 9 reserved sky
        rgb332(66, 142, 235),   // 10 reserved sky
        rgb332(66, 86, 125),    // 11 mountain
        rgb332(222, 233, 243),  // 12 snow
        rgb332(245, 203, 42),   // 13 center stripe
        rgb332(14, 14, 18),     // 14 black
        rgb332(35, 75, 210),    // 15 blue
      ];
      const spritePalette = [
        0,                     // 0 transparent
        rgb332(225, 48, 38),
        rgb332(142, 24, 25),
        rgb332(15, 15, 19),
        rgb332(242, 242, 238),
        rgb332(38, 86, 222),
        rgb332(244, 202, 42),
        rgb332(255, 111, 91),
        rgb332(164, 164, 170),
        rgb332(20, 42, 120),
        rgb332(48, 165, 61),
        rgb332(132, 83, 45),
        rgb332(235, 119, 33),
        rgb332(65, 203, 220),
        rgb332(220, 63, 189),
        rgb332(245, 137, 173),
      ];

      for (let i = 0; i < 16; i++) {
        this.engine.write(0xF6090 + i, artPalette[i]);
        this.engine.write(0xF60A0 + i, spritePalette[i]);
      }
      // Text palette pair 0, retained for a later HUD prototype.
      this.engine.write(0xF6080, rgb332(66, 142, 235));
      this.engine.write(0xF6081, rgb332(245, 245, 235));

      this.writeTile(ART.SKY, grid15x8(0));
      this.writeTile(ART.MOUNTAIN_A, mountainGrid(0));
      this.writeTile(ART.MOUNTAIN_B, mountainGrid(1));
      this.writeTile(ART.MOUNTAIN_C, mountainGrid(2));
      this.writeTile(ART.GRASS_A, grassGrid(0));
      this.writeTile(ART.GRASS_B, grassGrid(1));
      this.writeTile(ART.ROAD_A, roadGrid(0));
      this.writeTile(ART.ROAD_B, roadGrid(1));
      for (let offset = 0; offset < 8; offset++) {
        this.writeTile(ART.LEFT_EDGE + offset, leftEdgeGrid(offset));
        this.writeTile(ART.RIGHT_EDGE + offset, rightEdgeGrid(offset));
        this.writeTile(ART.CENTER + offset, centerGrid(offset));
      }

      const carSpecs = [
        { body: 1, shade: 2, glass: 5 },
        { body: 5, shade: 9, glass: 3 },
        { body: 6, shade: 13, glass: 3 },
      ];
      const scales = [
        { width: 28, height: 22 },
        { width: 21, height: 16 },
        { width: 14, height: 11 },
        { width: 8, height: 6 },
      ];

      const player = scaleGrid(carGrid(1, 2, 5, true), scales[0].width, scales[0].height);
      this.writeSprite(0, player);
      this.spriteMeta.set(0, {
        width: scales[0].width,
        height: scales[0].height,
        offsetY: 32 - scales[0].height,
        model: 0,
      });
      this.spriteMeta.set('model0', { groups: [1, 2, 3, 4] });
      this.spriteMeta.set('model1', { groups: [5, 6, 7, 8] });
      this.spriteMeta.set('model2', { groups: [9, 10, 11, 12] });

      carSpecs.forEach((spec, model) => {
        const source = carGrid(spec.body, spec.shade, spec.glass, false);
        scales.forEach((scale, bin) => {
          const group = 1 + model * 4 + bin;
          const grid = scaleGrid(source, scale.width, scale.height);
          this.writeSprite(group, grid);
          this.spriteMeta.set(group, {
            width: scale.width,
            height: scale.height,
            offsetY: 32 - scale.height,
            model,
          });
        });
      });

      // Disable the terminal cursor; the road owns the visible map.
      this.engine.write(0xF2000, 0);
    }

    rowTiles(rowInfo, horizon) {
      const tiles = new Array(COLS);
      if (!rowInfo.road) {
        const skylineRow = horizon.row - 2;
        const baseRow = horizon.row - 1;
        for (let col = 0; col < COLS; col++) {
          tiles[col] = rowInfo.row === baseRow ? ART.MOUNTAIN_C :
            rowInfo.row === skylineRow ? ART.MOUNTAIN_A + (col & 1) : ART.SKY;
        }
        return tiles;
      }

      const left = rowInfo.left;
      const right = rowInfo.right;
      const center = rowInfo.center;
      const leftCell = Math.floor(left / CELL_W);
      const rightCell = Math.floor((right - 1) / CELL_W);
      const centerCell = Math.floor(center / CELL_W);
      const centerOffset = clamp(center - centerCell * CELL_W, 0, 7);
      const texturePhase = Math.floor(this.cameraZ * 3 + rowInfo.row * 0.37) & 1;
      const roadTile = texturePhase ? ART.ROAD_B : ART.ROAD_A;

      for (let col = 0; col < COLS; col++) {
        if (col < leftCell || col > rightCell) {
          tiles[col] = ((col + rowInfo.row) & 1) ? ART.GRASS_A : ART.GRASS_B;
          continue;
        }

        const visibleLeft = leftCell >= 0 && leftCell < COLS;
        const visibleRight = rightCell >= 0 && rightCell < COLS;
        if (leftCell === rightCell) {
          tiles[col] = col === centerCell ?
            ART.CENTER + centerOffset : roadTile;
        } else if (col === leftCell && visibleLeft) {
          tiles[col] = ART.LEFT_EDGE + clamp(left - leftCell * CELL_W, 0, 7);
        } else if (col === rightCell && visibleRight) {
          tiles[col] = ART.RIGHT_EDGE + clamp((right - 1) - rightCell * CELL_W, 0, 7);
        } else if (col === centerCell) {
          tiles[col] = ART.CENTER + centerOffset;
        } else {
          tiles[col] = roadTile;
        }
      }
      return tiles;
    }

    writeOam() {
      const playerShift = Math.round(FOCAL * this.playerOffset);
      const playerX = WIDTH / 2 - 14 + playerShift;
      const playerY = HEIGHT - 32;
      this.writeOamSlot(0, 0, playerX, playerY);

      const projected = this.scene.opponents
        .map((object) => this.projectObject(object))
        .filter((object) => object.z > 0 && object.z < 30 && object.groundY > 0)
        .sort((a, b) => b.z - a.z);
      for (let slot = 1; slot < 8; slot++) {
        const object = projected[slot - 1];
        if (!object) {
          this.writeOamSlot(slot, 0, 0, 0, false);
          continue;
        }
        this.writeOamSlot(slot, object.group,
          Math.round(object.x - object.width / 2), Math.round(object.y), true);
      }
      return projected;
    }

    writeOamSlot(slot, group, x, y, enabled = true) {
      let xValue = Math.round(x);
      let sign = 0;
      if (xValue < 0) {
        sign = 0x0400;
        xValue = 1024 + xValue;
      }
      xValue = clamp(xValue, 0, 1023);
      y = clamp(Math.round(y), 0, 1023);
      const w0 = (enabled ? 0x0800 : 0) | sign | xValue;
      const w1 = enabled ? ((group & 0x1F) << 11) | y : 0;
      this.engine.write(0xF6000 + slot * 2, w0);
      this.engine.write(0xF6000 + slot * 2 + 1, w1);
    }

    renderFrame() {
      const currentDisplay = this.engine.mapDisplay;
      const writeBank = currentDisplay ^ 1;
      this.engine.write(0xF2008, (currentDisplay << 1) | writeBank);

      const horizon = this.horizon();
      const rows = this.roadRows();
      let changedCells = 0;
      for (const rowInfo of rows) {
        const tiles = this.rowTiles(rowInfo, horizon);
        for (let col = 0; col < COLS; col++) {
          const cell = tiles[col];
          const shadowIndex = rowInfo.row * COLS + col;
          if (cell !== this.previousCells[shadowIndex]) changedCells++;
          this.previousCells[shadowIndex] = cell;
          this.engine.write(0xF1000 + rowInfo.row * MAP_COLS + col, cell);
        }
      }

      const opponents = this.writeOam();
      this.engine.write(0xF2008, (writeBank << 1) | writeBank);
      this.engine.tick();
      const pixels = new Uint8ClampedArray(this.engine.render());
      this.frame++;
      this.lastStats = {
        scene: this.sceneName,
        frame: this.frame,
        horizonY: horizon.y,
        horizonRow: horizon.row,
        roadRows: rows.filter((row) => row.road).length,
        tileWrites: COLS * ROWS,
        changedCells,
        visibleOpponents: opponents.length,
        displayBank: this.engine.mapDisplay,
      };
      return pixels;
    }

    state() {
      return {
        scene: this.sceneName,
        frame: this.frame,
        cameraZ: this.cameraZ,
        playerOffset: this.playerOffset,
        horizon: this.horizon(),
        roadRows: this.roadRows(),
        opponents: this.scene.opponents.map((object) => this.projectObject(object)),
        stats: this.lastStats,
      };
    }
  }

  globalThis.Deep16PoleRenderer = Deep16PoleRenderer;
})();
