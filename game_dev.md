# Marina Bay Racer — Development Spec for the Build Agent

This file is the source of truth for building this game. Follow it in order. Where this
file states a fact, treat it as verified — do not re-derive or second-guess it. Where it
tells you to discover something empirically (a coordinate, a tuning value), do that
discovery step for real rather than guessing a plausible-looking number — a wrong guess
presented confidently is worse than saying "I need to test this."

## 0. Why this order — read before starting

This is being built for a hackathon under a tight clock. The single biggest risk is not
"the game isn't polished enough" — it's "we ran out of time before we had anything that
reliably works." Every decision below follows from that: get one true, working, demoable
version as early as possible (Iteration 2), and only then spend remaining time on things
that make it more impressive (lighting, camera feel, audio, a real car model), in the
order that gives the most visible improvement per minute spent. Camera feel and audio are
deliberately last — they're real, worthwhile improvements, but they're multipliers on top
of a working game, not substitutes for one. Don't touch them until Iterations 1–2 are
solid.

If you only get through Iteration 2 before time runs out, that is a genuine success: a
working multiplayer racing game on a real reconstruction of the Marina Bay area is a
complete, demoable product on its own.

## 1. Current verified project state — do not re-derive this

Project root: `~/Documents/marina-bay-racer`.

Installed and confirmed working: Node v24.21.0 / npm 11.19.0, Express, Socket.IO, Three.js
`0.170.0` (installed via npm into `node_modules`, served locally — no CDN dependency).

Files that already exist:

- `server.js` — Express + Socket.IO server. Serves `public/` statically, and serves the
  `three` package's `build/` folder at `/vendor/three`. Implements room-based multiplayer:
  a client emits `join`, gets back `existing-players`, and thereafter broadcasts `state`
  ({position, rotation}) which the server relays to everyone else in the room as `state`,
  `player-joined`, `player-left`.
- `public/index.html` — bare HTML shell with an import map (`"three"` →
  `/vendor/three/three.module.js`), loads the Socket.IO client script and `public/main.js`
  as a module.
- `public/main.js` — the entire client: scene/camera/renderer setup, a flat placeholder
  ground plane + grid, a red box representing the local car with WASD/arrow-key arcade
  physics (`carState`, `CAR_CONFIG`, `updateCar()`), a simple chase camera
  (`cameraOffset`, `updateCamera()`), and the networking glue that creates/moves blue box
  meshes for remote players with lerp interpolation (`remotePlayers`,
  `ensureRemotePlayer()`, `updateRemotePlayers()`).
- `package.json`, `railway.json`, `.gitignore`, `README.md`.

Confirmed working right now, verified by opening two browser tabs at
`http://localhost:3000`: driving in one tab moves and rotates a box in the other tab
smoothly, in sync.

Not yet done, in the order this spec builds them: loading the real track model into the
scene, verifying multiplayer still works on it, swapping in a real car model, night
lighting/atmosphere, camera feel, audio. Also not done and **out of scope for you**: `git
init`/commit/push, `gh auth login`, `railway login` — the human handles all of those
themselves. Do not run any git or auth commands.

## 2. The track model — already fixed and optimized, do not redo this

Source: a Sketchfab upload titled "Marina Bay Street Circuit" by Dave Love SketchFab
(`@Tyler_Dave`), license CC-Attribution. **You must credit this creator by name in
`README.md`** (a line like "Marina Bay Street Circuit environment by Dave Love SketchFab
(Sketchfab, CC-BY)" is sufficient) before this is shown to anyone. Note for the record,
not something to act on: this asset's tags suggest it may originate from a ripped
commercial-game asset rather than an original scan; using it was a deliberate, informed
call for this internal, non-public hackathon — don't re-raise this as a blocker, just
make sure the attribution line above is present.

Two real problems were found in the original download and have already been fixed:

**Problem A — every material was set to transparent.** All 193 materials in the source
file had `alphaMode: "BLEND"` instead of `"OPAQUE"`. On solid geometry (buildings, roads)
this causes flickering, z-fighting, and wrong draw order, and it's slower to render than
opaque materials. This has been fixed by loading the file with `@gltf-transform/core` and
calling `material.setAlphaMode('OPAQUE')` on every material that was set to `BLEND` (all
193 were).

**Problem B — the file was too heavy for the web.** The original was 63.95MB. It has been
run through `@gltf-transform/cli optimize` (Draco/meshopt geometry compression, textures
resized to a 1024px cap and converted to WebP), bringing it down to 13.6MB.

**The finished, ready-to-use result is already sitting at `public/models/marina-bay-track.glb`
(13MB). Load this file directly — do not re-download it from Sketchfab, and do not re-run
the fix/optimize steps unless the human explicitly asks you to regenerate it** (for
example, if a different quality/size tradeoff is wanted later). For that case, here are
the exact steps that were used, for reproducibility only:

```js
// fix-alpha.mjs — flips every BLEND material to OPAQUE
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);

for (const mat of doc.getRoot().listMaterials()) {
  if (mat.getAlphaMode() === 'BLEND') mat.setAlphaMode('OPAQUE');
}

await io.write(process.argv[3], doc);
```

```
node fix-alpha.mjs <source>.glb fixed.glb
npx @gltf-transform/cli optimize fixed.glb optimized.glb --texture-size 1024 --texture-compress webp
```

Verified facts about the model (from `npx @gltf-transform/cli inspect`), useful context
for the steps below:

- One scene, one mesh node (named `Untitled`) made of 193 primitives, one material per
  primitive — this is normal for this kind of export, not a bug.
- Roughly 813,000 triangles / ~1.12 million vertices after optimization.
- Bounding box in meters: X from about **-2053 to 2247**, Y (height) from about **-0.09
  to 385**, Z from about **-1951 to 2350**. So the model covers a wide slice of the Marina
  Bay downtown area — roughly 4.3km × 4.3km — not just a single building or a short
  stretch of road.
- No animations, not rigged. Textures are modest resolution (capped at 1024px after
  optimization) — it will look good at racing speed and normal viewing distance, but
  don't expect razor-sharp close-up detail on distant buildings.
- Exported from Blender (`Khronos glTF Blender I/O v4.4.56`), so it's a standard,
  well-formed glTF — no exotic extensions to worry about beyond `KHR_materials_specular`.

## 3. Verified technical facts for wiring up GLTFLoader — follow exactly

These were checked directly against the installed `three@0.170.0` package, not assumed:

- `GLTFLoader.js` internally imports the bulk of its dependencies from the bare specifier
  `'three'` (already resolved by the import map in `public/index.html`) **and** one
  relative import, `from '../utils/BufferGeometryUtils.js'`, resolved relative to its own
  location inside `three/examples/jsm/`. This means you must serve the **whole**
  `examples/jsm` folder as static, not just the `loaders` subfolder, or that relative
  import will 404.
- Add this static route to `server.js`, next to the existing `/vendor/three` route:
  ```js
  app.use('/vendor/three/examples/jsm', express.static(path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm')));
  ```
- Import GLTFLoader in `public/main.js` like this:
  ```js
  import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';
  ```
- The import map does not need any changes — it already maps `"three"` correctly for
  GLTFLoader's own internal import to resolve.
- `OrbitControls.js` (needed for Iteration 1's spawn-finding step) only imports from the
  bare `'three'` specifier — no extra static route needed, it's already covered by the
  route above. Import it as:
  ```js
  import { OrbitControls } from '/vendor/three/examples/jsm/controls/OrbitControls.js';
  ```

## 4. Iteration plan — build in this exact order

### Iteration 1 — Load the real track and find a real spawn point

**Goal:** replace the placeholder ground with the actual environment, and discover (never
guess) a good spawn point.

1. Add the static route from Section 3 to `server.js`.
2. Add the GLTFLoader import from Section 3 to `public/main.js`.
3. Load `/models/marina-bay-track.glb` and add the result to `scene`. Leave the existing
   `ground` and `grid` in the code but easy to disable (e.g. `ground.visible = false`)
   rather than deleting them yet — they're a useful fallback while debugging.
4. Add a **temporary** debug camera: import `OrbitControls`, and bind a key (e.g. `c`) to
   toggle between the normal chase camera and a free-look `OrbitControls` camera. When the
   track finishes loading, compute and `console.log` its bounds:
   ```js
   const box = new THREE.Box3().setFromObject(gltf.scene);
   console.log('track bounds', box.min, box.max, box.getCenter(new THREE.Vector3()));
   ```
5. Run the server, open it in a browser, switch to the debug camera, and fly around to
   find a flat, clearly road-surfaced stretch to use as the starting point — the original
   Sketchfab preview showed a pit straight with visible starting-grid markings, which is a
   good candidate if you can locate it. Log the camera/target position as you search so
   you have real coordinates, not estimates.
6. Once you've found a good spot, hardcode it: add `SPAWN_POSITION = { x, y, z }` and
   `SPAWN_HEADING` (radians) constants near the top of `main.js`, and use them to
   initialize `carState` instead of the current `{ x: 0, z: 0 }`.
7. Remove the debug camera toggle once the spawn point is confirmed, or leave it behind a
   `?debug=1` query check for your own convenience later — not required either way.
8. **Verify:** the car sits visibly on road surface, not floating or embedded in a
   building, from a normal (non-debug) camera view.

**Do not skip step 5.** The bounding box in Section 2 tells you the extremes of the whole
scene, not where the road is inside it — there is no way to know a correct spawn point
without actually looking at the loaded scene.

### Iteration 2 — Confirm multiplayer still works on the real track

**Goal:** make sure ~13MB of real geometry didn't break sync or performance.

1. Open two browser tabs (or two devices on the same network) pointed at the server.
2. Drive in one tab; confirm the other tab's remote car stays correctly positioned on the
   track surface and moves/rotates smoothly.
3. Check the frame rate (Chrome DevTools' FPS counter or Performance tab). If it's
   uncomfortably low on your dev machine, say so plainly rather than continuing silently —
   Section 6 below has optimization options if needed.

**Definition of done:** two tabs, both cars visible and correctly placed on the real
track, movement synced, no console errors.

**This is the demo-ready checkpoint.** If time runs out right after this, you already
have a complete, presentable multiplayer racing demo on a real reconstruction of Marina
Bay. Everything from here on is improvement, not a requirement.

### Iteration 3 — Swap in a real car model (optional, do only if time allows)

1. If a car model has been sourced (for example the CC-Attribution "Low Poly F1 Car" by
   Creative Mango on Sketchfab), place it at `public/models/car.glb`.
2. Load it the same way as the track, and use it in place of the current `BoxGeometry` car
   mesh and in `createRemoteCar()` — tint the remote copy with a different material color
   so the two players stay visually distinguishable. **Do not touch** `updateCar()`,
   `carState`, or any networking code — only the visual mesh changes.
3. Check scale against the track's road width and buildings; adjust with `.scale.set(...)`
   in small increments, checking after each change, rather than guessing a final value.
4. Re-run Iteration 2's multiplayer check afterward.

If no car model is available, or this is taking more than ~15 minutes, skip it — the box
cars are a perfectly acceptable fallback and not worth blocking the schedule over.

### Iteration 4 — Night lighting and atmosphere (cheap, high impact — do this before camera/audio)

The real Singapore GP is a night race, and this is the single highest "visual improvement
per minute spent" step available.

1. Change `scene.background` from the current sky blue (`0x87ceeb`) to a dark night tone
   (something like `0x0a0a14`).
2. Reduce the `HemisphereLight` intensity and cool its colors; reduce the
   `DirectionalLight` intensity too so it reads as floodlighting, not daylight.
3. Add 2–4 `THREE.PointLight` or `THREE.SpotLight` instances near the spawn area with a
   warm color, to suggest stadium floodlights. A handful is enough — this doesn't need to
   be a full lighting rig.
4. Stretch, only if quick: if you can identify a water surface in the model (check
   material names from the `inspect` output, or ask the human which part of the scene is
   water), try a reflective material (`THREE.MeshPhysicalMaterial` with high metalness /
   low roughness) on it. Skip this without hesitation if it's not fast.
5. **Verify visually:** the scene should read as a moody night race, not flat daylight or
   pitch black — the road and nearby buildings should still be clearly legible.

### Iteration 5 — Camera feel (after the environment and lighting are solid, not before)

Implement these one at a time, testing after each — they're easy to overtune into
something nauseating rather than exciting, so prefer subtle.

1. Lower and pull the camera closer to driver's-eye height rather than the current
   elevated chase view. Start from `cameraOffset = new THREE.Vector3(0, 1.6, -4)` (down
   from the current `(0, 5, -9)`) and tune by feel from there.
2. Speed-based field of view: interpolate `camera.fov` between about 60 and 72 degrees
   based on `Math.abs(carState.speed) / CAR_CONFIG.maxSpeed`, calling
   `camera.updateProjectionMatrix()` whenever it changes.
3. A brief camera shake or FOV "punch" on hard braking (when `brake` is true and speed is
   dropping fast).
4. A slight camera roll/lean into turns, proportional to `speedFactor` and steering input
   — a few degrees is plenty.

### Iteration 6 — Audio (last, once everything above works and feels right)

1. `npm install howler`.
2. You need real audio assets for this step — a looping engine sound (pitch-shiftable), a
   tire-screech sound, and ideally a gear-shift/brake sound. If none are available, say so
   rather than fabricating placeholder behavior that doesn't actually produce sound.
3. Loop the engine sound continuously, mapping its playback rate to roughly 0.7–1.8 based
   on `Math.abs(carState.speed) / CAR_CONFIG.maxSpeed`.
4. Trigger the tire-screech sound on hard steering above some speed threshold (e.g. >40%
   of max speed), guarding against re-triggering it every frame while held.
5. Keep volumes modest, and confirm this doesn't introduce stutter — audio glitches are
   more noticeable and worse than having no audio.
6. If time allows, layer in a couple of short "team radio" style clips on simple events
   (e.g. "DRS enabled") — nice-to-have, not required.

## 5. Priority order if you have to stop early

Highest priority first: **Iteration 1 → Iteration 2 → Iteration 4 (lighting) → Iteration 5
(camera) → Iteration 3 (real car model) → Iteration 6 (audio).** Lighting is prioritized
above the car-model swap and camera feel because it's the cheapest, highest-visual-return
change available — a well-lit real track with simple box cars will read better on camera
than a poorly-lit scene with a detailed car model.

## 6. If performance is a problem

In order of effort: lower `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))`
on high-DPI displays; disable shadow casting if it was enabled anywhere; re-run the
optimize step from Section 2 with a smaller `--texture-size` (e.g. 512); if triangle count
is still the bottleneck, add a `simplify` pass via `@gltf-transform/functions` to further
reduce the mesh before re-optimizing.

## 7. Rules — do not do these things

- run `git init`, `git add`, `git commit`, `git push`, `gh auth login`, or `railway
  login` end to end.
- Do not modify the Socket.IO room/networking logic in `server.js` unless specifically
  asked — it's already tested and working.
- Do not re-download or re-process the model file without being asked to.
- Do not start Iteration 4, 5, or 6 before Iterations 1 and 2 are confirmed working.
- Do not present a guessed numeric value (a coordinate, a light intensity, a tuning
  constant) as if it were verified — where this file says to discover something
  empirically, do that, and say so if you haven't yet.
