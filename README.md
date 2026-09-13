# Marina Bay Racer

A hackathon starter for a browser-based multiplayer racing game: Three.js on
the client, Node.js + Express + Socket.IO on the server, deployable to
Railway as a Node web service.

## What's here

- `server.js` — Express serves `public/`, plus a `/vendor/three` static route
  so the client can `import * as THREE from 'three'` (npm-installed, no CDN).
  Socket.IO handles room join/leave and relays player position/rotation
  updates to everyone else in the room.
- `public/index.html` + `public/main.js` — renders a ground plane and a red
  box (your car) driven with WASD / arrow keys, with a chase camera. Other
  players appear as blue boxes, smoothly interpolated between network
  updates.
- `railway.json` — tells Railway to build with Nixpacks and run `npm start`.

## Run locally

```bash
npm install
npm start
```

Open the printed local URL in two browser tabs to see two independently
controlled cars stay in sync.

## Deploy to Railway

```bash
railway login   # one-time, opens a browser
railway init
railway up
```

Railway auto-detects the Node app via `package.json` / `railway.json` and
sets `PORT` for you — no other config needed.

## Next steps for the hackathon

- Swap the boxes for real car models (Blender-authored, exported to glTF).
- Add lap timing, checkpoints, a track mesh instead of a flat plane.
- Add collision detection between cars.
- Support more than one room / lobby selection in the UI.

Built as a starting point — not production-hardened.

## Attribution

Marina Bay Street Circuit environment by Dave Love SketchFab (Sketchfab, CC-BY).
