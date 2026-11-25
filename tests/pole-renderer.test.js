// Milestone-1 checks for the headless Pole Position-style FiT renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPoleScene } from '../scripts/render_pole.mjs';

function scene(name) {
  return renderPoleScene(name, 1, 1);
}

function pixel(rgba, width, x, y) {
  const at = (y * width + x) * 4;
  return [rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]];
}

test('a straight road widens toward the camera and remains centred', () => {
  const { renderer } = scene('straight');
  const road = renderer.roadRows().filter((row) => row.road);
  const far = road[0];
  const near = road[road.length - 1];
  assert.ok(near.widthFactor > 0.99 && near.widthFactor < 1.01);
  assert.ok(near.right - near.left > (far.right - far.left) * 8,
    'the near road must be much wider than the horizon road');
  for (const row of road) {
    assert.ok(Math.abs(row.center - 320) < 0.001,
      `straight row ${row.row} moved to ${row.center}`);
  }
});

test('the curve scene bends the road away from the straight centre line', () => {
  const straight = scene('straight').renderer.roadRows().filter((row) => row.road);
  const curved = scene('curve').renderer.roadRows().filter((row) => row.road);
  const difference = curved.map((row, i) => Math.abs(row.center - straight[i].center));
  assert.ok(Math.max(...difference) > 20,
    `expected a visible curve, largest centre shift was ${Math.max(...difference)}px`);
  assert.ok(curved.some((row) => row.center < 350) && curved.some((row) => row.center > 370),
    'the curve should move different depth bands by different amounts');
});

test('hill and width scenes exercise their separate projection inputs', () => {
  const straight = scene('straight').renderer;
  const hill = scene('hill').renderer;
  const width = scene('width').renderer;
  assert.ok(Math.abs(hill.horizon().y - straight.horizon().y) > 5,
    'the hill scene must move the horizon');
  assert.notEqual(hill.horizon().row, straight.horizon().row,
    'the hill scene must change the horizon row');

  const factors = width.roadRows().filter((row) => row.road).map((row) => row.widthFactor);
  assert.ok(Math.max(...factors) - Math.min(...factors) > 0.3,
    'the width scene must contain a broad width change');
});

test('opponents project higher and smaller as their distance increases', () => {
  const { renderer } = scene('straight');
  const opponents = renderer.scene.opponents.map((object) => renderer.projectObject(object));
  const near = opponents[0];
  const far = opponents[opponents.length - 1];
  assert.ok(far.groundY < near.groundY, 'a farther object must be higher on screen');
  assert.ok(far.width < near.width, 'a farther object must be narrower');
  assert.notEqual(near.group, far.group, 'the prototype must use distinct scale groups');
  for (const object of opponents) {
    assert.ok(Number.isFinite(object.x) && Number.isFinite(object.y));
    assert.ok(object.y >= 0 && object.groundY <= 360);
  }
});

test('the same scene and frame produce identical pixels', () => {
  const first = scene('curve').images[0];
  const second = scene('curve').images[0];
  assert.deepEqual(first, second, 'the headless prototype must be deterministic');
});

test('rendering uses the FiT map banks, OAM, art palette, and sprite palette', () => {
  const result = scene('curve');
  const { engine, renderer } = result;
  assert.equal(engine.mapDisplay, 1, 'the first frame must swap to the back bank');
  assert.equal(engine.mapWrite, 1);
  assert.ok((engine.oam[0] & 0x0800) !== 0, 'the player sprite must be enabled');
  assert.equal((engine.oam[1] >> 11) & 0x1F, 0, 'the player must use group 0');
  assert.ok((engine.oam[2] & 0x0800) !== 0, 'an opponent sprite must be enabled');

  // A visible cell is an art-mode cell in the 96..127 game-art range.
  const cell = engine.tilemap[engine.mapDisplay][6 * engine.MAP_COLS + 20];
  assert.equal(cell & 0x8000, 0, 'road cells must use art mode');
  assert.ok((cell & 0x1FF) >= 96, 'road cells must use game-art tiles');
  assert.ok(engine.palette[0x10] !== 0, 'the art palette must be populated');
  assert.ok(engine.palette[0x20 + 1] !== 0, 'the sprite palette must be populated');

  const rgba = result.images[0];
  assert.deepEqual(pixel(rgba, result.width, 5, 10).slice(0, 3),
    pixel(rgba, result.width, 635, 10).slice(0, 3),
    'the sky should span the top of the frame');
  assert.notDeepEqual(pixel(rgba, result.width, 320, 345).slice(0, 3),
    pixel(rgba, result.width, 5, 345).slice(0, 3),
    'road and grass must be visibly different at the bottom');

  renderer.advance(1 / 60);
  renderer.renderFrame();
  assert.equal(engine.mapDisplay, 0, 'the next frame must swap back to bank 0');
});
