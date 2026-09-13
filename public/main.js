import * as THREE from 'three';
import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from '/vendor/three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from '/vendor/three/examples/jsm/libs/meshopt_decoder.module.js';
import RAPIER from '/vendor/rapier/rapier.mjs';
import { RACE_CONFIG, createDriveState, stepDrivetrain } from './racing.mjs';
import { TourDirector } from './singapore-tour.mjs';
import { SitesRaceConnection } from './online-race.mjs';

// Rapier's compatibility build embeds its WebAssembly runtime, so serving this
// module locally keeps the game self-contained while still using real rigid-body
// and ray-cast vehicle physics.
await RAPIER.init();

// ---------- Scene setup ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

// Verified in the loaded scene using the temporary overhead debug camera.
// The line is fixed on the road and the car stages a few metres behind it, so
// the first proper crossing is visibly the beginning of the lap.
// Ray-picked on 11861Mtl racing asphalt between the main grandstand and pit
// buildings. Two centreline picks determine the heading along the straight.
const SPAWN_HEADING = Math.atan2(5.1789118, 48.4898394);
const START_FINISH_POSITION = { x: -603.00195, y: 47.68951, z: 241.11775 };
// A full F1 car is long enough to cover a nearby stripe; six metres keeps the
// entire car behind the grid and leaves the chequers plainly visible ahead.
const SPAWN_DISTANCE_BEHIND_LINE = 6;
const SPAWN_POSITION = {
  x: START_FINISH_POSITION.x - Math.sin(SPAWN_HEADING) * SPAWN_DISTANCE_BEHIND_LINE,
  y: START_FINISH_POSITION.y,
  z: START_FINISH_POSITION.z - Math.cos(SPAWN_HEADING) * SPAWN_DISTANCE_BEHIND_LINE,
};
const START_FINISH = {
  x: START_FINISH_POSITION.x,
  z: START_FINISH_POSITION.z,
  heading: SPAWN_HEADING,
  width: 14.2,
  depth: 2.4,
  leaveDistance: 18,
};

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  10000,
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(20, 30, 10);
scene.add(sun);

// ---------- Ground ----------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x3a7d44 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(200, 40, 0x222222, 0x444444);
scene.add(grid);

// ---------- Track ----------
// Kept as a fallback while the GLB loads and for local debugging.
ground.visible = false;
grid.visible = false;

const debugMode = new URLSearchParams(window.location.search).get('debug') === '1';
const inspectMode = new URLSearchParams(window.location.search).get('inspect') === '1';
let controls = null;
let trackRoot = null;
let startFinishLine = null;

function createStartFinishLine(surfaceY) {
  if (startFinishLine) return;
  startFinishLine = new THREE.Group();
  startFinishLine.position.set(START_FINISH.x, surfaceY + 0.055, START_FINISH.z);
  startFinishLine.rotation.y = START_FINISH.heading;

  const squaresAcross = 8;
  const squaresDeep = 2;
  const squareWidth = START_FINISH.width / squaresAcross;
  const squareDepth = START_FINISH.depth / squaresDeep;
  // Polygon offset keeps the tiles above the model's road surface without the
  // depth-buffer fighting that previously made the chequers disappear/flicker.
  const checkerMaterial = (color) => new THREE.MeshBasicMaterial({
    color,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const white = checkerMaterial(0xf8fafc);
  const black = checkerMaterial(0x101318);
  for (let row = 0; row < squaresDeep; row += 1) {
    for (let column = 0; column < squaresAcross; column += 1) {
      const tile = new THREE.Mesh(
        new THREE.PlaneGeometry(squareWidth, squareDepth),
        (row + column) % 2 === 0 ? white : black,
      );
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(
        (column - (squaresAcross - 1) / 2) * squareWidth,
        0,
        (row - (squaresDeep - 1) / 2) * squareDepth,
      );
      tile.renderOrder = 10;
      startFinishLine.add(tile);
    }
  }

  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xf3c432 });
  [-1, 1].forEach((side) => {
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, START_FINISH.depth + 0.28), markerMaterial);
    marker.position.set(side * (START_FINISH.width / 2 + 0.12), 0.25, 0);
    startFinishLine.add(marker);
  });
  scene.add(startFinishLine);
}

const textureAlphaCache = new WeakMap();
async function textureUsesTransparency(texture) {
  if (textureAlphaCache.has(texture)) return textureAlphaCache.get(texture);
  const image = texture.image;
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparentPixels = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 245) transparentPixels += 1;
  }
  const transparencyRatio = transparentPixels / (pixels.length / 4);
  textureAlphaCache.set(texture, transparencyRatio);
  return transparencyRatio;
}

if (debugMode) {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
}

const trackLoader = new GLTFLoader();
trackLoader.setMeshoptDecoder(MeshoptDecoder);
trackLoader.load(
  '/models/marina-bay-track.glb',
  (gltf) => {
    trackRoot = gltf.scene;
    // The supplied environment contains billboard-style foliage, fencing, and
    // seating textures with transparent pixels. The optimized GLB marks every
    // material opaque, which renders those pixels as black panels. Alpha test
    // restores clean cutouts without the depth-sorting artifacts of blending.
    const materialConfiguration = [];
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!material) return;
        if (material.name === '11861Mtl') {
          // This source layer overlaps 151Mtl exactly on the circuit surface.
          // Pull the painted asphalt forward to eliminate z-fighting with the
          // black underlay while preserving the valid road texture.
          material.polygonOffset = true;
          material.polygonOffsetFactor = -2;
          material.polygonOffsetUnits = -2;
        }
        material.roughness = Math.min(material.roughness ?? 0.65, 0.5);
        material.metalness = Math.max(material.metalness ?? 0, 0.06);
        materialConfiguration.push(material);
      });
    });
    scene.add(gltf.scene);
    Promise.all([...new Set(materialConfiguration)].map(async (material) => {
      const transparencyRatio = material.map ? await textureUsesTransparency(material.map) : 0;
      const isCutout = transparencyRatio > 0.25;
      const isBlended = transparencyRatio > 0 && !isCutout;
      material.transparent = isBlended;
      material.alphaTest = isCutout ? 0.12 : 0;
      material.alphaToCoverage = isCutout;
      material.depthWrite = !isBlended;
      material.needsUpdate = true;
    })).then(() => console.log('configured stable alpha materials'));
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());
    console.log('track bounds', JSON.stringify({ min: box.min, max: box.max, center }));
    const spawnRay = new THREE.Raycaster(
      new THREE.Vector3(SPAWN_POSITION.x, box.max.y + 10, SPAWN_POSITION.z),
      new THREE.Vector3(0, -1, 0),
    );
    const spawnHits = spawnRay.intersectObject(gltf.scene, true);
    if (spawnHits.length > 0) {
      carBaseY = spawnHits[0].point.y + 0.4;
      car.position.y = carBaseY;
      console.log('verified spawn surface', JSON.stringify(spawnHits[0].point));
      createStartFinishLine(spawnHits[0].point.y);
      initialisePhysics(spawnHits[0].point.y, box);
    } else {
      console.warn('No track surface found below spawn position');
      createStartFinishLine(SPAWN_POSITION.y);
      initialisePhysics(SPAWN_POSITION.y, box);
    }
    if (debugMode) {
      const params = new URLSearchParams(window.location.search);
      const debugNumber = (key, fallback) => {
        const number = Number(params.get(key) ?? fallback);
        return Number.isFinite(number) ? number : fallback;
      };
      const focusX = debugNumber('x', 350);
      const focusZ = debugNumber('z', 350);
      camera.position.set(focusX, debugNumber('height', 650), focusZ);
      controls.target.set(focusX, 0, focusZ);
      camera.lookAt(controls.target);
      controls.update();
      console.log('debug camera position', JSON.stringify(camera.position), 'target', JSON.stringify(controls.target));
    }
  },
  undefined,
  (error) => console.error('Failed to load Marina Bay track:', error),
);

if (inspectMode) {
  window.addEventListener('pointerdown', (event) => {
    if (!trackRoot) return;
    const pointer = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(trackRoot, true);
    const hit = hits[0];
    if (!hit) return;
    const group = hit.object.geometry.groups.find((item) => (
      hit.faceIndex * 3 >= item.start && hit.faceIndex * 3 < item.start + item.count
    ));
    const material = Array.isArray(hit.object.material)
      ? hit.object.material[group?.materialIndex ?? 0]
      : hit.object.material;
    console.log('inspect material', JSON.stringify({
      name: material?.name,
      index: group?.materialIndex,
      point: hit.point,
      layers: hits.slice(0, 12).map((layer) => ({
        name: Array.isArray(layer.object.material)
          ? layer.object.material[0]?.name
          : layer.object.material?.name,
        distance: Math.round(layer.distance * 100) / 100,
      })),
    }));
  });
}

// ---------- Cars ----------
// Formula-style dimensions in the track's world units: 5.4 long × 2.15 wide.
// This keeps two cars comfortably side-by-side on the racing surface.
function createF1Car(color) {
  const carGroup = new THREE.Group();
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.52,
    roughness: 0.18,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
  });
  const carbonMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x101218,
    metalness: 0.62,
    roughness: 0.22,
    clearcoat: 0.45,
  });
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x090a0d, roughness: 0.76 });
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xb9c1ca, metalness: 0.9, roughness: 0.2 });
  const brakeMaterial = new THREE.MeshStandardMaterial({ color: 0xe8a319, metalness: 0.72, roughness: 0.28 });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x142b3f,
    metalness: 0.35,
    roughness: 0.08,
    clearcoat: 1,
  });
  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    carGroup.add(mesh);
    return mesh;
  };

  // Smooth, layered bodywork gives the car a recognisable F1 silhouette
  // without changing its calibrated physics footprint below.
  add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.18, 3.8), carbonMaterial), 0, 0.3, -0.08);
  const monocoque = add(
    new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.3, 2.42, 16), bodyMaterial),
    0, 0.67, -0.1,
  );
  monocoque.rotation.x = Math.PI / 2;
  monocoque.scale.x = 1.08;

  const nose = add(new THREE.Mesh(new THREE.ConeGeometry(0.43, 2.35, 16), bodyMaterial), 0, 0.42, 2.42);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(0.84, 0.84, 1);

  [-1, 1].forEach((side) => {
    const sidepod = add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 10), bodyMaterial), side * 0.67, 0.5, -0.22);
    sidepod.scale.set(1, 0.48, 1.55);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 1.5), carbonMaterial), side * 0.92, 0.45, -0.32);
  });
  const engineFin = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.64, 0.92), carbonMaterial), 0, 1.18, -1.03);
  engineFin.rotation.z = -0.12;

  const cockpit = add(new THREE.Mesh(new THREE.SphereGeometry(0.53, 20, 12), glassMaterial), 0, 0.89, -0.15);
  cockpit.scale.set(0.98, 0.54, 1.25);
  const driverHelmet = add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), bodyMaterial), 0, 1.06, -0.18);
  driverHelmet.scale.set(1, 0.88, 1.05);

  // Halo and intake add depth in the close rear chase view.
  const halo = add(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 6, 20), carbonMaterial), 0, 0.98, -0.1);
  halo.rotation.x = Math.PI / 2;
  halo.scale.set(1, 0.8, 1);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.08), carbonMaterial), 0, 1.1, 0.3);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.46), carbonMaterial), 0, 1.34, -0.78);

  // Front wing, flaps and endplates.
  add(new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.07, 0.32), carbonMaterial), 0, 0.17, 3.16);
  add(new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.06, 0.22), carbonMaterial), 0, 0.25, 3.39);
  [-1, 1].forEach((side) => {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.56), carbonMaterial), side * 1.12, 0.31, 3.25);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.18), bodyMaterial), side * 0.56, 0.27, 2.92);
  });

  // A proper rear spoiler is prominent in the driving view, rather than a
  // single block. Its two elements and tall endplates make the back readable.
  add(new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.09, 0.18), carbonMaterial), 0, 1.28, -2.04);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.16), carbonMaterial), 0, 1.48, -1.91);
  [-1, 1].forEach((side) => {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.42), carbonMaterial), side * 0.94, 1.22, -1.98);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.12), bodyMaterial), side * 0.34, 0.9, -1.78);
  });
  const exhaust = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.32, 12), rimMaterial), 0, 0.7, -1.85);
  exhaust.rotation.x = Math.PI / 2;
  [-0.48, 0, 0.48].forEach((x) => add(
    new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.62), carbonMaterial),
    x, 0.18, -1.88,
  ));

  const wheelGeometry = new THREE.CylinderGeometry(0.46, 0.46, 0.36, 24);
  const wheelPositions = [
    [-1.0, 0.46, 1.62], [1.0, 0.46, 1.62],
    [-0.93, 0.5, -1.5], [0.93, 0.5, -1.5],
  ];
  carGroup.userData.wheels = [];
  wheelPositions.forEach(([x, y, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const spin = new THREE.Group();
    pivot.add(spin); carGroup.add(pivot);
    carGroup.userData.wheels.push({ pivot, spin });
    const wheel = new THREE.Mesh(wheelGeometry, tireMaterial);
    wheel.rotation.z = Math.PI / 2;
    spin.add(wheel);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.37, 20), rimMaterial);
    rim.rotation.z = Math.PI / 2;
    spin.add(rim);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.382, 16), brakeMaterial);
    brake.rotation.z = Math.PI / 2;
    spin.add(brake);
  });

  return carGroup;
}

const car = createF1Car(0xdc2028);
car.position.set(SPAWN_POSITION.x, SPAWN_POSITION.y, SPAWN_POSITION.z);
scene.add(car);

const carState = {
  x: SPAWN_POSITION.x,
  z: SPAWN_POSITION.z,
  heading: SPAWN_HEADING, // radians
  speed: 0,
  steering: 0,
};
let carBaseY = SPAWN_POSITION.y;

// ---------- Lap timing ----------
// The car stages behind the chequered grid. The live clock begins only when it
// crosses the grid forward, then finishes only after a full circuit returns to
// that same line in the correct direction.
const lapTimerEl = document.querySelector('#lap-timer');
const lapTimeEl = document.querySelector('#lap-time');
const lapState = {
  phase: 'staged',
  startedAt: 0,
  previousProgress: -SPAWN_DISTANCE_BEHIND_LINE,
  leftStartZone: false,
  lastLapMs: null,
};

function formatLapTime(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function startFinishCoordinates() {
  const dx = carState.x - START_FINISH.x;
  const dz = carState.z - START_FINISH.z;
  const forwardX = Math.sin(START_FINISH.heading);
  const forwardZ = Math.cos(START_FINISH.heading);
  const rightX = Math.cos(START_FINISH.heading);
  const rightZ = -Math.sin(START_FINISH.heading);
  return {
    progress: dx * forwardX + dz * forwardZ,
    lateral: dx * rightX + dz * rightZ,
  };
}

function updateLapTimer() {
  const { progress, lateral } = startFinishCoordinates();
  const onTrackWidth = Math.abs(lateral) <= START_FINISH.width / 2 + 0.5;

  const crossedStartForward = lapState.previousProgress < 0 && progress >= 0;
  if (lapState.phase === 'staged' && onTrackWidth && crossedStartForward) {
    lapState.phase = 'racing';
    lapState.startedAt = performance.now();
    lapState.leftStartZone = false;
    lapTimerEl.classList.remove('complete');
    sayCommentary('Clock is running now. Smooth and steady, can or not?', 'cheering');
  }

  if (lapState.phase === 'racing') {
    const elapsed = performance.now() - lapState.startedAt;
    lapTimeEl.textContent = formatLapTime(elapsed);
    lapTimerEl.querySelector('small').textContent = 'LAP 1 — LIVE';
    if (Math.hypot(carState.x - START_FINISH.x, carState.z - START_FINISH.z) > START_FINISH.leaveDistance) {
      lapState.leftStartZone = true;
    }
    if (lapState.leftStartZone && onTrackWidth && crossedStartForward) {
      lapState.phase = 'complete';
      lapState.lastLapMs = elapsed;
      lapTimeEl.textContent = formatLapTime(elapsed);
      lapTimerEl.querySelector('small').textContent = 'LAP 1 COMPLETE';
      lapTimerEl.classList.add('complete');
      sayCommentary(`Full circuit complete in ${formatLapTime(elapsed)}. Wah, not bad lah!`, 'cheering');
    }
  }

  lapState.previousProgress = progress;
}

const CAR_CONFIG = RACE_CONFIG;
const drive = createDriveState();
let raceSurfaceY = START_FINISH_POSITION.y;
const previousPose = { position: new THREE.Vector3(), rotation: new THREE.Quaternion() };
const currentPose = { position: new THREE.Vector3(), rotation: new THREE.Quaternion() };

// ---------- Rapier vehicle physics ----------
// The body is intentionally separate from the render mesh: the chassis' centre
// of mass sits above the visible car origin, while the four Rapier ray-cast
// wheels provide the suspension, grip, engine force, and braking.
const PHYSICS_STEP = 1 / 60;
const CHASSIS_HEIGHT = 0.58;
let physicsWorld = null;
let chassisBody = null;
let vehicleController = null;
let physicsReady = false;
let physicsAccumulator = 0;

function makeTrackCollision(bounds, surfaceY) {
  const trackBody = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  // The supplied GLB uses dozens of overlapping decorative planes for trees,
  // grandstands, and asphalt decals. Turning every render triangle into a
  // collider makes invisible foliage pin the car. Use a clean physical racing
  // surface underneath the circuit instead; the chassis, suspension, gravity,
  // tyre slip and braking are all still simulated by Rapier.
  const floor = RAPIER.ColliderDesc.cuboid(
    Math.max((bounds.max.x - bounds.min.x) * 0.75, 500),
    0.25,
    Math.max((bounds.max.z - bounds.min.z) * 0.75, 500),
  )
    .setTranslation(
      (bounds.min.x + bounds.max.x) / 2,
      surfaceY - 0.25,
      (bounds.min.z + bounds.max.z) / 2,
    )
    .setFriction(1.25)
    .setRestitution(0.02);
  physicsWorld.createCollider(floor, trackBody);
  console.log('Rapier: clean circuit driving surface ready');
}

function initialisePhysics(surfaceY, trackBounds) {
  if (physicsReady) return;

  raceSurfaceY = surfaceY;
  physicsWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  makeTrackCollision(trackBounds, surfaceY);

  const initialRotation = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), SPAWN_HEADING);
  const chassisDescription = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(SPAWN_POSITION.x, surfaceY + CHASSIS_HEIGHT, SPAWN_POSITION.z)
    .setRotation(initialRotation)
    .enabledRotations(false, true, false)
    .setLinearDamping(0.04)
    .setAngularDamping(4.5)
    .setCcdEnabled(true)
    .setAdditionalSolverIterations(4);
  chassisBody = physicsWorld.createRigidBody(chassisDescription);
  physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(0.68, 0.22, 1.42)
      .setTranslation(0, -0.02, 0)
      .setFriction(0.9)
      .setRestitution(0.05)
      .setMass(680),
    chassisBody,
  );

  vehicleController = new RAPIER.DynamicRayCastVehicleController(
    chassisBody,
    physicsWorld.broadPhase,
    physicsWorld.narrowPhase,
    physicsWorld.bodies,
    physicsWorld.colliders,
  );
  vehicleController.indexUpAxis = 1;
  // Rapier exposes the forward-axis setter under this explicit name.
  vehicleController.setIndexForwardAxis = 2;

  const wheelConnections = [
    { x: -0.98, y: -0.12, z: 1.62, front: true },
    { x: 0.98, y: -0.12, z: 1.62, front: true },
    { x: -0.94, y: -0.1, z: -1.5, front: false },
    { x: 0.94, y: -0.1, z: -1.5, front: false },
  ];
  wheelConnections.forEach((wheel) => {
    vehicleController.addWheel(
      wheel,
      { x: 0, y: -1, z: 0 },
      { x: -1, y: 0, z: 0 },
      0.16,
      0.46,
    );
    const wheelIndex = vehicleController.numWheels() - 1;
    vehicleController.setWheelSuspensionStiffness(wheelIndex, 38);
    vehicleController.setWheelSuspensionCompression(wheelIndex, 4.8);
    vehicleController.setWheelSuspensionRelaxation(wheelIndex, 5.8);
    vehicleController.setWheelMaxSuspensionForce(wheelIndex, 14000);
    vehicleController.setWheelFrictionSlip(wheelIndex, 5.8);
    vehicleController.setWheelSideFrictionStiffness(wheelIndex, 1.35);
  });

  physicsReady = true;
  syncCarFromPhysics();
  previousPose.position.copy(currentPose.position);
  previousPose.rotation.copy(currentPose.rotation);
  console.log('Rapier vehicle ready');
}

function syncCarFromPhysics() {
  const translation = chassisBody.translation();
  const rotation = chassisBody.rotation();
  currentPose.position.set(translation.x, translation.y - CHASSIS_HEIGHT, translation.z);
  currentPose.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
  carState.x = translation.x;
  carState.z = translation.z;
  carBaseY = currentPose.position.y;

  const velocity = chassisBody.linvel();
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(currentPose.rotation);
  carState.heading = Math.atan2(forward.x, forward.z);
  carState.speed = velocity.x * forward.x + velocity.z * forward.z;
}

const keys = new Set();
const drivingKeys = new Set(['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' ']);
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLInputElement
    && (event.target.type !== 'range' || event.key.startsWith('Arrow')))) return;
  if (drivingKeys.has(event.key.toLowerCase())) event.preventDefault();
  keys.add(event.key.toLowerCase());
  if (!event.repeat && event.key.toLowerCase() === 'r') resetRace();
  if (!event.repeat && event.key.toLowerCase() === 'v') beginPushToTalk();
});
window.addEventListener('keyup', (event) => {
  keys.delete(event.key.toLowerCase());
  if (event.key.toLowerCase() === 'v') endPushToTalk();
});
window.addEventListener('blur', () => { keys.clear(); endPushToTalk(); });
document.addEventListener('visibilitychange', () => {
  keys.clear();
});

const commentaryLineEl = document.querySelector('#commentary-line');
const auntyPetEl = document.querySelector('#aunty-pet');
const auntyStatusEl = document.querySelector('#aunty-status');
const voiceToggle = document.querySelector('#voice-toggle');
const tour = new TourDirector();
let realtimePeer = null;
let realtimeChannel = null;
let realtimeMicrophone = null;
let realtimeResponding = false;
let realtimeSpeaking = false;
let playerSpeaking = false;
let realtimeTranscript = '';
let responseStartedAt = 0;
let connectionAttempt = 0;
let lastTelemetryAt = 0;
let voiceErrorUntil = 0;
let pushToTalkMode = false;
let pushToTalkActive = false;
let pushToTalkStartedAt = 0;
const micModeEl = document.querySelector('#mic-mode');
const realtimeAudio = new Audio();
realtimeAudio.autoplay = true;
const nowSeconds = () => performance.now() / 1000;

function updateVoiceButton(label, active = false) {
  voiceToggle.textContent = label;
  voiceToggle.setAttribute('aria-pressed', String(active));
}
function realtimeConnected() { return realtimeChannel?.readyState === 'open'; }
function configureMicrophone() {
  realtimeMicrophone?.getAudioTracks().forEach(track => { track.enabled = !pushToTalkMode || pushToTalkActive; });
  micModeEl.textContent = pushToTalkMode ? 'Mic: hold V · click for auto' : 'Mic: auto · V to talk';
  sendRealtimeEvent({ type: 'session.update', session: { type: 'realtime', audio: { input: {
    noise_reduction: { type: 'near_field' },
    turn_detection: pushToTalkMode ? null : { type: 'server_vad', threshold: 0.68,
      prefix_padding_ms: 300, silence_duration_ms: 700, create_response: true, interrupt_response: true },
  } } } });
}
function beginPushToTalk() {
  if (!realtimeConnected() || pushToTalkActive) return;
  pushToTalkMode = true; pushToTalkActive = true;
  pushToTalkStartedAt = nowSeconds(); playerSpeaking = true;
  configureMicrophone();
  if (realtimeResponding) sendRealtimeEvent({ type: 'response.cancel' });
  sendRealtimeEvent({ type: 'output_audio_buffer.clear' });
  sendRealtimeEvent({ type: 'input_audio_buffer.clear' });
  setAuntyTalking(false);
  auntyPetEl.classList.add('listening');
  auntyStatusEl.textContent = 'LISTENING · RELEASE V TO SEND';
  publishDrivingContext();
}
function endPushToTalk() {
  if (!pushToTalkActive) return;
  pushToTalkActive = false; playerSpeaking = false;
  realtimeMicrophone?.getAudioTracks().forEach(track => { track.enabled = false; });
  auntyPetEl.classList.remove('listening');
  if (nowSeconds() - pushToTalkStartedAt > 0.15 && realtimeConnected()) {
    sendRealtimeEvent({ type: 'input_audio_buffer.commit' });
    sendRealtimeEvent({ type: 'response.create', response: { output_modalities: ['audio'] } });
    realtimeResponding = true; responseStartedAt = nowSeconds();
    auntyStatusEl.textContent = 'AUNTY MEI · REPLYING TO YOU';
  } else sendRealtimeEvent({ type: 'input_audio_buffer.clear' });
  tour.postpone(nowSeconds(), 5);
}
micModeEl.addEventListener('click', () => {
  endPushToTalk(); pushToTalkMode = !pushToTalkMode; configureMicrophone();
});
function setAuntyExpression(expression = 'idle') {
  auntyPetEl.dataset.expression = expression;
  auntyPetEl.setAttribute('aria-label', 'Aunty Mei: ' + expression);
}
function setAuntyTalking(talking) {
  realtimeSpeaking = talking;
  auntyPetEl.classList.toggle('talking', talking);
  if (talking) {
    auntyPetEl.classList.remove('listening');
    setAuntyExpression('talking');
    auntyStatusEl.textContent = 'AUNTY MEI · ON AIR';
  } else {
    setAuntyExpression('idle');
    auntyStatusEl.textContent = realtimeConnected() ? 'AUNTY MEI · PIT RADIO' : 'AUNTY MEI · SUBTITLES';
  }
}
function waitForIceGathering(peer) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', changed); };
    const changed = () => { if (peer.iceGatheringState === 'complete') { cleanup(); resolve(); } };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Voice connection timed out. Please try again.')); }, 12000);
    peer.addEventListener('icegatheringstatechange', changed);
  });
}
function sendRealtimeEvent(event) {
  if (!realtimeConnected()) return false;
  realtimeChannel.send(JSON.stringify(event));
  return true;
}
function drivingContext() {
  return 'Controls: hold W/Up to accelerate, S/Down to brake/reverse, A/D to steer, Shift for boost, R to restart. Automatic gears, NO clutch pedal. '
    + 'Current game area: ' + (tour.zone?.name || 'between named landmarks on the Marina Bay circuit')
    + '. Speed ' + Math.round(Math.abs(carState.speed) * 3.6) + ' km/h; gear ' + drive.gear
    + '; throttle ' + Math.round(drive.throttle * 100) + '%; braking ' + Math.round(drive.brake * 100)
    + '%; boost ' + (drive.boosting ? 'active' : 'off') + '; race phase ' + presentation.phase + '.';
}
function publishDrivingContext() {
  sendRealtimeEvent({ type: 'conversation.item.create', item: {
    type: 'message', role: 'system', content: [{ type: 'input_text',
      text: 'GAME CONTEXT (not player speech). ' + drivingContext()
        + (tour.zone ? ' Verified local facts: ' + tour.zone.facts.join(' ') : ' Do not claim a specific landmark is beside the car.') }],
  } });
  lastTelemetryAt = nowSeconds();
}
function requestAuntyReply(item) {
  if (!realtimeConnected() || realtimeResponding || realtimeSpeaking || playerSpeaking) return false;
  const prompt = item.kind === 'landmark'
    ? drivingContext() + ' TOUR TOPIC: ' + (item.area ? 'Near ' + item.area + '.' : 'General Singapore story, not a nearby landmark.')
      + ' Use this verified fact: ' + item.fact + '. Say the area name and what it is known for, then one playful aside.'
    : drivingContext() + ' PIT-WALL COMMENT: ' + item.text + '. Respond naturally in your own voice.';
  realtimeResponding = true;
  responseStartedAt = nowSeconds();
  realtimeTranscript = '';
  auntyStatusEl.textContent = 'AUNTY MEI · REACTING';
  commentaryLineEl.textContent = '…';
  sendRealtimeEvent({ type: 'conversation.item.create', item: {
    type: 'message', role: 'system', content: [{ type: 'input_text', text: prompt }],
  } });
  // Audio already includes a transcript; requesting both modalities is invalid.
  sendRealtimeEvent({ type: 'response.create', response: { output_modalities: ['audio'] } });
  return true;
}
function finishAuntyPlayback() {
  setAuntyTalking(false);
  tour.nextAt = nowSeconds() + 2.5;
}
function handleRealtimeEvent(event) {
  if (event.type === 'input_audio_buffer.speech_started') {
    playerSpeaking = true;
    setAuntyTalking(false);
    auntyPetEl.classList.add('listening');
    auntyStatusEl.textContent = 'AUNTY MEI · LISTENING TO YOU';
    publishDrivingContext();
  }
  if (event.type === 'input_audio_buffer.speech_stopped') {
    playerSpeaking = false;
    tour.postpone(nowSeconds(), 5);
  }
  if (event.type === 'response.created') {
    realtimeResponding = true; responseStartedAt = nowSeconds();
    realtimeTranscript = ''; commentaryLineEl.textContent = '…';
  }
  if (event.type === 'output_audio_buffer.started') setAuntyTalking(true);
  if (event.type === 'response.output_audio_transcript.delta') {
    realtimeTranscript += event.delta;
    commentaryLineEl.textContent = realtimeTranscript;
    commentaryLineEl.scrollTop = commentaryLineEl.scrollHeight;
  }
  if (event.type === 'response.output_audio_transcript.done' && event.transcript) {
    realtimeTranscript = event.transcript; commentaryLineEl.textContent = realtimeTranscript;
  }
  if (event.type === 'response.done') {
    realtimeResponding = false;
    if (event.response?.status === 'failed') {
      setAuntyTalking(false); voiceErrorUntil = nowSeconds() + 15;
      commentaryLineEl.textContent = 'Aunty’s radio hit a hiccup. Retrying shortly.';
    } else if (!realtimeSpeaking) tour.postpone(nowSeconds(), 3);
    // Generation ends before playback: wait for the actual loudspeaker buffer.
  }
  if (['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type)) finishAuntyPlayback();
  if (event.type === 'error') {
    realtimeResponding = false; setAuntyTalking(false); voiceErrorUntil = nowSeconds() + 15;
    commentaryLineEl.textContent = 'Radio interrupted. Aunty will try again in a moment.';
    console.warn('Aunty radio error:', event.error?.code || 'unknown');
  }
}
let voiceSessionTimer = null;
async function startRealtimeAunty() {
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    commentaryLineEl.textContent = 'Live voice needs microphone support. Aunty’s subtitles are still on.';
    return;
  }
  const attempt = ++connectionAttempt;
  voiceToggle.disabled = true;
  updateVoiceButton('Connecting Aunty…');
  try {
    if (window.__HOSTED_GAME__) {
      const configResponse = await fetch('/api/config', { signal: AbortSignal.timeout(6000) });
      if (!configResponse.ok) throw new Error('Online voice service is temporarily unavailable.');
      const config = await configResponse.json();
      if (!config.authenticated) throw new Error('Sign in with ChatGPT using the race-room sign-in link before talking to Aunty.');
      if (!config.voiceAvailable) throw new Error('Aunty voice is waiting for secure API setup. Her subtitles and the race are ready.');
    }
    realtimeMicrophone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (attempt !== connectionAttempt) { realtimeMicrophone?.getTracks().forEach(track => track.stop()); return; }
    const peer = new RTCPeerConnection();
    realtimePeer = peer;
    realtimeMicrophone.getTracks().forEach(track => peer.addTrack(track, realtimeMicrophone));
    peer.addEventListener('track', (event) => {
      realtimeAudio.srcObject = event.streams[0];
      realtimeAudio.play().catch(() => { commentaryLineEl.textContent = 'Click the game to enable Aunty’s audio.'; });
    });
    peer.addEventListener('connectionstatechange', () => {
      if (realtimePeer === peer && ['failed', 'closed'].includes(peer.connectionState)) stopRealtimeAunty();
    });
    realtimeChannel = peer.createDataChannel('oai-events');
    realtimeChannel.addEventListener('message', ({ data }) => {
      try { handleRealtimeEvent(JSON.parse(data)); } catch { /* Ignore unrelated events. */ }
    });
    realtimeChannel.addEventListener('open', () => {
      updateVoiceButton('Aunty radio: ON', true);
      micModeEl.hidden = false;
      configureMicrophone();
      auntyStatusEl.textContent = 'AUNTY MEI · PIT RADIO';
      tour.queue('Welcome the driver. You will give driving advice and Singapore stories as they race.');
      tour.nextAt = nowSeconds();
      publishDrivingContext();
    });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);
    const response = await fetch('/api/realtime', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: peer.localDescription.sdp }),
      signal: AbortSignal.timeout(25000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not start Aunty’s radio.');
    if (attempt !== connectionAttempt) { peer.close(); return; }
    await peer.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
    if (payload.sessionLimitSeconds) voiceSessionTimer = setTimeout(() => {
      stopRealtimeAunty();
      commentaryLineEl.textContent = 'Aunty’s ten-minute radio break is here. You can keep racing with subtitles.';
      tour.postpone(nowSeconds(), 12);
    }, payload.sessionLimitSeconds * 1000);
  } catch (error) {
    stopRealtimeAunty();
    commentaryLineEl.textContent = error.name === 'NotAllowedError'
      ? 'Microphone not enabled. Click Talk to Aunty when you’re ready; subtitles stay on.'
      : error.message || 'Aunty could not connect.';
    tour.postpone(nowSeconds(), 10);
  } finally { voiceToggle.disabled = false; }
}
function stopRealtimeAunty() {
  clearTimeout(voiceSessionTimer); voiceSessionTimer = null;
  connectionAttempt++;
  const peer = realtimePeer; realtimePeer = null;
  realtimeChannel?.close(); realtimeChannel = null; peer?.close();
  realtimeMicrophone?.getTracks().forEach(track => track.stop()); realtimeMicrophone = null;
  realtimeAudio.pause(); realtimeAudio.srcObject = null;
  realtimeResponding = false; playerSpeaking = false;
  pushToTalkActive = false; micModeEl.hidden = true;
  setAuntyTalking(false); auntyPetEl.classList.remove('listening');
  updateVoiceButton('Talk to Aunty', false);
  tour.postpone(nowSeconds(), 2);
}
voiceToggle.addEventListener('click', () => {
  if (realtimeConnected()) stopRealtimeAunty(); else startRealtimeAunty();
});
window.addEventListener('pagehide', stopRealtimeAunty);
function sayCommentary(message, expression = 'idle') { tour.queue(message, expression); }
function updateCommentary() {
  const now = nowSeconds();
  const zone = tour.updateLocation(carState.x, carState.z, now);
  document.querySelector('#location-name').textContent = zone?.name || 'Marina Bay Street Circuit';
  if (document.hidden || !physicsReady || ['loading', 'flyover', 'approach', 'countdown'].includes(presentation.phase)) return;
  if (realtimeResponding && now - responseStartedAt > 25 && !playerSpeaking && !realtimeSpeaking) {
    sendRealtimeEvent({ type: 'response.cancel' }); realtimeResponding = false; tour.postpone(now, 3);
  }
  if (realtimeConnected() && now - lastTelemetryAt > 8 && !playerSpeaking) publishDrivingContext();
  const busy = realtimeResponding || realtimeSpeaking || playerSpeaking || now < voiceErrorUntil || voiceToggle.disabled;
  const item = tour.next(now, drive, carState.speed, busy);
  if (!item) return;
  setAuntyExpression(item.expression);
  if (!requestAuntyReply(item)) {
    commentaryLineEl.textContent = item.text;
    auntyStatusEl.textContent = item.kind === 'landmark' ? 'AUNTY MEI · SINGAPORE STORIES' : 'AUNTY MEI · PIT WALL';
  }
}

function isDown(...names) {
  return names.some((n) => keys.has(n));
}

const presentation = { phase: 'loading', elapsed: 0 };
const introEl = document.querySelector('#race-intro');
const countdownEl = document.querySelector('#countdown');
const countdownNumberEl = document.querySelector('#countdown-number');
const introTitleEl = document.querySelector('#intro-title');
const skipIntroEl = document.querySelector('#skip-intro');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastCountdown = '';
const speedEl = document.querySelector('#speed-value');
const gearEl = document.querySelector('#gear-value');
const rpmEl = document.querySelector('#rpm-bar');
const boostEl = document.querySelector('#boost-bar');
const throttleEl = document.querySelector('#throttle-bar');
const boostLabelEl = document.querySelector('#boost-label');
const raceDash = document.querySelector('#race-dashboard');
const steeringSlider = document.querySelector('#steering-sensitivity');
let steeringSensitivity = 1;
try {
  const saved = Number(localStorage.getItem('marina-steering'));
  if (saved >= 0.75 && saved <= 1.35) steeringSensitivity = saved;
} catch { /* Private browser storage can be unavailable. */ }
function showSteeringSetting() {
  steeringSlider.value = String(Math.round(steeringSensitivity * 100));
  document.querySelector('#steering-label').textContent = steeringSensitivity < 0.95 ? 'Gentle'
    : steeringSensitivity > 1.05 ? 'Responsive' : 'Balanced';
}
showSteeringSetting();
steeringSlider.addEventListener('input', () => {
  steeringSensitivity = Number(steeringSlider.value) / 100;
  showSteeringSetting();
  try { localStorage.setItem('marina-steering', String(steeringSensitivity)); } catch { /* Optional preference. */ }
});
steeringSlider.addEventListener('change', () => steeringSlider.blur());

function setRacePhase(phase) {
  presentation.phase = phase; presentation.elapsed = 0;
  document.body.dataset.racePhase = phase;
  lastCountdown = '';
}
skipIntroEl.addEventListener('click', () => {
  if (physicsReady && ['flyover', 'approach'].includes(presentation.phase)) setRacePhase('countdown');
});
function countdownBeep(go) {
  // Visual countdown only: the player requested Aunty as the sole audio.
}
function updatePresentation(dt) {
  if (presentation.phase === 'loading' && physicsReady) {
    setRacePhase(debugMode ? 'racing' : reduceMotion ? 'countdown' : 'flyover');
  }
  if (document.hidden) return;
  presentation.elapsed += dt;
  if (presentation.phase === 'flyover' && presentation.elapsed >= 6) setRacePhase('approach');
  if (presentation.phase === 'approach' && presentation.elapsed >= 2.8) setRacePhase('countdown');
  if (presentation.phase === 'countdown' && presentation.elapsed >= 3) {
    setRacePhase('go');
    tour.queue('Lights out! Squeeze the accelerator and cross the chequered line, lah.', 'cheering');
    tour.nextAt = nowSeconds();
  }
  if (presentation.phase === 'go' && presentation.elapsed >= 1.15) setRacePhase('racing');
  const phase = presentation.phase;
  const isIntro = ['loading', 'flyover', 'approach'].includes(phase);
  introEl.hidden = !isIntro;
  skipIntroEl.hidden = phase === 'loading' || !isIntro;
  introTitleEl.textContent = phase === 'loading' ? 'LOADING MARINA BAY' : 'SINGAPORE';
  const counting = phase === 'countdown' || phase === 'go';
  countdownEl.hidden = !counting;
  if (counting) {
    const value = phase === 'go' ? 'GO!' : String(3 - Math.floor(presentation.elapsed));
    if (value !== lastCountdown) {
      lastCountdown = value;
      countdownNumberEl.textContent = value;
      countdownEl.dataset.go = String(phase === 'go');
      countdownBeep(phase === 'go');
      document.querySelectorAll('#start-lights i').forEach((light, index) => {
        light.classList.toggle('lit', phase === 'countdown' && index < Math.floor(presentation.elapsed) + 1);
      });
    }
  }
}
function resetRace() {
  if (!physicsReady) return;
  keys.clear();
  chassisBody.setTranslation({ x: SPAWN_POSITION.x, y: raceSurfaceY + CHASSIS_HEIGHT, z: SPAWN_POSITION.z }, true);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SPAWN_HEADING);
  chassisBody.setRotation(rotation, true);
  chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  Object.assign(drive, createDriveState());
  Object.assign(lapState, { phase: 'staged', startedAt: 0, previousProgress: -SPAWN_DISTANCE_BEHIND_LINE,
    leftStartZone: false, lastLapMs: null });
  lapTimeEl.textContent = '0:00.000';
  lapTimerEl.querySelector('small').textContent = 'ON THE GRID — CROSS THE LINE';
  lapTimerEl.classList.remove('complete');
  physicsAccumulator = 0;
  syncCarFromPhysics();
  previousPose.position.copy(currentPose.position); previousPose.rotation.copy(currentPose.rotation);
  car.position.copy(currentPose.position); car.quaternion.copy(currentPose.rotation);
  tour.priority = null;
  setRacePhase('countdown');
}

function updateCar(dt) {
  const released = ['go', 'racing'].includes(presentation.phase) && !document.hidden;
  const input = {
    accelerate: released && isDown('w', 'arrowup'),
    brake: released && isDown('s', 'arrowdown'),
    left: released && isDown('a', 'arrowleft'), right: released && isDown('d', 'arrowright'),
    handbrake: !released || isDown(' '), boost: released && isDown('shift'),
    sensitivity: steeringSensitivity,
  };
  if (physicsReady) {
    physicsAccumulator = Math.min(physicsAccumulator + dt, PHYSICS_STEP * 6);
    while (physicsAccumulator >= PHYSICS_STEP) {
      previousPose.position.copy(currentPose.position); previousPose.rotation.copy(currentPose.rotation);
      const forces = stepDrivetrain(drive, carState.speed, input, PHYSICS_STEP);
      carState.steering = drive.steering;
      for (let index = 0; index < vehicleController.numWheels(); index++) {
        vehicleController.setWheelEngineForce(index, index >= 2 ? forces.engine : 0);
        vehicleController.setWheelBrake(index, forces.brake);
        vehicleController.setWheelSteering(index, index < 2 ? forces.steering : 0);
      }
      // Aero drag and downforce act as forces through Rapier. No velocity snaps.
      const velocity = chassisBody.linvel();
      const planarSpeed = Math.hypot(velocity.x, velocity.z);
      const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(currentPose.rotation);
      const lateralSpeed = velocity.x * rightAxis.x + velocity.z * rightAxis.z;
      drive.slip = Math.abs(lateralSpeed);
      const lateralImpulse = THREE.MathUtils.clamp(-lateralSpeed * 680 * (1 - Math.exp(-4 * PHYSICS_STEP)),
        -680 * 10 * PHYSICS_STEP, 680 * 10 * PHYSICS_STEP);
      chassisBody.applyImpulse({
        x: -velocity.x * planarSpeed * 0.52 * PHYSICS_STEP + rightAxis.x * lateralImpulse,
        y: -Math.min(planarSpeed * planarSpeed * 0.5, 4600) * PHYSICS_STEP,
        z: -velocity.z * planarSpeed * 0.52 * PHYSICS_STEP + rightAxis.z * lateralImpulse,
      }, true);
      physicsWorld.timestep = PHYSICS_STEP;
      vehicleController.updateVehicle(PHYSICS_STEP); physicsWorld.step();
      physicsAccumulator -= PHYSICS_STEP;
      syncCarFromPhysics();
    }
    const alpha = physicsAccumulator / PHYSICS_STEP;
    car.position.lerpVectors(previousPose.position, currentPose.position, alpha);
    car.quaternion.slerpQuaternions(previousPose.rotation, currentPose.rotation, alpha);
    // Wheel steering and spin match the simulated tyres.
    car.userData.wheels?.forEach((wheel, index) => {
      wheel.pivot.rotation.y = vehicleController.wheelSteering(index) || 0;
      wheel.spin.rotation.x = -(vehicleController.wheelRotation(index) || 0);
    });
  }
  updateCommentary();
  if (released) updateLapTimer();
  const speed = Math.abs(carState.speed);
  speedEl.textContent = String(Math.round(speed * 3.6)).padStart(3, '0');
  gearEl.textContent = carState.speed < -0.6 ? 'R' : String(drive.gear);
  rpmEl.style.transform = 'scaleX(' + THREE.MathUtils.clamp(drive.rpm / 12500, 0, 1) + ')';
  boostEl.style.transform = 'scaleX(' + drive.boost + ')';
  throttleEl.style.transform = 'scaleX(' + Math.max(0, drive.throttle) + ')';
  boostLabelEl.textContent = drive.boosting ? 'BOOST ACTIVE' : drive.boostLocked ? 'RECHARGING' : 'SHIFT · BOOST';
  raceDash.classList.toggle('boosting', drive.boosting);
  document.querySelector('#speed-vignette').style.opacity = reduceMotion ? 0 : String(Math.max(0, (speed - 26) / 100) + (drive.boosting ? 0.12 : 0));
}

// ---------- Cinematic introduction and rear chase camera ----------
const cameraTarget = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const shotPosition = new THREE.Vector3();
const shotTarget = new THREE.Vector3();
const smooth = (t) => { const c = THREE.MathUtils.clamp(t, 0, 1); return c * c * (3 - 2 * c); };
const aerialEnd = new THREE.Vector3(-675, 310, 145);
const aerialTargetEnd = new THREE.Vector3(-420, 55, 185);
function updateCamera(dt) {
  if (debugMode) { controls.update(); return; }
  if (presentation.phase === 'loading') {
    camera.position.set(-220, 520, -190); camera.lookAt(80, 50, 90); return;
  }
  if (presentation.phase === 'flyover') {
    const t = smooth(presentation.elapsed / 6);
    shotPosition.lerpVectors(new THREE.Vector3(-220, 520, -190), aerialEnd, t);
    shotTarget.lerpVectors(new THREE.Vector3(80, 50, 90), aerialTargetEnd, t);
    camera.position.copy(shotPosition); camera.lookAt(shotTarget);
    camera.fov = 62; camera.updateProjectionMatrix();
    return;
  }
  cameraForward.set(0, 0, 1).applyQuaternion(car.quaternion); cameraForward.y = 0; cameraForward.normalize();
  cameraRight.set(cameraForward.z, 0, -cameraForward.x);
  const speedFactor = Math.min(Math.abs(carState.speed) / CAR_CONFIG.maxSpeed, 1);
  const pullback = reduceMotion ? 0 : THREE.MathUtils.clamp(drive.acceleration / 14, -0.4, 1) * 0.65;
  const desired = car.position.clone()
    .addScaledVector(cameraForward, -9.4 - pullback - (drive.boosting ? 0.5 : 0))
    .add(new THREE.Vector3(0, presentation.phase === 'countdown' ? 4.2 : 3.15, 0));
  const target = car.position.clone().addScaledVector(cameraForward, 7).add(new THREE.Vector3(0, 0.9, 0));
  if (presentation.phase === 'approach') {
    const t = smooth(presentation.elapsed / 2.8);
    camera.position.lerpVectors(aerialEnd, desired, t);
    cameraTarget.lerpVectors(aerialTargetEnd, target, t);
    camera.lookAt(cameraTarget);
    return;
  }
  camera.position.lerp(desired, 1 - Math.exp(-8 * dt));
  cameraTarget.lerp(target, 1 - Math.exp(-10 * dt));
  camera.lookAt(cameraTarget);
  if (!reduceMotion) camera.rotateZ(-drive.steering * speedFactor * 0.012);
  const desiredFov = 62 + (reduceMotion ? 0 : speedFactor * 12 + (drive.boosting ? 5 : 0));
  camera.fov = THREE.MathUtils.damp(camera.fov, desiredFov, 4, dt);
  camera.updateProjectionMatrix();
}

// ---------- Networking ----------
const onlineStatus = document.querySelector('#online-status');
const requestedRoom = new URLSearchParams(location.search).get('room') || 'main';
const ROOM_ID = /^[a-zA-Z0-9_-]{1,24}$/.test(requestedRoom) ? requestedRoom : 'main';
const socket = window.__HOSTED_GAME__ ? new SitesRaceConnection(onlineStatus) : io();
document.querySelector('#copy-race-link').addEventListener('click', async (event) => {
  const link = new URL('/', location.origin); link.searchParams.set('room', ROOM_ID);
  try {
    await navigator.clipboard.writeText(link.href);
    event.currentTarget.textContent = 'Link copied';
  } catch { onlineStatus.textContent = 'Copy the address from your browser to invite a friend.'; }
});
if (window.__HOSTED_GAME__) fetch('/api/config').then(r => r.json()).then(config => {
  document.querySelector('#race-signin').hidden = config.authenticated;
}).catch(() => {});

// remoteId -> { mesh, target: { position: THREE.Vector3, rotation: number } }
const remotePlayers = new Map();

function createRemoteCar() {
  return createF1Car(0x1768e5);
}

function ensureRemotePlayer(id) {
  if (remotePlayers.has(id)) return remotePlayers.get(id);
  const mesh = createRemoteCar();
  mesh.visible = false;
  scene.add(mesh);
  const entry = {
    mesh,
    target: { position: new THREE.Vector3(), rotation: 0 },
  };
  remotePlayers.set(id, entry);
  return entry;
}

function removeRemotePlayer(id) {
  const entry = remotePlayers.get(id);
  if (!entry) return;
  scene.remove(entry.mesh);
  remotePlayers.delete(id);
}

socket.on('connect', () => {
  socket.emit('join', ROOM_ID);
  if (!window.__HOSTED_GAME__) onlineStatus.textContent = `Local room ${ROOM_ID}`;
});
socket.on('disconnect', () => { onlineStatus.textContent = 'Connection lost · solo driving is still available'; });

socket.on('existing-players', (players) => {
  players.forEach(({ id, position, rotation }) => {
    const entry = ensureRemotePlayer(id);
    entry.target.position.set(position.x, position.y, position.z);
    entry.target.rotation = rotation;
    entry.mesh.position.copy(entry.target.position);
    entry.mesh.rotation.y = rotation;
    entry.mesh.visible = true;
  });
});

socket.on('player-joined', ({ id }) => {
  ensureRemotePlayer(id);
});

socket.on('player-left', ({ id }) => {
  removeRemotePlayer(id);
});

socket.on('state', ({ id, position, rotation }) => {
  const entry = ensureRemotePlayer(id);
  entry.target.position.set(position.x, position.y, position.z);
  entry.target.rotation = rotation;
  entry.mesh.visible = true;
});

// Send local state at a fixed network tick rate, independent of frame rate.
const NETWORK_TICK_MS = 50;
setInterval(() => {
  if (!socket.connected) return;
  socket.emit('state', {
    position: { x: carState.x, y: carBaseY, z: carState.z },
    rotation: carState.heading,
  });
}, NETWORK_TICK_MS);

const REMOTE_LERP_FACTOR = 0.2;
function updateRemotePlayers() {
  remotePlayers.forEach((entry) => {
    entry.mesh.position.lerp(entry.target.position, REMOTE_LERP_FACTOR);
    // Shortest-path angle interpolation so cars don't spin the long way around.
    let delta = entry.target.rotation - entry.mesh.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    entry.mesh.rotation.y += delta * REMOTE_LERP_FACTOR;
  });
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  updatePresentation(dt);
  updateCar(dt);
  updateCamera(dt);
  updateRemotePlayers();

  renderer.render(scene, camera);
}
animate();

// These page tools operate the same race state as the on-screen controls.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const register = (tool) => {
    try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional browser capability. */ }
  };
  register({ name: 'get_race_status', title: 'Read race status', description: 'Read the current race phase, speed and room without changing the game.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
    execute(input) {
      if (!input || Object.keys(input).length) throw new Error('No parameters expected.');
      return { phase: presentation.phase, speedKmh: Math.round(Math.abs(carState.speed) * 3.6), room: ROOM_ID, auntyConnected: realtimeConnected() };
    },
  });
  register({ name: 'restart_race', title: 'Restart at the grid', description: 'Reset the current lap and car to the starting grid, just like pressing R.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false },
    execute(input) {
      if (!input || Object.keys(input).length) throw new Error('No parameters expected.');
      resetRace(); return { phase: presentation.phase, restarted: true };
    },
  });
  addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
