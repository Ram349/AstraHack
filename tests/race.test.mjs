import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createDriveState, stepDrivetrain, RACE_CONFIG } from '../public/racing.mjs';
import { TourDirector, TOUR_ZONES, zoneAt } from '../public/singapore-tour.mjs';

await RAPIER.init();
const source = fs.readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');

// Execute the actual game's physics and update functions against real Rapier.
// Only the browser HUD/audio are stubbed; wheel/brake/steering math is unchanged.
function rig() {
  const element = () => ({ textContent: '', style: {}, classList: { toggle() {} } });
  const keys = new Set();
  const state = { x: 0, z: -6, speed: 0, heading: 0, steering: 0 };
  const context = vm.createContext({ THREE, RAPIER, console: { log() {} },
    CAR_CONFIG: RACE_CONFIG, drive: createDriveState(), stepDrivetrain,
    car: new THREE.Group(), carState: state, carBaseY: 0, raceSurfaceY: 0,
    SPAWN_POSITION: { x: 0, y: 0, z: -6 }, SPAWN_HEADING: 0,
    previousPose: { position: new THREE.Vector3(), rotation: new THREE.Quaternion() },
    currentPose: { position: new THREE.Vector3(), rotation: new THREE.Quaternion() },
    presentation: { phase: 'countdown' }, document: { hidden: false, querySelector: element },
    isDown: (...names) => names.some(name => keys.has(name)),
    updateCommentary() {}, updateLapTimer() {}, reduceMotion: true, steeringSensitivity: 1,
    raceSound: { update() {} }, engineMuted: true, realtimeConnected: () => false,
    playerSpeaking: false, pushToTalkActive: false,
    speedEl: element(), gearEl: element(), rpmEl: element(), boostEl: element(),
    throttleEl: element(), boostLabelEl: element(), raceDash: element(),
  });
  const physics = source.slice(source.indexOf('const PHYSICS_STEP'), source.indexOf('const keys = new Set();'));
  const update = source.slice(source.indexOf('function updateCar(dt)'), source.indexOf('// ---------- Cinematic introduction'));
  vm.runInContext(physics + '\n' + update + '\n' + `globalThis.harness = {
    init: () => initialisePhysics(0, new THREE.Box3(new THREE.Vector3(-1000,0,-1000),new THREE.Vector3(1000,100,1000))),
    tick: () => updateCar(1/60),
    start: () => { presentation.phase = 'racing'; },
    drive, state: carState,
    close: () => { vehicleController.free(); physicsWorld.free(); }
  };`, context);
  context.harness.init();
  return { ...context.harness, keys };
}

test('countdown holds the grid even with throttle; GO releases forward acceleration', () => {
  const car = rig(); car.keys.add('w');
  for (let i = 0; i < 180; i++) car.tick();
  assert.ok(Math.abs(car.state.z + 6) < 0.1, 'held behind start line');
  car.start(); let zeroTo100 = null;
  for (let i = 0; i < 360; i++) { car.tick(); if (!zeroTo100 && car.state.speed >= 100 / 3.6) zeroTo100 = i / 60; }
  assert.ok(car.state.z > 50, 'car actually translates forward');
  assert.ok(zeroTo100 > 0 && zeroTo100 < 6, 'race-like acceleration');
  assert.ok(car.drive.gear > 2, 'gears change with speed');
  console.log('Measured 0–100 km/h:', zeroTo100, 'seconds; six-second speed:', Math.round(car.state.speed * 3.6));
  car.keys.delete('w'); car.keys.add(' ');
  for (let i = 0; i < 240; i++) car.tick();
  assert.ok(Math.abs(car.state.speed) < 1, 'brakes stop the vehicle');
  car.close();
});

test('brief steering input changes direction without spinning or excessive sideways slip', () => {
  const car = rig();
  for (let i = 0; i < 90; i++) car.tick();
  car.start(); car.keys.add('w');
  for (let i = 0; i < 210; i++) car.tick();
  const before = car.state.heading;
  car.keys.add('a');
  for (let i = 0; i < 12; i++) car.tick();
  const delta = Math.abs(car.state.heading - before);
  assert.ok(delta > 0.001 && delta < 0.15, 'tap makes a modest direction correction');
  assert.ok(car.drive.slip < 4, 'lateral slip stays controlled');
  console.log('200 ms steering correction:', (delta * 180 / Math.PI).toFixed(2), 'degrees; slip:', car.drive.slip.toFixed(2), 'm/s');
  car.close();
});

test('boost adds force, depletes and recharges without pulsing when held empty', () => {
  const base = createDriveState(), boost = createDriveState();
  let normalForce, boostForce;
  for (let i = 0; i < 90; i++) {
    normalForce = stepDrivetrain(base, 35, { accelerate: true }, 1/60).engine;
    boostForce = stepDrivetrain(boost, 35, { accelerate: true, boost: true }, 1/60).engine;
  }
  assert.ok(boostForce > normalForce * 1.25);
  for (let i = 0; i < 600; i++) stepDrivetrain(boost, 35, { accelerate: true, boost: true }, 1/60);
  assert.equal(boost.boosting, false); assert.equal(boost.boostLocked, true);
  for (let i = 0; i < 900; i++) stepDrivetrain(boost, 35, { accelerate: true }, 1/60);
  assert.equal(boost.boost, 1); assert.equal(boost.boostLocked, false);
});

test('tour detects real zones, avoids stale transitions and continues without talking over a response', () => {
  for (const zone of TOUR_ZONES) assert.equal(zoneAt(zone.x, zone.z)?.id, zone.id);
  assert.equal(zoneAt(3000, 3000), null);
  const tour = new TourDirector(), drive = createDriveState();
  tour.updateLocation(-603, 241, 0); tour.updateLocation(-603, 241, 1);
  const first = tour.next(3, drive, 0);
  assert.equal(first.area, 'Pit Straight');
  assert.equal(tour.next(20, drive, 0, true), null, 'speech wins over automatic comments');
  assert.ok(tour.next(20, drive, 0), 'commentary resumes after playback');
  tour.updateLocation(364, 121, 21); tour.updateLocation(364, 121, 22);
  const landmark = tour.next(40, drive, 20);
  assert.equal(landmark.area, 'Esplanade');
  assert.ok(landmark.fact.includes('durian'));
  assert.notEqual(tour.next(65, drive, 20).text, landmark.text, 'no immediate repeat');
});
